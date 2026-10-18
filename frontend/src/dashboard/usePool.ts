import React from "react";
import { api } from "../api";
import type { Overview, NoSnapshot } from "../types";
import { isNoSnapshot } from "../types";
import { fetchLive } from "../live";
import { deriveTalent, healthScore } from "../talent";
import type { Lang } from "../i18n";
import type { HealthWeights } from "../talent";
import { parsePoolNames, rankPool, poolFrac, type PoolProgress } from "./pool";
import type { PoolRow } from "./useDashboard";

export function usePool(lang: Lang, weights: HealthWeights) {
  const poolSeq = React.useRef(0);
  const [poolInput, setPoolInput] = React.useState("");
  const [poolLoading, setPoolLoading] = React.useState(false);
  const [poolProgress, setPoolProgress] = React.useState<PoolProgress | null>(null);
  const [pool, setPool] = React.useState<PoolRow[]>([]);

  // Load an N-person candidate pool: several owners, ranked by health score.
  // Owners are fetched in PARALLEL — the getGithub throttle in live.ts caps
  // concurrency (3) and paces unauthenticated requests so a big pool doesn't
  // burn the 60 req/h limit; a 429/403 trips the breaker and the rest fail
  // fast. Each owner mirrors the primary path (snapshot first, live when
  // uncached).
  async function loadPool(raw: string) {
    const names = parsePoolNames(raw);
    if (names.length === 0) return;
    const seq = ++poolSeq.current;
    setPoolLoading(true);
    setPool([]);
    setPoolProgress({ done: 0, total: names.length });

    const rows: PoolRow[] = names.map((n) => ({
      target: n,
      ov: null,
      score: 0,
      err: "",
    }));
    let done = 0;

    await Promise.all(
      rows.map(async (row) => {
        let ov: Overview | null = null;
        let errMsg = "";
        try {
          const r = await api.overview(row.target);
          if (isNoSnapshot(r)) {
            const res = await fetchLive(row.target, undefined, (p) => {
              if (seq === poolSeq.current) {
                // merge the current owner's repo-page progress into the bar:
                // show "fetching @x (repos page 2/3)" while paging through
                setPoolProgress({ done, total: names.length, curOwner: row.target, curPage: p.page, curTotal: p.total });
              }
            });
            ov = res.overview;
          } else {
            ov = r as Overview;
          }
        } catch (e) {
          errMsg = String((e as Error)?.message || e);
        }
        row.ov = ov;
        row.err = errMsg;
        row.score = ov ? healthScore(deriveTalent(ov, lang)).total : 0;
        done += 1;
        if (seq === poolSeq.current) {
          setPoolProgress({ done, total: names.length });
        }
      })
    );

    if (seq !== poolSeq.current) return; // superseded by a newer pool run
    rows.sort((a, b) => b.score - a.score);
    setPool(rows);
    setPoolProgress(null);
    setPoolLoading(false);
  }

  const rankedPool = rankPool(pool, lang, weights);
  const frac = poolFrac(poolProgress);

  return {
    poolInput, setPoolInput,
    poolLoading, poolProgress, pool, setPool,
    rankedPool,
    poolFrac: frac,
    loadPool,
  };
}
