// history.ts — pure helpers for the two daily timelines.
//
//   people  (/api/people_history): per-day follower/following adds & gones
//   health  (/api/health_history): per-day pillars, re-scoreable with the
//           user's current weights (the stored pillars are weight-independent).
//
// Kept dependency-light and side-effect-free so it is unit-testable under
// vitest without a DOM (see __tests__/history.test.ts).

import type { PeopleHistoryPoint, HealthHistoryPoint } from "./types";
import type { HealthWeights } from "./talent";
import { DEFAULT_HEALTH_WEIGHTS } from "./talent";

const DAY_MS = 86400000;

// Parse "YYYY-MM-DD" as a UTC-midnight timestamp. Using UTC (not the local
// zone) avoids off-by-one day shifts when bucketing into weeks on machines
// west of UTC.
function dayMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || "");
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Monday (UTC) of the week a date falls into, as "YYYY-MM-DD".
export function weekStart(date: string): string {
  const ms = dayMs(date);
  if (Number.isNaN(ms)) return date;
  const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;
  return isoDate(monday);
}

export interface WeekBucket {
  key: string;   // Monday (UTC) of the week, "YYYY-MM-DD"
  label: string; // "MM-DD" for display
  start: string; // first point's date in the bucket
  end: string;   // last point's date in the bucket
  days: number;  // how many daily points landed in this bucket
  added: { followers: number; following: number };
  gone: { followers: number; following: number };
  netFollowers: number;
  netFollowing: number;
  // de-duplicated logins (for the click-through list)
  addedFollowers: string[];
  goneFollowers: string[];
  addedFollowing: string[];
  goneFollowing: string[];
}

function emptyBucket(key: string): WeekBucket {
  return {
    key,
    label: key.slice(5),
    start: key,
    end: key,
    days: 0,
    added: { followers: 0, following: 0 },
    gone: { followers: 0, following: 0 },
    netFollowers: 0,
    netFollowing: 0,
    addedFollowers: [],
    goneFollowers: [],
    addedFollowing: [],
    goneFollowing: [],
  };
}

function bucketFrom(key: string, pts: PeopleHistoryPoint[]): WeekBucket {
  const first = pts[0];
  const last = pts[pts.length - 1];
  const addF = new Set<string>();
  const goneF = new Set<string>();
  const addG = new Set<string>();
  const goneG = new Set<string>();
  let aF = 0;
  let gF = 0;
  let aG = 0;
  let gG = 0;
  for (const p of pts) {
    aF += p.added_followers?.length ?? 0;
    gF += p.gone_followers?.length ?? 0;
    aG += p.added_following?.length ?? 0;
    gG += p.gone_following?.length ?? 0;
    for (const l of p.added_followers ?? []) addF.add(l);
    for (const l of p.gone_followers ?? []) goneF.add(l);
    for (const l of p.added_following ?? []) addG.add(l);
    for (const l of p.gone_following ?? []) goneG.add(l);
  }
  return {
    key,
    label: key.slice(5),
    start: first.date,
    end: last.date,
    days: pts.length,
    added: { followers: aF, following: aG },
    gone: { followers: gF, following: gG },
    // net count change == (people added) - (people gone) — independent of the
    // snapshot counters, so it stays meaningful even for a single-day bucket.
    netFollowers: aF - gF,
    netFollowing: aG - gG,
    addedFollowers: Array.from(addF).sort(),
    goneFollowers: Array.from(goneF).sort(),
    addedFollowing: Array.from(addG).sort(),
    goneFollowing: Array.from(goneG).sort(),
  };
}

// Group daily points into the last `weeks` calendar weeks (Monday-based),
// newest last. Missing weeks inside the window are filled with empty buckets
// so the chart keeps a stable x-axis. Empty input → [].
export function aggregateWeeks(points: PeopleHistoryPoint[], weeks = 12): WeekBucket[] {
  if (!points || points.length === 0) return [];
  const asc = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byKey = new Map<string, PeopleHistoryPoint[]>();
  for (const p of asc) {
    const k = weekStart(p.date);
    const arr = byKey.get(k);
    if (arr) arr.push(p);
    else byKey.set(k, [p]);
  }
  const keys = Array.from(byKey.keys()).sort();
  const newest = keys[keys.length - 1];
  const newestMs = dayMs(newest);
  if (Number.isNaN(newestMs)) return [];
  const out: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const k = isoDate(newestMs - i * 7 * DAY_MS);
    const pts = byKey.get(k);
    out.push(pts ? bucketFrom(k, pts) : emptyBucket(k));
  }
  return out;
}

// Re-score one stored health point under the CURRENT weights. Mirrors
// talent.healthScore's normalisation (divide by the weight sum, ×100) so the
// history line and the live score stay on the same scale when an HR team
// re-balances the sliders.
export function scoreHistoryPoint(
  p: HealthHistoryPoint,
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS
): number {
  const pil = p.pillars ?? { activity: 0, rigor: 0, focus: 0, influence: 0 };
  const sumW = w.activity + w.rigor + w.focus + w.influence || 1;
  return Math.round(
    ((pil.activity * w.activity +
      pil.rigor * w.rigor +
      pil.focus * w.focus +
      pil.influence * w.influence) /
      sumW) *
      100
  );
}

// The health series (0..100 per day) for the sparkline.
export function historyTotals(
  points: HealthHistoryPoint[],
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS
): number[] {
  return (points ?? []).map((p) => scoreHistoryPoint(p, w));
}
