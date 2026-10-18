// dashboard/pool.ts — pure helpers for candidate-pool ranking and progress.
// Unit-testable; extracted from useDashboard.ts to trim the hook.
import { deriveTalent, healthScore } from "../talent";
import type { Overview } from "../types";
import type { Lang } from "../i18n";
import type { HealthWeights } from "../talent";
import type { PoolRow } from "./useDashboard";

export function parsePoolNames(raw: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

export function rankPool(rows: PoolRow[], lang: Lang, weights: HealthWeights): PoolRow[] {
  const out = rows.map((p) => ({
    ...p,
    score: p.ov ? healthScore(deriveTalent(p.ov, lang), weights).total : 0,
  }));
  return out.sort((a, b) => b.score - a.score);
}

export interface PoolProgress {
  done: number;
  total: number;
  curOwner?: string;
  curPage?: number;
  curTotal?: number;
}

export function poolFrac(progress: PoolProgress | null): number {
  if (!progress) return 0;
  if (progress.curTotal) {
    const curPart = Math.min(progress.curPage ?? 0, progress.curTotal) / progress.curTotal;
    return Math.min(1, (progress.done + curPart) / Math.max(1, progress.total));
  }
  return progress.done / Math.max(1, progress.total);
}
