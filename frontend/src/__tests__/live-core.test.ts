import { describe, it, expect } from "vitest";
import {
  recencyBucket,
  toView,
  pushTrend,
  searchLocal,
  buildOverview,
  buildOverviewPartial,
  readLiveCache,
  writeLiveCache,
  LIVE_CACHE_TTL_MS,
  type LiveCacheStore,
  type LiveResult,
} from "../live-core";

function memStore(): LiveCacheStore {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
  };
}

function sampleRepo(over: Record<string, unknown> = {}) {
  return {
    name: "demo",
    full_name: "me/demo",
    language: null,
    license: { spdx_id: "MIT" },
    stargazers_count: 5,
    forks_count: 2,
    open_issues_count: 1,
    fork: false,
    archived: false,
    description: "a demo repo",
    topics: ["ai", "tools"],
    updated_at: "2026-09-01T00:00:00Z",
    pushed_at: "2026-09-15T00:00:00Z",
    created_at: "2024-03-01T00:00:00Z",
    html_url: "https://github.com/me/demo",
    size: 42,
    ...over,
  };
}

describe("recencyBucket", () => {
  it("maps day ranges to buckets", () => {
    expect(recencyBucket(-1)).toBe("unknown");
    expect(recencyBucket(0)).toBe("active");
    expect(recencyBucket(90)).toBe("active");
    expect(recencyBucket(91)).toBe("recent");
    expect(recencyBucket(365)).toBe("recent");
    expect(recencyBucket(366)).toBe("dormant");
    expect(recencyBucket(730)).toBe("dormant");
    expect(recencyBucket(731)).toBe("stale");
  });
});

describe("toView", () => {
  it("normalises null language and license", () => {
    const v = toView(sampleRepo());
    expect(v.lang).toBe("");
    expect(v.license).toBe("MIT");
  });

  it("marks NOASSERTION / empty license as Custom", () => {
    expect(toView(sampleRepo({ license: { spdx_id: "NOASSERTION" } })).license).toBe("Custom");
    expect(toView(sampleRepo({ license: null })).license).toBe("None");
  });

  it("derives recency from push date and push_month", () => {
    const v = toView(sampleRepo({ pushed_at: "2026-08-20T00:00:00Z" }));
    expect(v.recency).toBe("active");
    expect(v.push_month).toBe("2026-08");
    expect(v.days_since_push).toBeGreaterThan(0);
  });

  it("keeps forks/archived flags", () => {
    expect(toView(sampleRepo({ fork: true, archived: true })).is_fork).toBe(true);
    expect(toView(sampleRepo({ fork: true, archived: true })).archived).toBe(true);
  });
});

describe("pushTrend", () => {
  it("counts repos by push month, skipping empties", () => {
    const repos = [
      toView(sampleRepo({ pushed_at: "2026-08-01T00:00:00Z" })),
      toView(sampleRepo({ pushed_at: "2026-08-02T00:00:00Z" })),
      toView(sampleRepo({ pushed_at: "2026-07-01T00:00:00Z" })),
      toView(sampleRepo({ pushed_at: null })),
    ];
    expect(pushTrend(repos)).toEqual({ "2026-08": 2, "2026-07": 1 });
  });
});

describe("searchLocal", () => {
  const repos = [
    toView(sampleRepo({ name: "alpha", description: "machine learning" })),
    toView(sampleRepo({ name: "beta", language: "rust", topics: ["cli"] })),
  ];

  it("matches case-insensitively across fields", () => {
    expect(searchLocal(repos, "MACHINE")).toHaveLength(1);
    expect(searchLocal(repos, "rust")).toHaveLength(1);
    expect(searchLocal(repos, "cli")).toHaveLength(1);
  });

  it("empty query returns everything", () => {
    expect(searchLocal(repos, "")).toHaveLength(2);
  });
});

describe("buildOverview", () => {
  it("excludes archived and forked repos from counts", () => {
    const reposRaw = [
      sampleRepo(),
      sampleRepo({ name: "arch", archived: true, stargazers_count: 99 }),
      sampleRepo({ name: "fork", fork: true, stargazers_count: 99 }),
    ];
    const ov = buildOverview("me", { name: "Me" }, "", reposRaw, false);
    expect(ov.count).toBe(1);
    expect(ov.non_fork_count).toBe(1);
    expect(ov.totals.stars).toBe(5);
    expect(ov.totals.archived).toBe(0); // excluded from `all`
    expect(ov.totals.forked).toBe(0);
  });

  it("computes totals and top-by-stars", () => {
    const reposRaw = [
      sampleRepo({ name: "small", stargazers_count: 1 }),
      sampleRepo({ name: "big", stargazers_count: 50 }),
    ];
    const ov = buildOverview("me", {}, "", reposRaw, false);
    expect(ov.totals.stars).toBe(51);
    expect(ov.totals.forks).toBe(4);
    expect(ov.top_by_stars[0].name).toBe("big");
  });

  it("partial build has no repo stats", () => {
    const ov = buildOverviewPartial("me", { name: "Me", followers: 10 }, "2026-09-01");
    expect(ov.partial).toBe(true);
    expect(ov.count).toBe(0);
    expect(ov.profile.followers).toBe(10);
    expect(ov.profile.last_push).toBe("2026-09-01");
  });

  it("fills profile fields from the raw user object", () => {
    const ov = buildOverview("me", { name: "N", bio: "b", hireable: true, public_repos: 3 }, "", [], false);
    expect(ov.profile.name).toBe("N");
    expect(ov.profile.bio).toBe("b");
    expect(ov.profile.hireable).toBe(true);
    expect(ov.profile.public_repos).toBe(3);
  });
});

describe("live cache (browser-side)", () => {
  function fakeResult(owner: string): LiveResult {
    return {
      overview: buildOverview(owner, { name: owner }, "", [], false),
      all: [],
    };
  }

  it("round-trips a result within TTL", () => {
    const store = memStore();
    const t0 = 1_000_000;
    writeLiveCache("me", fakeResult("me"), store, t0);
    const hit = readLiveCache("me", store, t0 + LIVE_CACHE_TTL_MS - 1);
    expect(hit).not.toBeNull();
    expect(hit?.overview.owner).toBe("me");
  });

  it("expires after TTL", () => {
    const store = memStore();
    const t0 = 1_000_000;
    writeLiveCache("me", fakeResult("me"), store, t0);
    expect(readLiveCache("me", store, t0 + LIVE_CACHE_TTL_MS + 1)).toBeNull();
  });

  it("is per-owner", () => {
    const store = memStore();
    writeLiveCache("alice", fakeResult("alice"), store, 1);
    expect(readLiveCache("bob", store, 1)).toBeNull();
    expect(readLiveCache("alice", store, 1)?.overview.owner).toBe("alice");
  });

  it("survives a broken store (degrades to null, not a throw)", () => {
    const broken: LiveCacheStore = {
      get: () => {
        throw new Error("quota");
      },
      set: () => {
        throw new Error("quota");
      },
    };
    expect(readLiveCache("me", broken)).toBeNull();
    expect(() => writeLiveCache("me", fakeResult("me"), broken)).not.toThrow();
  });
});
