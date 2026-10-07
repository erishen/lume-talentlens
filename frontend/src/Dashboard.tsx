import React from "react";
import { useDashboardData } from "./dashboard/useDashboard";
import { OwnerPicker } from "./dashboard/pickers";
import { ProfileCard, TalentPanel, ComparePanel, PushTrend } from "./dashboard/panels";
import { Bars, Kpi } from "./dashboard/bars";
import { PersonList, RepoRow, BrowsePage } from "./dashboard/lists";
import { deriveTalent } from "./talent";
import { useLang, useT } from "./i18n";

// Pure render component: all state, loaders and derived rankings live in
// useDashboardData (dashboard/useDashboard.ts) — this file only wires the
// JSX to the hook.
export function Dashboard() {
  const t = useT();
  const { lang } = useLang();
  const d = useDashboardData(t, lang);

  const {
    owner, cached, weights, setWeights,
    ov, live, noSnap, loading, liveLoading, liveErr, liveProgress,
    err, q, setQ, hits, hitsTotal, searched, searching, limit, setLimit,
    people, peopleLoading, peopleError, refreshing, refreshMsg,
    cmp, setCmp,
    poolInput, setPoolInput, poolLoading, poolProgress, pool, setPool,
    rankedPool, poolFrac,
    onRefresh, loadPeople, loadOverview, loadLive, loadCompare, loadPool,
    openOwner, onOwnerPick, onSearch,
  } = d;

  return (
    <div>
      <section className="hero">
        <h1>{t("hero.title")}</h1>
        <p>{t("hero.subtitle")}</p>
      </section>

      <OwnerPicker value={owner} cached={cached} onPick={onOwnerPick} onAnalyze={loadOverview} busy={loading} />

      <div className="pool-row">
        <span className="muted">{t("pool.label")}</span>
        <input
          className="search-input"
          placeholder={t("pool.placeholder")}
          value={poolInput}
          onChange={(e) => setPoolInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !poolLoading && loadPool(poolInput)}
        />
        <button className="btn" onClick={() => loadPool(poolInput)} disabled={poolLoading}>
          {poolLoading ? "…" : t("pool.rank")}
        </button>
        {pool.length > 0 && (
          <button className="chip" onClick={() => { setPool([]); setPoolInput(""); }}>
            {t("pool.clear")}
          </button>
        )}
      </div>

      {poolLoading && poolProgress && (
        <div className="panel pool-progress">
          <h2>{t("pool.loading_title")}</h2>
          <div className="pool-prog-bar">
            <div className="pool-prog-fill" style={{ width: `${poolFrac * 100}%` }} />
          </div>
          <p className="muted">
            {t("pool.loaded", { done: poolProgress.done, total: poolProgress.total })}
            {poolProgress.curOwner ? (
              <>
                {" "}· {t("pool.fetching")} <code>@{poolProgress.curOwner}</code>
                {poolProgress.curTotal ? (
                  <> ({t("pool.repos_page", { cur: Math.min(poolProgress.curPage ?? 0, poolProgress.curTotal), total: poolProgress.curTotal })})</>
                ) : null}
              </>
            ) : null}
            {" "}{t("pool.throttled")}
          </p>
        </div>
      )}

      {pool.length > 0 && !poolLoading && (
        <section className="panel pool">
          <h2>{t("pool.ranking_title")}</h2>
          <div className="pool-table">
            {rankedPool.map((p, i) => (
              <div className="pool-row-item" key={p.target}>
                <span className="pool-rank">#{i + 1}</span>
                <button
                  className="pool-name"
                  onClick={() => openOwner(p.target)}
                  title={t("people.click_name", { login: p.target })}
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
                      {t("pool.detail", {
                        count: p.ov.count,
                        lang: Object.keys(p.ov.languages || {})[0] || "—",
                        active: p.ov.recency.active || 0,
                      })}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <p className="muted pool-note">
            {t("pool.note", {
              a: Math.round(weights.activity * 100),
              r: Math.round(weights.rigor * 100),
              f: Math.round(weights.focus * 100),
              i: Math.round(weights.influence * 100),
            })}
          </p>
        </section>
      )}

      <div className="compare-row">
        <span className="muted">{t("cmp.label")}</span>
        <input
          className="search-input"
          placeholder={t("cmp.placeholder")}
          value={cmp.target}
          onChange={(e) => setCmp((c) => ({ ...c, target: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && loadCompare(cmp.target)}
        />
        <button className="btn" onClick={() => loadCompare(cmp.target)} disabled={cmp.loading}>
          {cmp.loading ? "…" : t("cmp.btn")}
        </button>
        {cmp.ov && (
          <button className="chip" onClick={() => setCmp({ target: "", ov: null, loading: false, err: "" })}>
            {t("cmp.clear")}
          </button>
        )}
      </div>
      {cmp.err && <div className="panel error">{t("cmp.failed")}: {cmp.err}</div>}
      {ov && cmp.ov && ov.owner !== cmp.target ? (
        <ComparePanel ovA={ov} ovB={cmp.ov} weights={weights} />
      ) : null}

      {err && <div className="panel error">{err}</div>}

      {loading && <div className="panel">{t("misc.loading")}</div>}

      {liveLoading && (
        <div className="panel">
          <h2>{t("live.fetching", { owner })}</h2>
          {liveProgress && liveProgress.total > 0 ? (
            <>
              <div className="pool-prog-bar">
                <div
                  className="pool-prog-fill"
                  style={{ width: `${(Math.min(liveProgress.page, liveProgress.total) / liveProgress.total) * 100}%` }}
                />
              </div>
              <p className="muted">
                {t("live.page_progress", {
                  page: Math.min(liveProgress.page, liveProgress.total),
                  total: liveProgress.total,
                  repos: liveProgress.repos,
                })}
              </p>
            </>
          ) : (
            <p className="muted">{t("live.pulling")}</p>
          )}
          <p className="muted">{t("live.rate_note")}</p>
        </div>
      )}

      {liveErr && !liveLoading && (
        <div className="panel error">
          <h2>{t("live.failed", { owner: owner ? "@" + owner : "" })}</h2>
          <p>{liveErr}</p>
          {owner && (
            <div className="no-snap-actions">
              <button className="btn" onClick={() => loadLive(owner)}>{t("live.retry")}</button>
              <span className="muted">{t("live.offline_fallback")}</span>
              <code className="hint-cmd">{`OWNER=${owner} make fetch`}</code>
            </div>
          )}
        </div>
      )}

      {noSnap && !loading && !liveLoading && (
        <div className="panel no-snap">
          <h2>{t("live.no_snapshot", { owner: noSnap.owner })}</h2>
          <p>{t("live.two_ways", { owner: noSnap.owner })}</p>
          <div className="no-snap-actions">
            <button className="btn" onClick={() => loadLive(noSnap.owner)}>{t("live.fetch_live")}</button>
            <span className="muted">{t("live.or_offline")}</span>
            <code className="hint-cmd">{`OWNER=${noSnap.owner} make fetch`}</code>
          </div>
          <p className="muted">
            {t("live.proxy_note")}
          </p>
        </div>
      )}

      {ov && !loading && !noSnap && !liveLoading && (
        <>
          <ProfileCard ov={ov} />

          <TalentPanel t={deriveTalent(ov, lang)} ov={ov} weights={weights} onWeights={setWeights} />

          <section className="kpis">
            <Kpi n={String(ov.count)} label={t("kpi.repos")} />
            <Kpi n={String(ov.non_fork_count)} label={t("kpi.original")} />
            <Kpi n={String(ov.totals.stars)} label={t("kpi.stars_total")} />
            <Kpi n={String(ov.totals.forks)} label={t("kpi.forks_total")} />
            <Kpi n={String(ov.recency.active || 0)} label={t("kpi.active_90d")} />
          </section>

          <section className="grid">
            <Bars title={t("bars.languages")} data={ov.languages} />
            <Bars title={t("bars.recency")} data={ov.recency} color="#22c55e" />
            <Bars title={t("bars.created_per_year")} data={ov.years} color="#f59e0b" />
          </section>

          {ov.push_trend && (
            <section className="grid">
              <PushTrend data={ov.push_trend} />
            </section>
          )}

          <div className="grid two">
            {peopleLoading && (
              <div className="panel">
                <h2>{t("people.title")}</h2>
                <p className="muted">{t("people.loading")}</p>
              </div>
            )}
            {!peopleLoading && peopleError && (
              <div className="panel error" style={{ gridColumn: "1 / -1" }}>
                <h2>{t("people.error_title")}</h2>
                <p>{peopleError}</p>
                <button className="btn" onClick={() => loadPeople(owner, !!live)}>{t("people.retry")}</button>
              </div>
            )}
            {!peopleLoading && !peopleError && people && (
              <>
                <div className="panel tools" style={{ gridColumn: "1 / -1" }}>
                  <span className="muted">{t("people.snapshot_note")}</span>
                  <span className="muted">{refreshMsg}</span>
                  <button className="btn" onClick={onRefresh} disabled={refreshing}>
                    {refreshing ? t("people.refreshing") : t("people.refresh")}
                  </button>
                </div>
                <PersonList
                  title={t("people.followers")}
                  people={people.followers}
                  totals={people.totals.followers}
                  note={people.note}
                  onOpen={openOwner}
                />
                <PersonList
                  title={t("people.following")}
                  people={people.following}
                  totals={people.totals.following}
                  note={people.note}
                  onOpen={openOwner}
                />
              </>
            )}
          </div>

          <section className="panel">
            <h2>{t("all.top10")}</h2>
            <ol className="top-list">
              {ov.top_by_stars.map((r, i) => (
                <RepoRow key={r.name} r={r} rank={i + 1} />
              ))}
            </ol>
          </section>

          <section className="panel">
            <h2>{owner ? t("search.in", { owner }) : t("search.btn")}</h2>
            <div className="search-row">
              <input
                className="search-input"
                value={q}
                placeholder={t("search.placeholder")}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
              />
              <button className="btn" onClick={onSearch} disabled={searching || !owner}>
                {searching ? "…" : t("search.btn")}
              </button>
            </div>
            {searched && (
              <ol className="top-list">
                {hits.map((r, i) => (
                  <RepoRow key={r.name} r={r} rank={i + 1} />
                ))}
                {hits.length === 0 && <li className="muted">{t("search.no_matches", { q })}</li>}
                {hits.length > 0 && <li className="muted">{hitsTotal} {t("search.match")}</li>}
              </ol>
            )}
          </section>

          <section className="panel">
            <h2>{t("all.repos")}</h2>
            <BrowsePage limit={limit} setLimit={setLimit} owner={owner}
              liveAll={live ? live.all : null} />
          </section>
        </>
      )}
    </div>
  );
}
