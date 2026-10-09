import React from "react";
import { useDashboardData } from "./dashboard/useDashboard";
import { OwnerPicker } from "./dashboard/pickers";
import { ProfileCard, TalentPanel, ComparePanel, PushTrend } from "./dashboard/panels";
import { Bars, Kpi } from "./dashboard/bars";
import { RepoRow, BrowsePage } from "./dashboard/lists";
import { PeopleSection } from "./dashboard/people-section";
import { useFollowActions } from "./dashboard/useFollowActions";
import { deriveTalent } from "./talent";
import { useLang, useT } from "./i18n";
import { detectGhAuth } from "./live";

// Pure render component: all state, loaders and derived rankings live in
// useDashboardData (dashboard/useDashboard.ts) — this file only wires the
// JSX to the hook.
export function Dashboard() {
  const t = useT();
  const { lang } = useLang();
  const d = useDashboardData(t, lang);

  // Whether the server has a GH_TOKEN — flips the rate-limit copy and the
  // fetch throttle. Probed once on mount (cheap same-origin call).
  const [ghAuthed, setGhAuthed] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let on = true;
    detectGhAuth().then((a) => {
      if (on) setGhAuthed(a);
    });
    return () => {
      on = false;
    };
  }, []);

  const {
    owner, cached, weights, setWeights,
    ov, live, liveInfo, noSnap, loading, liveLoading, liveErr, liveProgress, repoErr,
    err, q, setQ, hits, hitsTotal, searched, searching, limit, setLimit,
    people, setPeople, peopleLoading, peopleError, refreshing, refreshMsg, peopleDiff, radar, stargazers,
    cmp, setCmp,
    poolInput, setPoolInput, poolLoading, poolProgress, pool, setPool,
    rankedPool, poolFrac,
    onRefresh, loadPeople, loadOverview, loadLive, loadCompare, loadPool,
    openOwner, onOwnerPick, onSearch, defaultOwner,
  } = d;

  // Last live-fetch provenance, shown next to the fetch buttons: cache hits
  // are instant, fresh pulls carry wall-clock time.
  const liveNote = liveInfo ? (
    liveInfo.cached
      ? <span className="chip live-info">{t("live.last_cached")}</span>
      : <span className="chip live-info">{t("live.last_fresh", { ms: liveInfo.ms })}</span>
  ) : null;

  // Follow/unfollow actions — progress state, one-retry-per-action network
  // policy and optimistic following-set updates live in useFollowActions.ts.
  const {
    followState, unfollowState, waterFollowing, followAll, unfollowWater,
  } = useFollowActions({ people, setPeople, owner, viaLive: !!live, loadPeople, t });

  // One screen at a time — the dashboard used to stack the account analysis,
  // the full repo browser and the whole people/radar area on one long page.
  // Tabs keep each view focused: overview (profile + signals + charts +
  // top repos + compare/pool), repos (search + full paged list), people
  // (followers/following/radar/mutual + the action toolbar).
  const [tab, setTab] = React.useState<"overview" | "repos" | "people">("overview");
  // people tab is split into three sub-views — relations (mutual + worth),
  // insights (radar + stargazers), lists (diff + followers + following)
  const [peopleView, setPeopleView] = React.useState<"relation" | "insight" | "list">("relation");
  // Insights (radar + stargazer profiles) only exist for the default owner;
  // lists and relations work for every account. A stale "insight" view on a
  // non-default owner falls back to relations.
  const effectiveView = owner === defaultOwner || peopleView !== "insight" ? peopleView : "relation";
  React.useEffect(() => {
    setPeopleView("relation");
  }, [owner]);

  // Picking a cached owner from the dropdown analyzes it immediately (the
  // "分析" button stays for typing a new owner manually). Loading is idempotent
  // — loadOverview reads the local snapshot; an uncached owner lands on the
  // live-fetch panel.
  function handleOwnerPick(o: string) {
    onOwnerPick(o);
    loadOverview(o);
  }

  // The people tab loads on demand: opening it with no people data pulls the
  // snapshot (falling back to a live fetch when uncached) instead of the old
  // behaviour where every live overview fetch eagerly paged through the whole
  // follower/following list in the background.
  React.useEffect(() => {
    if (tab === "people" && owner && !peopleLoading && !people && !peopleError) {
      loadPeople(owner, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, owner, people, peopleLoading, peopleError]);

  return (
    <div>
      <section className="hero">
        <h1>{t("hero.title")}</h1>
        <p>{t("hero.subtitle")}</p>
      </section>

      <OwnerPicker value={owner} cached={cached} onPick={handleOwnerPick} onAnalyze={loadOverview} busy={loading} />

      <div className="tabs">
        <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => setTab("overview")}>
          {t("tabs.overview")}
        </button>
        <button className={tab === "repos" ? "tab active" : "tab"} onClick={() => setTab("repos")}>
          {t("tabs.repos")}
        </button>
        <button className={tab === "people" ? "tab active" : "tab"} onClick={() => setTab("people")}>
          {t("tabs.people")}
        </button>
      </div>


      {tab === "overview" && (
        <>
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
        {cmp.ov && cmp.cached ? (
          <span className="chip live-info">{t("cmp.cached")}</span>
        ) : cmp.ov && cmp.ms != null ? (
          <span className="chip live-info">{t("cmp.fresh_ms", { ms: cmp.ms })}</span>
        ) : null}
      </div>
      {cmp.err && <div className="panel error">{t("cmp.failed")}: {cmp.err}</div>}
      {ov && cmp.ov && ov.owner !== cmp.target ? (
        <ComparePanel ovA={ov} ovB={cmp.ov} weights={weights} />
      ) : null}
        </>
      )}

      {err && <div className="panel error">{err}</div>}

      {loading && <div className="panel">{t("misc.loading")}</div>}

      {(liveLoading || refreshing || (liveProgress && liveProgress.kind === "people")) && (
        <div className="panel">
          <h2>{t("live.fetching", { owner })}</h2>
          {liveProgress && liveProgress.kind === "people" ? (
            <p className="muted">
              {t(
                liveProgress.detail === "following"
                  ? "live.people_fetching_following"
                  : "live.people_fetching_followers",
                { page: liveProgress.page }
              )}
            </p>
          ) : liveProgress && liveProgress.kind === "refresh" ? (
            <p className="muted">{t("live.refresh_progress")}</p>
          ) : liveProgress && liveProgress.total > 0 ? (
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
          <p className="muted">{ghAuthed ? t("live.rate_note_authed") : t("live.rate_note_anon")}</p>
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
            <button className="btn" onClick={() => loadLive(noSnap.owner, true)} title={t("live.refresh_title")}>{t("live.refresh_live")}</button>
            <span className="muted">{t("live.or_offline")}</span>
            <code className="hint-cmd">{`OWNER=${noSnap.owner} make fetch`}</code>
          </div>
          <p className="muted">
            {ghAuthed ? t("live.proxy_note_authed") : t("live.proxy_note_anon")}
          </p>
        </div>
      )}

      {ov && !loading && !noSnap && !liveLoading && (
        <>
          <div className="live-actions">
            <button className="btn" onClick={() => loadLive(owner)}>{t("live.fetch_live")}</button>
            <button className="btn" onClick={() => loadLive(owner, true)} title={t("live.refresh_title")}>{t("live.refresh_live")}</button>
            {liveNote}
          </div>
          {tab === "overview" && (
            <>
          <ProfileCard ov={ov} />

          {ov.partial ? (
            // Phase-1 live view: profile is here, repo aggregates still
            // streaming in — show a compact pulling note in place of the
            // repo-derived panels instead of a misleading all-zero board.
            <div className="panel" style={{ gridColumn: "1 / -1" }}>
              <h2>{t("live.pulling_repos", { owner })}</h2>
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
            </div>
          ) : (
            <>
              <TalentPanel t={deriveTalent(ov, lang)} ov={ov} weights={weights} onWeights={setWeights} />

              <section className="kpis">
                <Kpi n={String(ov.count)} label={t("kpi.repos")} />
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
            </>
          )}

          {!ov.partial && (
            <section className="panel">
              <h2>{t("all.top10")}</h2>
              <ol className="top-list">
                {ov.top_by_stars.map((r, i) => (
                  <RepoRow key={r.name} r={r} rank={i + 1} />
                ))}
              </ol>
            </section>
          )}
            </>
          )}

          {tab === "repos" && (
            <>
          {repoErr && (
            <div className="panel error" style={{ gridColumn: "1 / -1" }}>
              <h2>{t("live.repos_failed")}</h2>
              <p>{repoErr}</p>
              <div className="no-snap-actions">
                <button className="btn" onClick={() => loadLive(owner)}>{t("live.retry")}</button>
              </div>
            </div>
          )}
          {ov.partial ? (
            <div className="panel" style={{ gridColumn: "1 / -1" }}>
              <h2>{t("live.pulling_repos", { owner })}</h2>
              <p className="muted">{t("live.pulling")}</p>
            </div>
          ) : (
            <>
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
                  liveAll={live ? live.all : null} totalRepos={ov.profile.public_repos} />
              </section>
            </>
          )}
            </>
          )}

          {tab === "people" && (
          <PeopleSection
            people={people}
            peopleLoading={peopleLoading}
            peopleError={peopleError}
            peopleView={peopleView}
            setPeopleView={setPeopleView}
            owner={owner}
            defaultOwner={defaultOwner}
            peopleDiff={peopleDiff}
            radar={radar}
            stargazers={stargazers}
            refreshMsg={refreshMsg}
            refreshing={refreshing}
            onRefresh={onRefresh}
            loadPeople={loadPeople}
            viaLive={!!live}
            openOwner={openOwner}
            followState={followState}
            unfollowState={unfollowState}
            waterFollowing={waterFollowing}
            followAll={followAll}
            unfollowWater={unfollowWater}
            t={t}
          />
          )}
        </>
      )}
    </div>
  );
}