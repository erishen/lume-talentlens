import { describe, it, expect } from "vitest";
import {
  weekStart,
  aggregateWeeks,
  scoreHistoryPoint,
  historyTotals,
} from "../history";
import { DEFAULT_HEALTH_WEIGHTS } from "../talent";
import type { PeopleHistoryPoint, HealthHistoryPoint } from "../types";

function pp(date: string, af: string[] = [], gf: string[] = [], f = 0, g = 0): PeopleHistoryPoint {
  return {
    date,
    ts: date + "T00:00:00Z",
    followers: f,
    following: g,
    added_followers: af,
    gone_followers: gf,
    added_following: [],
    gone_following: [],
  };
}

describe("weekStart", () => {
  it("maps a Friday to that week's Monday (UTC)", () => {
    expect(weekStart("2026-10-16")).toBe("2026-10-12");
  });
  it("maps a Monday to itself", () => {
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });
  it("maps a Sunday back to the preceding Monday", () => {
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
  });
  it("crosses a year boundary", () => {
    expect(weekStart("2026-01-01")).toBe("2025-12-29");
  });
});

describe("aggregateWeeks", () => {
  it("returns [] for empty input", () => {
    expect(aggregateWeeks([], 12)).toEqual([]);
  });

  it("groups days into Monday weeks, newest last", () => {
    const points = [
      pp("2026-10-13", ["a"], [], 2, 0), // week of 10-12
      pp("2026-10-15", ["b"], ["a"], 2, 0), // same week
      pp("2026-10-06", ["c"], [], 5, 0), // week of 10-05
    ];
    const buckets = aggregateWeeks(points, 3);
    expect(buckets.length).toBe(3);
    expect(buckets[buckets.length - 1].key).toBe("2026-10-12");
    expect(buckets[buckets.length - 2].key).toBe("2026-10-05");
    // the oldest in-window week (10-12 - 2w = 09-28) has no data -> empty fill
    expect(buckets[0].key).toBe("2026-09-28");
    expect(buckets[0].days).toBe(0);
  });

  it("sums added/gone and derives net from added-gone", () => {
    const points = [
      pp("2026-10-13", ["a", "b"], ["x"], 2, 0),
      pp("2026-10-15", ["c"], [], 4, 0),
    ];
    const b = aggregateWeeks(points, 1)[0];
    expect(b.added.followers).toBe(3);
    expect(b.gone.followers).toBe(1);
    expect(b.netFollowers).toBe(2); // 3 added - 1 gone
    expect(b.days).toBe(2);
    expect(b.start).toBe("2026-10-13");
    expect(b.end).toBe("2026-10-15");
  });

  it("de-duplicates logins within a week but keeps the raw counts", () => {
    const points = [
      pp("2026-10-13", ["dup"], [], 1, 0),
      pp("2026-10-14", ["dup"], [], 2, 0),
    ];
    const b = aggregateWeeks(points, 1)[0];
    expect(b.addedFollowers).toEqual(["dup"]); // shown once
    expect(b.added.followers).toBe(2); // counted twice
  });

  it("keeps a stable x-axis width even when all weeks are empty except one", () => {
    const points = [pp("2026-10-13", ["a"], [], 1, 0)];
    const buckets = aggregateWeeks(points, 4);
    expect(buckets.length).toBe(4);
    expect(buckets.filter((b) => b.days > 0).length).toBe(1);
  });
});

describe("scoreHistoryPoint", () => {
  const point: HealthHistoryPoint = {
    date: "2026-10-16",
    ts: "",
    total: 0,
    pillars: { activity: 0.5, rigor: 0.5, focus: 0.5, influence: 0.5 },
  };

  it("returns 50 when every pillar is 0.5 (weights normalise out)", () => {
    expect(scoreHistoryPoint(point)).toBe(50);
  });

  it("re-scores with the current weights, normalising by their sum", () => {
    const w = { activity: 1, rigor: 0, focus: 0, influence: 0 };
    expect(scoreHistoryPoint(point, w)).toBe(50);
    const w2 = { activity: 0, rigor: 1, focus: 0, influence: 0 };
    expect(scoreHistoryPoint(point, w2)).toBe(50);
  });

  it("weights the dominant pillar", () => {
    const p: HealthHistoryPoint = {
      date: "x",
      ts: "",
      total: 0,
      pillars: { activity: 1, rigor: 0, focus: 0, influence: 0 },
    };
    expect(scoreHistoryPoint(p, { activity: 1, rigor: 0, focus: 0, influence: 0 })).toBe(100);
    expect(scoreHistoryPoint(p, DEFAULT_HEALTH_WEIGHTS)).toBe(40); // 0.4 * 100
  });

  it("guards a missing pillars object (older / partial record)", () => {
    const p = { date: "x", ts: "", total: 0 } as unknown as HealthHistoryPoint;
    expect(scoreHistoryPoint(p)).toBe(0);
  });
});

describe("historyTotals", () => {
  it("maps every point to its score", () => {
    const pts: HealthHistoryPoint[] = [
      { date: "a", ts: "", total: 30, pillars: { activity: 0.3, rigor: 0.3, focus: 0.3, influence: 0.3 } },
      { date: "b", ts: "", total: 80, pillars: { activity: 0.8, rigor: 0.8, focus: 0.8, influence: 0.8 } },
    ];
    expect(historyTotals(pts)).toEqual([30, 80]);
  });
});
