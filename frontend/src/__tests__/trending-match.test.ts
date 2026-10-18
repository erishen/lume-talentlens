import { describe, it, expect } from "vitest";
import { buildProfile, matchScore, matchDetail } from "../dashboard/trending";

// personalization: the trending feed is scored against the owner's own
// language distribution + repo topics. These pin the math.

const ov = {
  languages: { TypeScript: 10, Python: 5, Go: 2 },
  top_by_stars: [
    { topics: ["ai", "cli"], lang: "TypeScript" },
  ],
  top_by_activity: [
    { topics: ["react", "cli"], lang: "TypeScript" },
  ],
};

describe("buildProfile", () => {
  it("normalizes language weights so the top language is 1.0", () => {
    const p = buildProfile(ov)!;
    expect(p.langs.TypeScript).toBe(1);
    expect(p.langs.Python).toBeCloseTo(0.5);
    expect(p.langs.Go).toBeCloseTo(0.2);
  });
  it("collects the lowercased topic set from top repos", () => {
    const p = buildProfile(ov)!;
    expect([...p.topics].sort()).toEqual(["ai", "cli", "react"]);
  });
  it("returns null when there are no languages / no ov", () => {
    expect(buildProfile(null)).toBeNull();
    expect(buildProfile({ languages: {} })).toBeNull();
  });
});

describe("matchScore", () => {
  const p = buildProfile(ov)!;
  it("scores a same-language + overlapping-topics repo high", () => {
    const s = matchScore({ lang: "TypeScript", topics: ["ai", "cli"] }, p);
    // language 60 (weight 1.0) + topics 40 (2/2 hit) = 100
    expect(s).toBe(100);
  });
  it("gives partial credit for a non-top language", () => {
    const s = matchScore({ lang: "Go", topics: [] }, p);
    expect(s).toBe(12); // 0.2 * 60
  });
  it("scores an unrelated repo zero", () => {
    expect(matchScore({ lang: "Fortran", topics: ["games"] }, p)).toBe(0);
  });
  it("scales topic credit by how many of the repo's topics overlap", () => {
    const s = matchScore({ lang: "", topics: ["cli", "zzz"] }, p);
    expect(s).toBe(20); // 1/2 * 40
  });
  it("returns 0 without a profile", () => {
    expect(matchScore({ lang: "TypeScript", topics: ["ai"] }, null)).toBe(0);
  });
});

describe("matchDetail", () => {
  const p = buildProfile(ov)!;
  it("reports the matched language and overlapping topics", () => {
    const d = matchDetail({ lang: "TypeScript", topics: ["ai", "cli", "x"] }, p);
    expect(d.lang).toBe("TypeScript");
    expect(d.topics).toEqual(["ai", "cli"]);
  });
  it("reports nothing without a profile", () => {
    expect(matchDetail({ lang: "Go", topics: ["cli"] }, null)).toEqual({ lang: null, topics: [] });
  });
});
