// Live GitHub fetch — the browser reaches the Lume server (same origin), which
// fetches GitHub server-side via the built-in http_get() (outbound TLS). The
// user can type ANY owner and analyze it without a pre-fetched local snapshot.
//
// This module owns the fetch orchestration: GitHub-aware throttling, the
// rate-limit circuit breaker, the two-phase pagination and the live people
// fetch. Pure derivation (toView/buildOverview/…) and the browser cache live
// in live-core.ts (unit-tested); everything here is re-exported from there so
// callers keep the same import surface.
//
// The shared server is limited to ~60 unauthenticated req/h; a single owner
// needs at most 1 (profile) + ceil(repos/100) calls.

import type { People, PersonView } from "./types";
import {
  buildOverview,
  ovRepos,
  readLiveCache,
  writeLiveCache,
  toPerson,
  type LiveResult,
} from "./live-core";

// Re-export the pure/core surface unchanged so existing imports keep working.
export {
  pushTrend,
  buildOverviewPartial,
  buildOverviewFull,
  writeLiveCacheResult,
  ovRepos,
  searchLocal,
  toView,
  toPerson,
  recencyBucket,
  LIVE_CACHE_TTL_MS,
} from "./live-core";
export type { LiveResult, LiveCacheStore } from "./live-core";

// Same-origin GitHub proxy route on the Lume server (app/github.lume). The
// browser can always reach its own host even without egress to GitHub.
const LIVE_GITHUB = "/api/live/github";

// ---- GitHub auth-aware rate-limit guard --------------------------------
// The throttle paces bursts and caps in-flight calls. Anonymous GitHub is
// limited to ~60 req/h per server IP, so the guard is conservative; with a
// GH_TOKEN the ceiling jumps to 5000 req/h and the pacing is relaxed. The
// circuit-breaker stays: the first 429/403 trips ghTripped and the rest of
// the batch fails fast instead of hammering the limit.
let ghBusy = 0;        // in-flight GitHub calls
let ghNextAt = 0;     // earliest timestamp a new call may start
const GH_CONCURRENCY = 3;
const GH_MIN_GAP_MS = 800; // anonymous pace (~75 req/min ceiling)
const GH_CONCURRENCY_AUTHED = 6;
const GH_MIN_GAP_MS_AUTHED = 100; // with token (~600 req/min ceiling)

// null = not probed yet; acquireGithubSlot lazily probes and caches this.
let ghAuthed: boolean | null = null;

// Probe whether the server has a GH_TOKEN configured (it never leaks the
// token itself — the route only returns a boolean). Cached after the first
// call; this is a same-origin request, not subject to GitHub limits.
export async function detectGhAuth(): Promise<boolean> {
  if (ghAuthed !== null) return ghAuthed;
  try {
    const r = await fetch("/api/github_auth", { cache: "no-store" });
    const d = (await r.json()) as { authed?: boolean };
    ghAuthed = !!d.authed;
  } catch {
    ghAuthed = false;
  }
  return ghAuthed;
}

// true after we've seen a rate-limit; getGithub stops issuing new calls.
// Not permanent: after a cooldown the breaker half-opens and lets a single
// call through — a transient 429/403 (proxy node swap, momentary GitHub
// throttling) must not wedge the page for the rest of the session.
let ghTripped = false;
let ghTrippedAt = 0;
const GH_TRIP_COOLDOWN_MS = 60_000;
export function ghTrippedNow(): boolean {
  if (ghTripped && Date.now() - ghTrippedAt > GH_TRIP_COOLDOWN_MS) {
    ghTripped = false; // half-open: let one call through after the cooldown
  }
  return ghTripped;
}
export function resetGhThrottle(): void {
  ghTripped = false;
}

async function acquireGithubSlot(): Promise<void> {
  if (ghTrippedNow()) {
    throw new Error("GitHub rate limit already hit earlier — stop here (add GH_TOKEN or use cached owners)");
  }
  if (ghAuthed === null) {
    ghAuthed = await detectGhAuth();
  }
  const concurrency = ghAuthed ? GH_CONCURRENCY_AUTHED : GH_CONCURRENCY;
  const gapMs = ghAuthed ? GH_MIN_GAP_MS_AUTHED : GH_MIN_GAP_MS;
  for (;;) {
    if (ghBusy < concurrency) {
      ghBusy++;
      const wait = Math.max(0, ghNextAt - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      ghNextAt = Math.max(ghNextAt, Date.now()) + gapMs;
      return;
    }
    await new Promise((r) => setTimeout(r, 60)); // poll for a free slot
  }
}

// Ask the Lume server to fetch a user-scoped GitHub path server-side. The
// route returns a uniform envelope { ok, status, data, err }; data is the raw
// upstream JSON body. Each call is throttled (above).
async function getGithub(path: string, owner: string, signal?: AbortSignal, refresh?: boolean): Promise<any> {
  await acquireGithubSlot();
  try {
    return await fetchGithubOnce(path, owner, signal, refresh);
  } finally {
    ghBusy--;
  }
}

async function fetchGithubOnce(path: string, owner: string, signal?: AbortSignal, refresh?: boolean): Promise<any> {
  let r: Response;
  try {
    r = await fetch(
      LIVE_GITHUB + "?path=" + encodeURIComponent(path) + (refresh ? "&refresh=1" : ""),
      { signal, headers: { Accept: "application/json" } }
    );
  } catch (e) {
    throw new Error(
      "Could not reach the Lume live proxy (" + String((e as Error)?.message || e) + "). " +
      "Make sure the app server is running (make dev)."
    );
  }
  // The proxy always answers 200 with a JSON envelope; surface its status.
  let env: { ok: boolean; status: number; data: string; err: string };
  try {
    env = await r.json();
  } catch (e) {
    throw new Error("Live proxy returned non-JSON (HTTP " + r.status + ")");
  }
  if (env.status === 403 || env.status === 429) {
    ghTripped = true; // stop the rest of the batch early
    ghTrippedAt = Date.now();
    throw new Error("GitHub rate limit / access (HTTP " + env.status + ") — try a cached owner or add GH_TOKEN");
  }
  if (env.status === 404) throw new Error("owner '" + owner + "' not found on GitHub");
  if (!env.ok) {
    throw new Error(env.err
      ? "Live fetch failed: " + env.err
      : "GitHub HTTP " + env.status);
  }
  try {
    return env.data ? JSON.parse(env.data) : null;
  } catch {
    throw new Error("GitHub returned unparseable data for " + path);
  }
}

// ---- two-phase live fetch ----------------------------------------------
// Owners with thousands of repos (e.g. 4k+ for @idimetrix) take tens of
// seconds to paginate; holding the whole ProfileCard hostage to that made
// "实时获取" feel broken. Phase 1 (fetchLiveProfile) returns the profile +
// most recent push in ~2 requests so the card renders immediately; phase 2
// (fetchLiveRepos) keeps paginating and the dashboard fills in the rest.

export interface LiveProfilePhase {
  user: any;
  lastPush: string;
  estTotal: number; // estimated repo pages (0 when unknown)
}

// Per-page progress for a live fetch. `total` is an estimate from the
// profile's public_repos count (0 when unknown); `repos` is how many have
// been pulled so far.
export interface LiveProgress {
  page: number;
  total: number;
  repos: number;
  // what is being pulled — the overview progress panel renders a tailored
  // label per kind; `detail` overrides the label entirely (e.g. people/refresh).
  kind?: "repos" | "people" | "refresh";
  detail?: string;
}
export type LiveProgressFn = (p: LiveProgress) => void;

// Phase 1 — profile + the single most recently pushed repo (sort=pushed
// desc). Two requests, always fast; enough for ProfileCard + the hireable
// cross-check.
export async function fetchLiveProfile(
  owner: string,
  signal?: AbortSignal,
  refresh?: boolean
): Promise<LiveProfilePhase> {
  const user = await getGithub("/users/" + encodeURIComponent(owner), owner, signal, refresh);
  // the proxy returns null on an empty 200 body; guard so a malformed
  // upstream response degrades to an empty profile instead of crashing
  const u = user ?? {};
  // sort=pushed&direction=desc page 1 = the globally most recent push, so a
  // single lightweight call replaces scanning every repo page for lastPush
  // (and is more accurate than the old sort=updated scan).
  let lastPush = "";
  try {
    const recent = await getGithub(
      "/users/" + encodeURIComponent(owner) +
      "/repos?type=owner&sort=pushed&direction=desc&per_page=1",
      owner,
      signal,
      refresh
    );
    const first = Array.isArray(recent) ? recent[0] : null;
    lastPush = first?.pushed_at ?? "";
  } catch {
    // repo fetch failed — keep profile-only render; lastPush stays ""
  }
  const estTotal =
    u && typeof u.public_repos === "number" && u.public_repos > 0
      ? Math.max(1, Math.ceil(u.public_repos / 100))
      : 0;
  return { user: u, lastPush, estTotal };
}

// Phase 2 — paginate the owner's own repos (type=owner), up to a sensible
// cap. Returns the raw list (caller derives RepoView[] / aggregates).
export async function fetchLiveRepos(
  owner: string,
  estTotal: number,
  signal?: AbortSignal,
  onProgress?: LiveProgressFn,
  refresh?: boolean
): Promise<any[]> {
  const reposRaw: any[] = [];
  let page = 1;
  for (;;) {
    const batch = await getGithub(
      "/users/" + encodeURIComponent(owner) +
      "/repos?type=owner&sort=updated&per_page=100&page=" + page,
      owner,
      signal,
      refresh
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    reposRaw.push(...batch);
    onProgress?.({ page, total: estTotal, repos: reposRaw.length });
    if (batch.length < 100 || page >= 10) break; // cap ~1000 repos
    page += 1;
  }
  return reposRaw;
}

export async function fetchLive(
  owner: string,
  signal?: AbortSignal,
  onProgress?: LiveProgressFn,
  refresh?: boolean
): Promise<LiveResult> {
  // Cache hit: re-analyzing the same owner within the TTL skips GitHub
  // entirely — the unauthenticated 60 req/h shared limit makes a live fetch
  // the slowest path in the app, and revisiting a just-fetched owner is the
  // common case after a page refresh or an owner switch. refresh=1 bypasses
  // this (and the server's tiers) to force a real GitHub round-trip.
  if (!refresh) {
    const cached = readLiveCache(owner);
    if (cached) return cached; // readLiveCache stamps cached:true / 0ms
  }

  const t0 = performance.now();
  const { user: u, lastPush, estTotal } = await fetchLiveProfile(owner, signal, refresh);
  const reposRaw = await fetchLiveRepos(owner, estTotal, signal, onProgress, refresh);
  const overview = buildOverview(owner, u, lastPush, reposRaw, false);

  const result: LiveResult = {
    overview,
    all: ovRepos(reposRaw),
    cached: false,
    elapsedMs: Math.round(performance.now() - t0),
  };
  writeLiveCache(owner, result);
  return result;
}

// live people: fetch followers + following from GitHub through the server
// proxy, paging to completion (per_page=100, up to 10 pages — same bounds as
// the server-side snapshot refresh). A mid-way network / rate-limit failure
// stops the loop and returns what was fetched; callers that need to be exact
// should treat a short list with suspicion, but the common case now matches
// the snapshot counts instead of showing only the first page (which used to
// under-report mutual followers: following 298 -> first page 100 -> mutual 3).
// `totals` is optional — when omitted (or a count is missing) it falls back
// to the number actually fetched, so callers can rely on it without needing
// a fresh profile in closure.
export async function fetchLivePeople(
  owner: string,
  totals?: { followers: number; following: number },
  signal?: AbortSignal,
  refresh?: boolean,
  onProgress?: LiveProgressFn
): Promise<People> {
  async function page(kind: "followers" | "following"): Promise<PersonView[]> {
    for (let pg = 1; pg <= 10; pg++) {
      let data: any[] = [];
      try {
        data = await getGithub(
          "/users/" + encodeURIComponent(owner) + "/" + kind + "?per_page=100&page=" + pg,
          owner,
          signal,
          refresh
        );
      } catch {
        // rate limit / not found / unreachable mid-way -> keep what we have
        // (caller surfaces an actionable hint when both lists are empty).
        break;
      }
      if (!Array.isArray(data) || data.length === 0) break;
      out.push(...data.map(toPerson));
      // the overview progress panel renders a kind-specific label; people
      // progress carries no numeric total (page bounds are unknown upfront),
      // but reports which list and which page so the user sees movement.
      onProgress?.({ page: pg, total: 0, repos: 0, kind: "people", detail: kind });
      if (data.length < 100) break;
    }
    return out;
  }
  const [followers, following] = await Promise.all([
    page("followers"),
    page("following"),
  ]);
  const tFollowers =
    totals && typeof totals.followers === "number" ? totals.followers : followers.length;
  const tFollowing =
    totals && typeof totals.following === "number" ? totals.following : following.length;
  return {
    owner,
    followers,
    following,
    totals: { followers: tFollowers, following: tFollowing },
    note: "live from GitHub (first page of each)",
  };
}
