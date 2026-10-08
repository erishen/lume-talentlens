import { describe, it, expect } from "vitest";
import {
  pct,
  cadence,
  deriveTalent,
  pillarScores,
  healthScore,
  loadHealthWeights,
  toHrNote,
  hrNoteMarkdown,
  DEFAULT_HEALTH_WEIGHTS,
} from "../talent";
import type { Overview, TalentSignals } from "../types";

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

// Direct construction for the health-score layer (it consumes TalentSignals,
// not Overview).
const SIG = (over: Partial<TalentSignals> = {}): TalentSignals =>
  ({
    member_since_year: null,
    tenure_years: null,
    output_ratio: 0,
    avg_days_since_push: -1,
    desc_ratio: 0,
    license_ratio: 0,
    topics_ratio: 0,
    top_lang: "—",
    top_lang_ratio: 0,
    top2_ratio: 0,
    recent_active_ratio: 0,
    secondary_langs: [],
    followers: 0,
    top_star_repo: null,
    labels: [],
    ...over,
  }) as TalentSignals;

describe("pillarScores", () => {
  it("maxes all four pillars on a perfect profile", () => {
    const p = pillarScores(
      SIG({
        recent_active_ratio: 1,
        avg_days_since_push: 0,
        desc_ratio: 1,
        license_ratio: 1,
        topics_ratio: 1,
        top2_ratio: 1,
        followers: 100000,
        top_star_repo: { name: "x", stars: 500 },
      })
    );
    expect(p.activity).toBe(1);
    expect(p.rigor).toBe(1);
    expect(p.focus).toBe(1);
    expect(p.influence).toBe(1);
  });
  it("floors the recency factor at 0.5 for very stale profiles (never zeroes)", () => {
    const p = pillarScores(SIG({ recent_active_ratio: 0, avg_days_since_push: 3650 }));
    // 0.8*0 + 0.2*0.5
    expect(p.activity).toBeCloseTo(0.1, 5);
  });
  it("scales influence on a personal-developer curve (100 followers ≈ strong)", () => {
    const p = pillarScores(SIG({ followers: 100, top_star_repo: null }));
    // log10(101)/2 ≈ 1.002 -> clamped to 1; 0.6*1 + 0.4*0
    expect(p.influence).toBeCloseTo(0.6, 5);
  });
});

describe("healthScore", () => {
  it("returns 100 for a perfect profile with default weights", () => {
    const h = healthScore(
      SIG({ recent_active_ratio: 1, avg_days_since_push: 0, desc_ratio: 1, license_ratio: 1, topics_ratio: 1, top2_ratio: 1, followers: 100000, top_star_repo: { name: "x", stars: 500 } })
    );
    expect(h.total).toBe(100);
  });
  it("weights activity strongest (default 0.4)", () => {
    // everything 0 except activity 1 -> total = 40
    const h = healthScore(SIG({ recent_active_ratio: 1, avg_days_since_push: 0 }));
    expect(h.total).toBe(40);
  });
  it("normalizes non-default weight sums (all-zero weights -> defaults)", () => {
    const h = healthScore(SIG({}), { activity: 0, rigor: 0, focus: 0, influence: 0 });
    expect(h.total).toBeGreaterThanOrEqual(0);
    expect(h.total).toBeLessThanOrEqual(100);
  });
});

describe("loadHealthWeights", () => {
  it("returns defaults when storage is unavailable (node has no localStorage)", () => {
    expect(loadHealthWeights()).toEqual(DEFAULT_HEALTH_WEIGHTS);
  });
});

describe("toHrNote / hrNoteMarkdown", () => {
  it("renders a bilingual copy-ready note from an overview", () => {
    const ov = MIN_OV({ count: 10, non_fork_count: 8, languages: { TypeScript: 8, Python: 2 }, recency: { active: 5 } });
    const t = deriveTalent(ov, "zh");
    const zh = toHrNote(ov, t, DEFAULT_HEALTH_WEIGHTS, "zh");
    expect(zh).toContain("@demo");
    expect(zh).toContain("开源人才画像");
    expect(zh).toContain("10 个公开仓库");
    expect(zh).toContain("开源健康度");
    const en = toHrNote(ov, t, DEFAULT_HEALTH_WEIGHTS, "en");
    expect(en).toContain("@demo");
    expect(en).toContain("open-source talent read");
    expect(en).toContain("public repos");
  });
  it("wraps the note in a Markdown document with weights footnote", () => {
    const ov = MIN_OV({ count: 5 });
    const t = deriveTalent(ov);
    const md = hrNoteMarkdown(ov, t, DEFAULT_HEALTH_WEIGHTS, "zh");
    expect(md.startsWith("# 开源人才画像 — @demo")).toBe(true);
    expect(md).toContain("权重 — 活跃 40% · 严谨 30% · 专注 20% · 影响 10%");
  });
});
