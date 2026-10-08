import { describe, it, expect } from "vitest";
import { pct, cadence, deriveTalent } from "../talent";
import type { Overview } from "../types";

// Minimal Overview; fields deriveTalent reads are optional-ish (guarded with
// ?. / ??), so an empty profile/languages/totals object is a valid input.
const MIN_OV = (over: Partial<Overview> = {}): Overview =>
  ({
    owner: "demo",
    fetched_at: "2026-01-01T00:00:00Z",
    profile: {},
    languages: {},
    recency: {},
    totals: {},
    non_fork_count: 0,
    top_by_stars: [],
    ...over,
  }) as Overview;

describe("pct", () => {
  it("formats 0..1 as integer percent", () => {
    expect(pct(0.5)).toBe("50%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
  });
  it("rounds (no decimals)", () => {
    expect(pct(1.234)).toBe("123%");
    expect(pct(0.999)).toBe("100%");
  });
});

describe("cadence", () => {
  it("bounds the buckets on the exact thresholds (en)", () => {
    expect(cadence(-1)).toBe("unknown cadence");
    expect(cadence(0)).toBe("pushing this month");
    expect(cadence(30)).toBe("pushing this month");
    expect(cadence(31)).toBe("active this quarter");
    expect(cadence(90)).toBe("active this quarter");
    expect(cadence(91)).toBe("pushed within a year");
    expect(cadence(365)).toBe("pushed within a year");
    expect(cadence(366)).toBe("last push 12 months ago");
  });
  it("uses the zh dictionary when requested", () => {
    expect(cadence(400, "zh")).toBe("13 个月前有推送");
    expect(cadence(0, "zh")).toBe("本月有推送");
  });
});

describe("deriveTalent", () => {
  it("derives all recruit-facing labels from a rich overview (en)", () => {
    const ov = MIN_OV({
      count: 10,
      non_fork_count: 20,
      languages: { TypeScript: 6, Python: 3, Rust: 1 },
      recency: { active: 3 },
      totals: { archived: 1, forked: 2 },
      talent: { with_desc: 8, with_license: 5, with_topics: 4, avg_days_since_push: 12 },
      profile: { followers: 100, created_at: "2015-04-01T00:00:00Z" },
      top_by_stars: [{ name: "demo-app", stars: 42 }],
    });
    const t = deriveTalent(ov, "en");
    // labels: active>0, archived>0, forked>0, desc 8/10>=.8, lic 5/10>=.4,
    // topics 4/10>=.4, non_fork 20<=20, followers 100>=100
    expect(t.labels).toEqual([
      "Active maintainer",
      "Has archived projects",
      "Curates via forks",
      "Documents work",
      "Open-sources with licenses",
      "Tags topics",
      "Focused portfolio",
      "Followed community",
    ]);
    expect(t.top_lang).toBe("TypeScript");
    expect(t.top2_ratio).toBeCloseTo(0.9, 5);
    expect(t.output_ratio).toBeCloseTo(0.3, 5);
    expect(t.desc_ratio).toBeCloseTo(0.8, 5);
    expect(t.license_ratio).toBeCloseTo(0.5, 5);
    expect(t.topics_ratio).toBeCloseTo(0.4, 5);
    expect(t.member_since_year).toBe(2015);
    expect(t.top_star_repo).toEqual({ name: "demo-app", stars: 42 });
  });
  it("does not flag anything on an empty overview", () => {
    const t = deriveTalent(MIN_OV(), "zh");
    expect(t.labels).toEqual([]);
    expect(t.top_lang).toBe("—");
    expect(t.top_lang_ratio).toBe(0);
    expect(t.member_since_year).toBeNull();
    expect(t.top_star_repo).toBeNull();
  });
  it("honours the zh dictionary for labels", () => {
    const ov = MIN_OV({
      count: 2,
      non_fork_count: 1,
      recency: { active: 1 },
      profile: { followers: 200 },
    });
    const t = deriveTalent(ov, "zh");
    expect(t.labels).toContain("活跃维护者");
    expect(t.labels).toContain("专注型作品集");
    expect(t.labels).toContain("社区关注度高");
  });
});
