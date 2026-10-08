import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLiveProfile, fetchLiveRepos, ghTrippedNow, resetGhThrottle } from "../live";

// Mock global fetch: the live proxy and the auth probe. Envelope mirrors
// what app/lib/live.lume returns ({ ok, status, data, err }). The proxy
// encodes ?path=, so match on the decoded path parameter specifically
// (a bare URL substring would let /users/me shadow /users/me/repos…).
function mockFetchRoutes(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const pathMatch = url.match(/[?&]path=([^&]*)/);
    const hay = pathMatch ? decodeURIComponent(pathMatch[1]) : decodeURIComponent(url);
    if (hay.includes("/api/github_auth")) {
      return jsonResponse({ authed: true }); // authed → relaxed throttle for fast tests
    }
    for (const [needle, payload] of Object.entries(routes).sort((a, b) => b[0].length - a[0].length)) {
      if (hay.includes(needle)) {
        return jsonResponse({
          ok: true,
          status: 200,
          data: JSON.stringify(payload),
          err: "",
        });
      }
    }
    return jsonResponse({ ok: false, status: 404, data: "", err: "no route in test" });
  }));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetGhThrottle();
});

describe("fetchLiveProfile", () => {
  it("returns user + lastPush + estimated pages", async () => {
    mockFetchRoutes({
      "/users/me": { login: "me", name: "Me", public_repos: 250 },
      "/repos?type=owner&sort=pushed": [{ pushed_at: "2026-09-10T00:00:00Z" }],
    });
    const p = await fetchLiveProfile("me");
    expect(p.user.login).toBe("me");
    expect(p.lastPush).toBe("2026-09-10T00:00:00Z");
    expect(p.estTotal).toBe(3); // ceil(250/100)
  });

  it("degrades a null profile and failed repo call to safe defaults", async () => {
    mockFetchRoutes({
      "/users/me": null,
      "/repos?type=owner&sort=pushed": null,
    });
    const p = await fetchLiveProfile("me");
    expect(p.user).toEqual({});
    expect(p.lastPush).toBe("");
    expect(p.estTotal).toBe(0);
  });

  it("trips the circuit breaker on 429 and throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, status: 429, data: "", err: "rate limit" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ));
    await expect(fetchLiveProfile("me")).rejects.toThrow(/rate limit/i);
    expect(ghTrippedNow()).toBe(true);
  });

  it("throws a clear error when the proxy is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(fetchLiveProfile("me")).rejects.toThrow(/make dev/);
  });
});

describe("fetchLiveRepos", () => {
  it("paginates until a short page, reporting progress", async () => {
    const pages: Record<string, unknown> = {};
    for (let page = 1; page <= 2; page++) {
      const batch = Array.from({ length: 100 }, (_, i) => ({
        name: "r" + ((page - 1) * 100 + i),
        pushed_at: "2026-09-01T00:00:00Z",
      }));
      if (page === 2) batch.length = 40; // short page ends the loop
      pages["/repos?type=owner&sort=updated&per_page=100&page=" + page] = batch;
    }
    mockFetchRoutes(pages);
    const progress: { page: number; repos: number }[] = [];
    const repos = await fetchLiveRepos("me", 2, undefined, (p) => progress.push(p));
    expect(repos).toHaveLength(140);
    expect(progress).toHaveLength(2);
    expect(progress[0]).toEqual({ page: 1, total: 2, repos: 100 });
    expect(progress[1].repos).toBe(140);
  });

  it("stops at the 10-page cap", async () => {
    const pages: Record<string, unknown> = {};
    for (let page = 1; page <= 11; page++) {
      pages["/repos?type=owner&sort=updated&per_page=100&page=" + page] = Array.from(
        { length: 100 },
        (_, i) => ({ name: "r" + page + "-" + i, pushed_at: "2026-09-01T00:00:00Z" })
      );
    }
    mockFetchRoutes(pages);
    const repos = await fetchLiveRepos("me", 99);
    expect(repos).toHaveLength(1000); // capped at 10 pages
  });
});
