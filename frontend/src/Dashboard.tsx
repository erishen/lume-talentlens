import React from "react";
import { api } from "./api";
import type { Overview, RepoView, NoSnapshot, People } from "./types";
import { isNoSnapshot } from "./types";
import { fetchLive, fetchLivePeople, searchLocal, type LiveResult, type LiveProgress } from "./live";
import { deriveTalent, healthScore, loadHealthWeights, saveHealthWeights, type HealthWeights } from "./talent";
import { OwnerPicker } from "./dashboard/pickers";
import { ProfileCard, TalentPanel, ComparePanel, PushTrend } from "./dashboard/panels";
import { Bars, Kpi } from "./dashboard/bars";
import { PersonList, RepoRow, BrowsePage } from "./dashboard/lists";

export function Dashboard() {
  const [owner, setOwner] = React.useState("");
  const [cached, setCached] = React.useState<string[]>([]);
  // request-sequence guards: the latest load wins, older in-flight responses
  // are dropped instead of clobbering the view when the user switches owners
  // quickly (or compares several candidates in a row).
  const reqSeq = React.useRef(0);
  const cmpSeq = React.useRef(0);
  const poolSeq = React.useRef(0);
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
  const [pool, setPool] = React.useState<{ target: string; ov: Overview | null; score: number; err: string }[]>([]);

  // Load the follower / following lists for the current owner. Cached owners
  // hit the server's /api/people; live owners (or when the running server
  // predates that route) fetch in the browser instead. Own seq guard: rapid
  // owner switches must not let an older people response clobber the new one.
  const peopleSeq = React.useRef(0);
  function loadPeople(o: string, viaLive: boolean) {
    const seq = ++peopleSeq.current;
    setPeople(null);
    setPeopleError("");
    setPeopleLoading(true);
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
        setPeopleError("Could not reach GitHub for this owner (network or rate limit). " +
          "For a cached owner, restart the server so /api/people is available, then click Retry.");
      } else {
        setPeople(p);
        setPeopleError("");
      }
      setPeopleLoading(false);
    }).catch(() => {
      if (s !== peopleSeq.current) return;
      setPeople(null);
      setPeopleError("Failed to load followers/following.");
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

    const rows: { target: string; ov: Overview | null; score: number; err: string }[] = names.map((n) => ({
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
        row.score = ov ? healthScore(deriveTalent(ov)).total : 0;
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
  const searchSeq = React.useRef(0);
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
      score: p.ov ? healthScore(deriveTalent(p.ov), weights).total : 0,
    }))
    .sort((a, b) => b.score - a.score);

  // pool progress fraction: finished owners + the current owner's page
  // progress (falls back to owner-count only when the page total is unknown)
  const poolFrac = poolProgress
    ? poolProgress.curTotal
      ? Math.min(1, (poolProgress.done + Math.min(poolProgress.curPage ?? 0, poolProgress.curTotal) / poolProgress.curTotal) / poolProgress.total)
      : poolProgress.done / Math.max(1, poolProgress.total)
    : 0;

  return (
    <div>
      <section className="hero">
        <h1>Recruiting lens over a GitHub footprint</h1>
        <p>Pick an owner to read their talent signals — profile, engineering rigor, output, focus (local snapshots, offline).</p>
      </section>

      <OwnerPicker value={owner} cached={cached} onPick={onOwnerPick} onAnalyze={loadOverview} busy={loading} />

      <div className="pool-row">
        <span className="muted">rank</span>
        <input
          className="search-input"
          placeholder="candidate pool — several owners, comma/space separated (e.g. erishen, acme, bob)"
          value={poolInput}
          onChange={(e) => setPoolInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !poolLoading && loadPool(poolInput)}
        />
        <button className="btn" onClick={() => loadPool(poolInput)} disabled={poolLoading}>
          {poolLoading ? "…" : "Rank"}
        </button>
        {pool.length > 0 && (
          <button className="chip" onClick={() => { setPool([]); setPoolInput(""); }}>
            ✕ clear
          </button>
        )}
      </div>

      {poolLoading && poolProgress && (
        <div className="panel pool-progress">
          <h2>Candidate ranking · loading</h2>
          <div className="pool-prog-bar">
            <div className="pool-prog-fill" style={{ width: `${poolFrac * 100}%` }} />
          </div>
          <p className="muted">
            {poolProgress.done} / {poolProgress.total} loaded
            {poolProgress.curOwner ? (
              <>
                {" "}· fetching <code>@{poolProgress.curOwner}</code>
                {poolProgress.curTotal ? (
                  <> (repos page {Math.min(poolProgress.curPage ?? 0, poolProgress.curTotal)}/{poolProgress.curTotal})</>
                ) : null}
              </>
            ) : null}
            {" "}(live pulls are throttled to stay under the 60 req/h limit)
          </p>
        </div>
      )}

      {pool.length > 0 && !poolLoading && (
        <section className="panel pool">
          <h2>Candidate ranking · by open-source health</h2>
          <div className="pool-table">
            {rankedPool.map((p, i) => (
              <div className="pool-row-item" key={p.target}>
                <span className="pool-rank">#{i + 1}</span>
                <button
                  className="pool-name"
                  onClick={() => openOwner(p.target)}
                  title={"Analyze @" + p.target + " (in-app)"}
                >
                  @{p.target}
                </button>
                <span className="pool-score">
                  {p.ov ? <b>{p.score}</b> : <span className="muted">—</span>}
                </span>
                <span className="pool-detail">
                  {p.err ? (
                    <span className="muted err">{p.err}</span>
                  ) : p.ov ? (
                    <span>
                      {p.ov.count} repos · top <code>{Object.keys(p.ov.languages || {})[0] || "—"}</code>{" "}
                      · {p.ov.recency.active || 0} active ≤90d
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <p className="muted pool-note">
            Click a name to open the full analysis · sorted by the current health weights
            ({Math.round(weights.activity * 100)}/{Math.round(weights.rigor * 100)}/
            {Math.round(weights.focus * 100)}/{Math.round(weights.influence * 100)}) — adjust them in Talent
            signals and the ranking updates live.
          </p>
        </section>
      )}

      <div className="compare-row">
        <span className="muted">vs</span>
        <input
          className="search-input"
          placeholder="compare with another GitHub owner (e.g. torvalds)"
          value={cmp.target}
          onChange={(e) => setCmp((c) => ({ ...c, target: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && loadCompare(cmp.target)}
        />
        <button className="btn" onClick={() => loadCompare(cmp.target)} disabled={cmp.loading}>
          {cmp.loading ? "…" : "Compare"}
        </button>
        {cmp.ov && (
          <button className="chip" onClick={() => setCmp({ target: "", ov: null, loading: false, err: "" })}>
            ✕ clear
          </button>
        )}
      </div>
      {cmp.err && <div className="panel error">Compare failed: {cmp.err}</div>}
      {ov && cmp.ov && ov.owner !== cmp.target ? (
        <ComparePanel ovA={ov} ovB={cmp.ov} weights={weights} />
      ) : null}

      {err && <div className="panel error">{err}</div>}

      {loading && <div className="panel">Loading…</div>}

      {liveLoading && (
        <div className="panel">
          <h2>Fetching <code>{owner}</code> live from GitHub…</h2>
          {liveProgress && liveProgress.total > 0 ? (
            <>
              <div className="pool-prog-bar">
                <div
                  className="pool-prog-fill"
                  style={{ width: `${(Math.min(liveProgress.page, liveProgress.total) / liveProgress.total) * 100}%` }}
                />
              </div>
              <p className="muted">
                repos page {Math.min(liveProgress.page, liveProgress.total)}/{liveProgress.total} · {liveProgress.repos} repos pulled
              </p>
            </>
          ) : (
            <p className="muted">pulling repos…</p>
          )}
        </div>
      )}

      {liveErr && !liveLoading && (
        <div className="panel error">
          <h2>Live fetch failed{owner ? <code> @{owner}</code> : null}</h2>
          <p>{liveErr}</p>
          {owner && (
            <div className="no-snap-actions">
              <button className="btn" onClick={() => loadLive(owner)}>Retry</button>
              <span className="muted">offline fallback — run:</span>
              <code className="hint-cmd">{`OWNER=${owner} make fetch`}</code>
            </div>
          )}
        </div>
      )}

      {noSnap && !loading && !liveLoading && (
        <div className="panel no-snap">
          <h2>No local snapshot for <code>{noSnap.owner}</code></h2>
          <p>Two ways to analyze <code>{noSnap.owner}</code>:</p>
          <div className="no-snap-actions">
            <button className="btn" onClick={() => loadLive(noSnap.owner)}>Fetch live from GitHub</button>
            <span className="muted">or, offline / rate-limit-proof:</span>
            <code className="hint-cmd">{`OWNER=${noSnap.owner} make fetch`}</code>
          </div>
          <p className="muted">
            Live fetch goes through the server's /api/live/github proxy (outbound http_get);
            unauthenticated it is shared at ~60 req/h — set GH_TOKEN to raise it.
          </p>
        </div>
      )}

      {ov && !loading && !noSnap && !liveLoading && (
        <>
          <ProfileCard ov={ov} />

          <TalentPanel t={deriveTalent(ov)} ov={ov} weights={weights} onWeights={setWeights} />

          <section className="kpis">
            <Kpi n={String(ov.count)} label="repos" />
            <Kpi n={String(ov.non_fork_count)} label="original" />
            <Kpi n={String(ov.totals.stars)} label="stars total" />
            <Kpi n={String(ov.totals.forks)} label="forks total" />
            <Kpi n={String(ov.recency.active || 0)} label="active ≤90d" />
          </section>

          <section className="grid">
            <Bars title="Languages" data={ov.languages} />
            <Bars title="Recency" data={ov.recency} color="#22c55e" />
            <Bars title="Created per year" data={ov.years} color="#f59e0b" />
          </section>

          {ov.push_trend && (
            <section className="grid">
              <PushTrend data={ov.push_trend} />
            </section>
          )}

          <div className="grid two">
            {peopleLoading && (
              <div className="panel">
                <h2>Followers &amp; Following</h2>
                <p className="muted">Loading…</p>
              </div>
            )}
            {!peopleLoading && peopleError && (
              <div className="panel error" style={{ gridColumn: "1 / -1" }}>
                <h2>Followers &amp; Following</h2>
                <p>{peopleError}</p>
                <button className="btn" onClick={() => loadPeople(owner, !!live)}>Retry</button>
              </div>
            )}
            {!peopleLoading && !peopleError && people && (
              <>
                <PersonList
                  title="Followers"
                  people={people.followers}
                  totals={people.totals.followers}
                  note={people.note}
                  onOpen={openOwner}
                />
                <PersonList
                  title="Following"
                  people={people.following}
                  totals={people.totals.following}
                  note={people.note}
                  onOpen={openOwner}
                />
              </>
            )}
          </div>

          <section className="panel">
            <h2>Top 10 by stars</h2>
            <ol className="top-list">
              {ov.top_by_stars.map((r, i) => (
                <RepoRow key={r.name} r={r} rank={i + 1} />
              ))}
            </ol>
          </section>

          <section className="panel">
            <h2>Search {owner ? <span className="muted">in {owner}</span> : null}</h2>
            <div className="search-row">
              <input
                className="search-input"
                value={q}
                placeholder="filter by name / description / language / topic…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
              />
              <button className="btn" onClick={onSearch} disabled={searching || !owner}>
                {searching ? "…" : "Search"}
              </button>
            </div>
            {searched && (
              <ol className="top-list">
                {hits.map((r, i) => (
                  <RepoRow key={r.name} r={r} rank={i + 1} />
                ))}
                {hits.length === 0 && <li className="muted">no matches for “{q}”</li>}
                {hits.length > 0 && <li className="muted">{hitsTotal} match{hitsTotal === 1 ? "" : "es"}</li>}
              </ol>
            )}
          </section>

          <section className="panel">
            <h2>All repos</h2>
            <BrowsePage limit={limit} setLimit={setLimit} owner={owner}
              liveAll={live ? live.all : null} />
          </section>
        </>
      )}
    </div>
  );
}
