// live-core.ts — pure derivation + browser cache for live GitHub fetches.
//
// Everything in this module is side-effect free (or storage-injected), so it
// is unit-testable without a fetch / GitHub round-trip. The fetch + throttle
// orchestration stays in live.ts; this module only maps raw GitHub payloads to
// the same shapes the server emits (types.ts) and caches finished results.
//
// The cache store is injected (defaults to localStorage) and the clock is an
// injectable `now` so tests can drive TTL expiry deterministically.

import type { Overview, RepoView, PersonView } from "./types";

export interface LiveCacheStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const LIVE_CACHE_KEY = "lume-talentlens.live.v1";
export const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;

export interface LiveResult {
  overview: Overview;
  all: RepoView[]; // sorted by updated desc — for client-side browsing
}

interface LiveCacheEntry {
  fetchedAt: number;
  result: LiveResult;
}

// Default store wraps localStorage; quota / private mode degrade to a no-op
// store so live fetching still works, just uncached.
const defaultStore: LiveCacheStore = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota or storage unavailable — live still works uncached */
    }
  },
};

export function readLiveCache(
  owner: string,
  store: LiveCacheStore = defaultStore,
  now: number = Date.now()
): LiveResult | null {
  try {
    const raw = store.get(LIVE_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, LiveCacheEntry>;
    const e = map[owner];
    if (!e) return null;
    if (now - e.fetchedAt > LIVE_CACHE_TTL_MS) return null;
    return e.result;
  } catch {
    return null;
  }
}

export function writeLiveCache(
  owner: string,
  result: LiveResult,
  store: LiveCacheStore = defaultStore,
  now: number = Date.now()
): void {
  try {
    const raw = store.get(LIVE_CACHE_KEY);
    const map: Record<string, LiveCacheEntry> = raw ? JSON.parse(raw) : {};
    map[owner] = { fetchedAt: now, result };
    store.set(LIVE_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* quota or storage unavailable — the live fetch still works uncached */
  }
}

// Persist a finished LiveResult into the browser cache (phase-2 completion
// path writes it; fetchLive keeps doing it inline for the compare panel).
export function writeLiveCacheResult(owner: string, result: LiveResult): void {
  writeLiveCache(owner, result);
}

function daysAgo(iso?: string | null): number {
  if (!iso) return -1;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return -1;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export function recencyBucket(d: number): RepoView["recency"] {
  if (d < 0) return "unknown";
  if (d <= 90) return "active";
  if (d <= 365) return "recent";
  if (d <= 730) return "dormant";
  return "stale";
}

// map one raw GitHub repo object to our RepoView (same rules as the server).
export function toView(r: any): RepoView {
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

// "YYYY-MM" -> count of repos last pushed that month. Matches the server-side
// push_month_histogram so live and cached paths agree.
export function pushTrend(repos: RepoView[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of repos) {
    const m = r.push_month || (r.pushed ? r.pushed.slice(0, 7) : "");
    if (!m) continue;
    acc[m] = (acc[m] || 0) + 1;
  }
  return acc;
}

function histogram(repos: RepoView[], key: (r: RepoView) => string): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of repos) {
    const k = key(r) || "None";
    acc[k] = (acc[k] || 0) + 1;
  }
  return acc;
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

function topN<T>(list: T[], n: number): T[] {
  return list.slice(0, n);
}

// Shared Overview builder. `partial` marks the phase-1 view (profile only,
// no repo stats yet). Cached/server views are never partial.
export function buildOverview(
  owner: string,
  u: any,
  lastPush: string,
  reposRaw: any[],
  partial: boolean
): Overview {
  // archived and forked repos are excluded from every public view (server
  // parity: the cached path filters via active_repos() too)
  const all = reposRaw
    .map(toView)
    .filter((r) => !r.archived && !r.is_fork)
    .sort((a, b) => (a.updated < b.updated ? 1 : -1));
  const originals = all.filter((r) => !r.is_fork);
  return {
    owner,
    fetched_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    partial,
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
      last_push: lastPush,
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
    top_by_stars: topN([...all].sort((a, b) => b.stars - a.stars), 10),
    top_by_activity: topN([...all].sort((a, b) => b.created_year - a.created_year), 10),
    push_trend: pushTrend(all),
  };
}

// Phase-1 Overview — profile only; the dashboard renders the ProfileCard and
// shows a "pulling repos" note until phase 2 fills the rest in.
export function buildOverviewPartial(owner: string, u: any, lastPush: string): Overview {
  return buildOverview(owner, u, lastPush, [], true);
}

// Phase-2 Overview — full aggregates, replaces the partial one.
export function buildOverviewFull(owner: string, u: any, lastPush: string, reposRaw: any[]): Overview {
  return buildOverview(owner, u, lastPush, reposRaw, false);
}

// RepoView[] for the dashboard's browse list (same derivation as the
// overview's internal all()).
export function ovRepos(reposRaw: any[]): RepoView[] {
  return reposRaw
    .map(toView)
    .filter((r) => !r.archived && !r.is_fork)
    .sort((a, b) => (a.updated < b.updated ? 1 : -1));
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

export function toPerson(u: any): PersonView {
  return {
    login: u.login ?? "",
    name: u.name || u.login || "",
    avatar: u.avatar_url ?? "",
    url: u.html_url ?? "",
    type: u.type ?? "User",
  };
}
