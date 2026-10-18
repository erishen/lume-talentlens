import type {
  Overview,
  RepoPage,
  SearchResult,
  OwnerList,
  People,
  PeopleDiff,
  PeopleHistory,
  HealthHistory,
  PersonView,
  NoSnapshot,
  Radar,
  Stargazers,
  Trending,
  Classify,
  RefreshResult,
} from "./types";

// Every route accepts an optional `owner` (defaults server-side to the last
// fetched owner). JSON routes answer 200 with a NoSnapshot body (status 404
// inside) when that owner has no local snapshot yet — so `j()` does NOT throw
// on those; callers must check isNoSnapshot on the parsed value.
async function j<T>(url: string): Promise<T> {
  const r = await window.fetch(url);
  // 404/non-ok: try to parse the (no_snapshot) body; only throw when the
  // body itself is unparseable.
  if (r.status === 404 || !r.ok) {
    try {
      return (await r.json()) as T;
    } catch {
      throw new Error(url + " -> " + r.status);
    }
  }
  return (await r.json()) as T;
}

function ownerQS(owner?: string): string {
  return owner ? "owner=" + encodeURIComponent(owner) : "";
}

// POST a JSON body; parse the response but never throw on a non-2xx status
// (refresh answers 429/502 with a typed body the caller wants to read).
async function postJ<T>(url: string, body: unknown): Promise<T | null> {
  const r = await window.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json().catch(() => null)) as T | null;
}

export const api = {
  owners: () => j<OwnerList>("/api/owners"),
  // Server-side followers/following refresh. POST + JSON content-type so the
  // server's CSRF guard applies (a cross-origin <img>/GET can't trigger it).
  refresh: (owner: string) => postJ<RefreshResult>("/api/refresh", { owner }),
  overview: (owner?: string) =>
    j<Overview | NoSnapshot>("/api/overview" + (owner ? "?" + ownerQS(owner) : "")),
  repos: (offset: number, limit: number, owner?: string) =>
    j<RepoPage | NoSnapshot>(
      "/api/repos?offset=" + offset + "&limit=" + limit + (owner ? "&" + ownerQS(owner) : "")
    ),
  search: (q: string, owner?: string) => {
    const params = ["q=" + encodeURIComponent(q)];
    if (owner) params.push(ownerQS(owner));
    return j<SearchResult | NoSnapshot>("/api/search?" + params.join("&"));
  },
  people: (owner?: string) =>
    j<People | NoSnapshot>("/api/people" + (owner ? "?" + ownerQS(owner) : "")),
  peopleDiff: (owner?: string) =>
    j<PeopleDiff>("/api/people_diff" + (owner ? "?" + ownerQS(owner) : "")),
  peopleHistory: (owner?: string, days?: number) => {
    const params = [];
    if (owner) params.push(ownerQS(owner));
    if (days) params.push("days=" + days);
    return j<PeopleHistory>("/api/people_history" + (params.length ? "?" + params.join("&") : ""));
  },
  healthHistory: (owner?: string, days?: number) => {
    const params = [];
    if (owner) params.push(ownerQS(owner));
    if (days) params.push("days=" + days);
    return j<HealthHistory>("/api/health_history" + (params.length ? "?" + params.join("&") : ""));
  },
  radar: (owner?: string) =>
    j<Radar | NoSnapshot>("/api/radar" + (owner ? "?" + ownerQS(owner) : "")),
  stargazers: (owner?: string) =>
    j<Stargazers | NoSnapshot>("/api/stargazers" + (owner ? "?" + ownerQS(owner) : "")),
  trending: (since: string, lang?: string, tr?: string, owner?: string, refresh?: boolean) => {
    const params = ["since=" + encodeURIComponent(since)];
    if (lang) params.push("lang=" + encodeURIComponent(lang));
    if (tr) params.push("tr=" + encodeURIComponent(tr));
    if (owner) params.push("owner=" + encodeURIComponent(owner));
    if (refresh) params.push("refresh=1");
    return j<Trending>("/api/trending?" + params.join("&"));
  },
  classify: (owner: string, since?: string) => {
    const params = ["owner=" + encodeURIComponent(owner)];
    if (since) params.push("since=" + encodeURIComponent(since));
    return j<Classify>("/api/classify?" + params.join("&"));
  },
};
