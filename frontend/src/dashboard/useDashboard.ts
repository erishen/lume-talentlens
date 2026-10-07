// useDashboardData — all dashboard data-loading logic, extracted from the
// render component (Dashboard.tsx). Owns the state, the request-sequence
// guards (latest load wins when owners switch fast), and the derived pool
// ranking. Dashboard.tsx now only renders JSX against this hook.
import React from "react";
import { api } from "../api";
import type { Overview, RepoView, NoSnapshot, People, PeopleDiff, Radar } from "../types";
import { isNoSnapshot } from "../types";
import { fetchLive, fetchLivePeople, searchLocal, type LiveResult, type LiveProgress } from "../live";
import { deriveTalent, healthScore, loadHealthWeights, saveHealthWeights, type HealthWeights } from "../talent";
import type { Lang } from "../i18n";

// t: the i18n translate function (useT()); typed inline to avoid exporting
// a named type from i18n.ts just for this hook.
type T = (key: string, params?: Record<string, string | number>) => string;

export interface PoolRow {
  target: string;
  ov: Overview | null;
  score: number;
  err: string;
}

export function useDashboardData(t: T, lang: Lang) {
  const [owner, setOwner] = React.useState("");
  const [cached, setCached] = React.useState<string[]>([]);
  // request-sequence guards: the latest load wins, older in-flight responses
  // are dropped instead of clobbering the view when the user switches owners
  // quickly (or compares several candidates in a row).
  const reqSeq = React.useRef(0);
  const cmpSeq = React.useRef(0);
  const poolSeq = React.useRef(0);
  const peopleSeq = React.useRef(0);
  const searchSeq = React.useRef(0);
  // recruiting-scoring weights — an HR-team preference, persisted per browser
  const [weights, setWeights] = React.useState<HealthWeights>(() => loadHealthWeights());
  React.useEffect(() => {
    saveHealthWeights(weights);
  }, [weights]);
  const [ov, setOv] = React.useState<Overview | null>(null);
  const [live, setLive] = React.useState<LiveResult | null>(null);
  const [noSnap, setNoSnap] = React.useState<NoSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [liveLoading, setLiveLoading] = React.useState(false);
  const [liveErr, setLiveErr] = React.useState("");
  const [liveProgress, setLiveProgress] = React.useState<LiveProgress | null>(null);
  const [err, setErr] = React.useState("");
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<RepoView[]>([]);
  const [hitsTotal, setHitsTotal] = React.useState(0);
  const [searched, setSearched] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [limit, setLimit] = React.useState(20);
  const [people, setPeople] = React.useState<People | null>(null);
  const [peopleLoading, setPeopleLoading] = React.useState(false);
  const [peopleError, setPeopleError] = React.useState("");
  const [peopleDiff, setPeopleDiff] = React.useState<PeopleDiff | null>(null);
  const [radar, setRadar] = React.useState<Radar | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshMsg, setRefreshMsg] = React.useState("");

  // side-by-side compare with a second candidate (B)
  const [cmp, setCmp] = React.useState<{ target: string; ov: Overview | null; loading: boolean; err: string }>({
    target: "",
    ov: null,
    loading: false,
    err: "",
  });

  // N-person candidate pool: enter several owners, rank them by health score
  const [poolInput, setPoolInput] = React.useState("");
  const [poolLoading, setPoolLoading] = React.useState(false);
  const [poolProgress, setPoolProgress] = React.useState<{
    done: number; total: number;
    curOwner?: string; curPage?: number; curTotal?: number;
  } | null>(null);
  const [pool, setPool] = React.useState<PoolRow[]>([]);

  // Ask the server to re-fetch this owner's followers/following (server-side
  // /api/refresh — rate-limited to one run per owner per 60s), then reload
  // the local snapshot. People data is a cache, not live.
  async function onRefresh() {
    const target = owner.trim();
    if (!target || refreshing) return;
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const res = await fetch("/api/refresh?owner=" + encodeURIComponent(target));
      const j = await res.json().catch(() => null);
      if (j && j.ok) {
        setRefreshMsg(t("people.refresh_ok", { followers: j.followers, following: j.following }));
        loadPeople(target, !!live);
      } else if (j && j.status === 429) {
        setRefreshMsg(t("people.refresh_cooldown", { wait: Math.max(1, Math.ceil(j.wait || 60)) }));
      } else {
        setRefreshMsg(t("people.refresh_fail"));
      }
    } catch {
      setRefreshMsg(t("people.refresh_fail"));
    } finally {
      setRefreshing(false);
    }
  }

  function loadPeople(o: string, viaLive: boolean) {
    const seq = ++peopleSeq.current;
    setPeople(null);
    setPeopleError("");
    setPeopleLoading(true);
    setRadar(null);
    const target = o.trim();
    if (!target) return;
    if (viaLive) {
      loadLivePeople(target, seq);
      return;
    }
    api.people(target).then((r) => {
      if (seq !== peopleSeq.current) return;
      if (isNoSnapshot(r)) {
        loadLivePeople(target, seq);
        return;
      }
      setPeople(r as People);
      setPeopleLoading(false);
      // network change diff rides along — best-effort, failures are silent
      api.peopleDiff(target).then((d) => {
        if (seq === peopleSeq.current && d && d.ok) setPeopleDiff(d);
      }).catch(() => {});
      // talent-radar profit patterns — best-effort; 404 (no make radar yet)
      // just leaves the panel hidden
      api.radar(target).then((rr) => {
        if (seq === peopleSeq.current && rr && !isNoSnapshot(rr)) setRadar(rr as Radar);
      }).catch(() => {});
    }).catch(() => {
      if (seq !== peopleSeq.current) return;
      // /api/people unavailable (older server) → live fallback
      loadLivePeople(target, seq);
    });
  }

  // browser-side people fetch (live owners + fallback when server lacks route).
  // GitHub may be rate-limited / unreachable (e.g. from mainland China); in
  // that case we surface an explicit error state instead of silent emptiness.
  function loadLivePeople(o: string, seq?: number) {
    const target = o.trim();
    if (!target) return;
    const s = seq ?? ++peopleSeq.current;
    fetchLivePeople(target).then((p) => {
      if (s !== peopleSeq.current) return;
      if (p.followers.length === 0 && p.following.length === 0) {
        setPeople(p);
        setPeopleError(t("live.error_network"));
      } else {
        setPeople(p);
        setPeopleError("");
      }
      setPeopleLoading(false);
    }).catch(() => {
      if (s !== peopleSeq.current) return;
      setPeople(null);
      setPeopleError(t("live.error_failed"));
      setPeopleLoading(false);
    });
  }

  // resolve an owner: prefer its local snapshot; if absent, fetch live in the
  // browser (so ANY typed owner works without a pre-baked snapshot).
  function loadOverview(o: string) {
    const target = o.trim();
    if (!target) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setErr("");
    setNoSnap(null);
    setOv(null);
    setLive(null);
    setLiveErr("");
    api.overview(target).then((r) => {
      if (seq !== reqSeq.current) return; // superseded by a newer load
      if (isNoSnapshot(r)) {
        // no local snapshot — fall back to a live browser fetch
        setNoSnap(r as NoSnapshot);
        setLoading(false);
        return;
      }
      setOv(r as Overview);
      loadPeople(target, false);
      setLoading(false);
    }).catch((e) => {
      if (seq !== reqSeq.current) return;
      setErr(e.message);
      setLoading(false);
    });
  }

  async function loadLive(o: string) {
    const target = o.trim();
    if (!target) return;
    const seq = ++reqSeq.current;
    setLiveLoading(true);
    setLiveErr("");
    setNoSnap(null);
    setLiveProgress(null);
    try {
      const res = await fetchLive(target, undefined, (p) => {
        if (seq === reqSeq.current) setLiveProgress(p);
      });
      if (seq !== reqSeq.current) return;
      setOv(res.overview);
      setLive(res);
      setLiveProgress(null);
      loadPeople(target, true);
      setLoading(false);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setLiveErr(e instanceof Error ? e.message : String(e));
      setOv(null);
      setLive(null);
      setLoading(false);
    } finally {
      if (seq === reqSeq.current) setLiveLoading(false);
    }
  }

  // Load a second candidate for side-by-side comparison. Mirrors the primary
  // path: local snapshot first, live browser fetch when uncached.
  async function loadCompare(o: string) {
    const target = o.trim();
    if (!target) return;
    const seq = ++cmpSeq.current;
    setCmp({ target, ov: null, loading: true, err: "" });
    let r: Overview | NoSnapshot;
    try {
      r = await api.overview(target);
    } catch (e) {
      if (seq !== cmpSeq.current) return;
      setCmp({ target, ov: null, loading: false, err: String((e as Error)?.message || e) });
      return;
    }
    if (seq !== cmpSeq.current) return;
    if (isNoSnapshot(r)) {
      try {
        const res = await fetchLive(target);
        if (seq !== cmpSeq.current) return;
        setCmp({ target, ov: res.overview, loading: false, err: "" });
      } catch (e) {
        if (seq !== cmpSeq.current) return;
        setCmp({ target, ov: null, loading: false, err: String((e as Error)?.message || e) });
      }
      return;
    }
    setCmp({ target, ov: r as Overview, loading: false, err: "" });
  }

  // Load an N-person candidate pool: several owners, ranked by health score.
  // Owners are fetched in PARALLEL — the getGithub throttle in live.ts caps
  // concurrency (3) and paces unauthenticated requests so a big pool doesn't
  // burn the 60 req/h limit; a 429/403 trips the breaker and the rest fail
  // fast. Each owner mirrors the primary path (snapshot first, live when
  // uncached).
  async function loadPool(raw: string) {
    const names = Array.from(
      new Set(
        raw
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
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
    // rank by health score, failures last
    rows.sort((a, b) => b.score - a.score);
    setPool(rows);
    setPoolProgress(null);
    setPoolLoading(false);
  }

  React.useEffect(() => {
    // cached owners + default (last fetched) owner
    api.owners().then((r) => {
      setCached(r.owners);
      if (owner === "") setOwner(r.current); // adopt the server default
      loadOverview(r.current);
    }).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onOwnerPick(o: string) {
    setOwner(o);
    setQ(""); setHits([]); setSearched(false);
    setPeople(null);
  }

  // Clicking a follower/following name analyzes that person in-app:
  // cached owners read the local snapshot, everyone else is fetched live.
  function openOwner(login: string) {
    onOwnerPick(login);
    if (cached.includes(login)) {
      loadOverview(login);
    } else {
      loadLive(login);
    }
  }

  // search: live results are searched client-side; cached owners hit the server
  function onSearch() {
    if (!owner) return;
    const seq = ++searchSeq.current;
    if (live) {
      const res = searchLocal(live.all, q);
      setHits(res);
      setHitsTotal(res.length);
      setSearched(true);
      return;
    }
    setSearching(true);
    api.search(q, owner).then((r) => {
      if (seq !== searchSeq.current) return;
      if (isNoSnapshot(r)) {
        setNoSnap(r as NoSnapshot);
      } else {
        setHits(r.shown);
        setHitsTotal(r.total);
      }
      setSearched(true);
      setSearching(false);
    }).catch(() => { if (seq === searchSeq.current) setSearching(false); });
  }

  // Re-score + re-rank the pool with the CURRENT weights so dragging the
  // WeightTuner sliders re-orders candidates live.
  const rankedPool = pool
    .map((p) => ({
      ...p,
      score: p.ov ? healthScore(deriveTalent(p.ov, lang), weights).total : 0,
    }))
    .sort((a, b) => b.score - a.score);

  // pool progress fraction: finished owners + the current owner's page
  // progress (falls back to owner-count only when the page total is unknown)
  const poolFrac = poolProgress
    ? poolProgress.curTotal
      ? Math.min(1, (poolProgress.done + Math.min(poolProgress.curPage ?? 0, poolProgress.curTotal) / poolProgress.curTotal) / poolProgress.total)
      : poolProgress.done / Math.max(1, poolProgress.total)
    : 0;

  return {
    owner, setOwner, cached,
    weights, setWeights,
    ov, live, noSnap, loading, liveLoading, liveErr, liveProgress,
    err, q, setQ, hits, hitsTotal, searched, searching, limit, setLimit,
    people, peopleLoading, peopleError, refreshing, refreshMsg, peopleDiff, radar,
    cmp, setCmp,
    poolInput, setPoolInput, poolLoading, poolProgress, pool, setPool,
    rankedPool, poolFrac,
    onRefresh, loadPeople, loadOverview, loadLive, loadCompare, loadPool,
    openOwner, onOwnerPick, onSearch,
  };
}
