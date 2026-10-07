// Live GitHub fetch — the browser reaches the Lume server (same origin), which
// fetches GitHub server-side via the built-in http_get() (outbound TLS). The
// user can type ANY owner and analyze it without a pre-fetched local snapshot.
//
// Mirrors the shapes the server emits (types.ts) so the dashboard renders the
// same regardless of source. The shared server is limited to ~60 unauthenticated
// req/h; a single owner needs at most 1 (profile) + ceil(repos/100) calls.

import type { Overview, RepoView, People, PersonView } from "./types";

// Same-origin GitHub proxy route on the Lume server (app/github.lume). The
// browser can always reach its own host even without egress to GitHub.
const LIVE_GITHUB = "/api/live/github";

// ---- unauthenticated rate-limit guard -----------------------------------
// GitHub's unauthenticated limit is 60 req/h per server IP — much tighter
// than the concurrency/gap below. The throttle here only paces bursts and
// caps in-flight calls; the real protection is the circuit-breaker: the
// first 429/403 trips ghTripped and the rest of the batch fails fast instead
// of hammering the limit.
let ghBusy = 0;        // in-flight GitHub calls
let ghNextAt = 0;     // earliest timestamp a new call may start
const GH_CONCURRENCY = 3;
const GH_MIN_GAP_MS = 800; // pace between requests (~75 req/min ceiling)

// true after we've seen a rate-limit; getGithub stops issuing new calls.
let ghTripped = false;
export function ghTrippedNow(): boolean {
  return ghTripped;
}
export function resetGhThrottle(): void {
  ghTripped = false;
}

async function acquireGithubSlot(): Promise<void> {
  if (ghTripped) {
    throw new Error("GitHub rate limit already hit earlier — stop here (add GH_TOKEN or use cached owners)");
  }
  for (;;) {
    if (ghBusy < GH_CONCURRENCY) {
      ghBusy++;
      const wait = Math.max(0, ghNextAt - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      ghNextAt = Math.max(ghNextAt, Date.now()) + GH_MIN_GAP_MS;
      return;
    }
    await new Promise((r) => setTimeout(r, 60)); // poll for a free slot
  }
}

// Ask the Lume server to fetch a user-scoped GitHub path server-side. The
// route returns a uniform envelope { ok, status, data, err }; data is the raw
// upstream JSON body. Each call is throttled (above).
async function getGithub(path: string, owner: string, signal?: AbortSignal): Promise<any> {
  await acquireGithubSlot();
  try {
    return await fetchGithubOnce(path, owner, signal);
  } finally {
    ghBusy--;
  }
}

async function fetchGithubOnce(path: string, owner: string, signal?: AbortSignal): Promise<any> {
  let r: Response;
  try {
    r = await fetch(
      LIVE_GITHUB + "?path=" + encodeURIComponent(path),
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

function daysAgo(iso?: string | null): number {
  if (!iso) return -1;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return -1;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function recencyBucket(d: number): RepoView["recency"] {
  if (d < 0) return "unknown";
  if (d <= 90) return "active";
  if (d <= 365) return "recent";
  if (d <= 730) return "dormant";
  return "stale";
}

// map one raw GitHub repo object to our RepoView (same rules as the server).
function toView(r: any): RepoView {
  let lang = r.language;
  if (lang === "null" || lang === undefined || lang === null) lang = "";
  let lic = "None";
  const l = r.license;
  if (l) {
    const id = String(l.spdx_id ?? "");
    lic = id === "NOASSERTION" || id === "null" || id === "" ? "Custom" : id;
  }
  const dUpdated = daysAgo(r.updated_at);
  const dPush = daysAgo(r.pushed_at);
  const createdYear = r.created_at ? new Date(r.created_at).getFullYear() : 0;
  return {
    name: r.name,
    full_name: r.full_name ?? r.name,
    lang,
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    issues: r.open_issues_count ?? 0,
    is_fork: !!r.fork,
    archived: !!r.archived,
    license: lic,
    desc: (r.description || "").slice(0, 140),
    url: r.html_url ?? "",
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 8) : [],
    created: r.created_at ?? "",
    updated: r.updated_at ?? "",
    pushed: r.pushed_at ?? "",
    created_year: createdYear,
    days_since_push: dPush,
    days_since_updated: dUpdated,
    recency: recencyBucket(dPush), // "active" = pushed within 90d (server parity)
    size: r.size ?? 0,
    push_month: r.pushed_at ? r.pushed_at.slice(0, 7) : "",
  };
}

// "YYYY-MM" -> count of repos last pushed that month. Matches the
// server-side push_month_histogram so live and cached paths agree.
export function pushTrend(repos: RepoView[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of repos) {
    const m = r.push_month || (r.pushed ? r.pushed.slice(0, 7) : "");
    if (!m) continue;
    acc[m] = (acc[m] || 0) + 1;
  }
  return acc;
}

function histogram(repos: RepoView[], key: (r: RepoView) => string) {
  const acc: Record<string, number> = {};
  for (const r of repos) {
    const k = key(r) || "None";
    acc[k] = (acc[k] || 0) + 1;
  }
  return acc;
}

function topN<T>(list: T[], n: number): T[] {
  return list.slice(0, n);
}

export interface LiveResult {
  overview: Overview;
  all: RepoView[]; // sorted by updated desc — for client-side browsing
}

// Per-page progress for a live fetch. `total` is an estimate from the
// profile's public_repos count (0 when unknown); `repos` is how many have
// been pulled so far.
export interface LiveProgress {
  page: number;
  total: number;
  repos: number;
}
export type LiveProgressFn = (p: LiveProgress) => void;

export async function fetchLive(
  owner: string,
  signal?: AbortSignal,
  onProgress?: LiveProgressFn
): Promise<LiveResult> {
  // Cache hit: re-analyzing the same owner within the TTL skips GitHub
  // entirely — the unauthenticated 60 req/h shared limit makes a live fetch
  // the slowest path in the app, and revisiting a just-fetched owner is the
  // common case after a page refresh or an owner switch.
  const cached = readLiveCache(owner);
  if (cached) return cached;

  const user = await getGithub("/users/" + encodeURIComponent(owner), owner, signal);
  // the proxy returns null on an empty 200 body; guard so a malformed
  // upstream response degrades to an empty profile instead of crashing
  const u = user ?? {};

  // estimate the page count from the profile so the UI can show "page 2/3";
  // 0 when unknown (the progress bar degrades to a spinner-style message).
  const estTotal =
    u && typeof u.public_repos === "number" && u.public_repos > 0
      ? Math.max(1, Math.ceil(u.public_repos / 100))
      : 0;

  // paginate the owner's own repos (type=owner), up to a sensible cap
  const reposRaw: any[] = [];
  let page = 1;
  for (;;) {
    const batch = await getGithub(
      "/users/" + encodeURIComponent(owner) +
      "/repos?type=owner&sort=updated&per_page=100&page=" + page,
      owner,
      signal
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    reposRaw.push(...batch);
    onProgress?.({ page, total: estTotal, repos: reposRaw.length });
    if (batch.length < 100 || page >= 10) break; // cap ~1000 repos
    page += 1;
  }

  // archived repos are excluded from every public view (server parity: the
  // cached path filters via active_repos() too)
  const all = reposRaw.map(toView).filter((r) => !r.archived).sort((a, b) => (a.updated < b.updated ? 1 : -1));
  const originals = all.filter((r) => !r.is_fork);

  const overview: Overview = {
    owner,
    fetched_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    profile: {
      name: u.name,
      avatar_url: u.avatar_url,
      bio: u.bio,
      company: u.company,
      location: u.location,
      blog: u.blog,
      twitter_username: u.twitter_username,
      hireable: u.hireable,
      followers: u.followers,
      following: u.following,
      public_repos: u.public_repos,
      public_gists: u.public_gists,
      created_at: u.created_at,
      html_url: u.html_url,
    },
    count: all.length,
    non_fork_count: originals.length,
    totals: {
      stars: all.reduce((s, r) => s + r.stars, 0),
      forks: all.reduce((s, r) => s + r.forks, 0),
      issues: all.reduce((s, r) => s + r.issues, 0),
      archived: all.filter((r) => r.archived).length,
      forked: all.filter((r) => r.is_fork).length,
    },
    languages: histogram(all, (r) => r.lang),
    recency: histogram(all, (r) => r.recency),
    years: histogramYear(all),
    top_by_stars: topN(
      [...all].sort((a, b) => b.stars - a.stars),
      10
    ),
    top_by_activity: topN(
      [...all].sort((a, b) => b.created_year - a.created_year),
      10
    ),
    push_trend: pushTrend(all),
  };

  const result: LiveResult = { overview, all };
  writeLiveCache(owner, result);
  return result;
}

// ---- live-fetch result cache (browser-side) ----------------------------
// The unauthenticated GitHub limit (~60 req/h shared) makes a live fetch
// slow; caching the finished LiveResult per owner for a short TTL turns
// revisits into instant responses. localStorage survives a page refresh;
// quota/unavailable storage degrades to "no cache" and live still works.

const LIVE_CACHE_KEY = "lume-talentlens.live.v1";
const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;

interface LiveCacheEntry {
  fetchedAt: number;
  result: LiveResult;
}

function readLiveCache(owner: string): LiveResult | null {
  try {
    const raw = localStorage.getItem(LIVE_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, LiveCacheEntry>;
    const e = map[owner];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > LIVE_CACHE_TTL_MS) return null;
    return e.result;
  } catch {
    return null;
  }
}

function writeLiveCache(owner: string, result: LiveResult): void {
  try {
    const raw = localStorage.getItem(LIVE_CACHE_KEY);
    const map: Record<string, LiveCacheEntry> = raw ? JSON.parse(raw) : {};
    map[owner] = { fetchedAt: Date.now(), result };
    localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* quota or storage unavailable — the live fetch still works uncached */
  }
}

// year histogram drops zero/invalid years (matches server behavior).
function histogramYear(repos: RepoView[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of repos) {
    if (!r.created_year) continue;
    const k = String(r.created_year);
    acc[k] = (acc[k] || 0) + 1;
  }
  return acc;
}

// client-side substring search across name/desc/lang/topics (lowercased).
export function searchLocal(all: RepoView[], q: string): RepoView[] {
  const needle = q.toLowerCase();
  if (!needle) return all;
  return all.filter((r) => {
    const hay = [r.name, r.desc, r.lang, ...(r.topics || [])].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}

function toPerson(u: any): PersonView {
  return {
    login: u.login ?? "",
    name: u.name || u.login || "",
    avatar: u.avatar_url ?? "",
    url: u.html_url ?? "",
    type: u.type ?? "User",
  };
}

// live people: fetch followers + following (first page of 100 each) directly
// from GitHub in the browser, shaped to the same `People` the server emits.
// `totals` is optional — when omitted (or a count is missing) it falls back
// to the number actually fetched, so callers can rely on it without needing
// a fresh profile in closure.
export async function fetchLivePeople(
  owner: string,
  totals?: { followers: number; following: number },
  signal?: AbortSignal
): Promise<People> {
  async function page(kind: "followers" | "following"): Promise<PersonView[]> {
    try {
      const data: any[] = await getGithub(
        "/users/" + encodeURIComponent(owner) + "/" + kind + "?per_page=100",
        owner,
        signal
      );
      return Array.isArray(data) ? data.map(toPerson) : [];
    } catch {
      // rate limit / not found / unreachable -> empty list (caller surfaces
      // an actionable hint when both lists are empty).
      return [];
    }
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
