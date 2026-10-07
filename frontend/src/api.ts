import type {
  Overview,
  RepoPage,
  SearchResult,
  OwnerList,
  People,
  PeopleDiff,
  PersonView,
  NoSnapshot,
  Radar,
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

export const api = {
  owners: () => j<OwnerList>("/api/owners"),
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
  radar: (owner?: string) =>
    j<Radar | NoSnapshot>("/api/radar" + (owner ? "?" + ownerQS(owner) : "")),
};
