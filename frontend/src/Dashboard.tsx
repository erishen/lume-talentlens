import React from "react";
import { useDashboardData } from "./dashboard/useDashboard";
import { OwnerPicker } from "./dashboard/pickers";
import { ProfileCard, TalentPanel, ComparePanel, PushTrend, DiffLine, RelationPanel } from "./dashboard/panels";
import { Bars, Kpi } from "./dashboard/bars";
import { PersonList, RepoRow, BrowsePage, RadarPanel, StargazersPanel, RADAR_SCORE } from "./dashboard/lists";
import { exportPeopleCsv } from "./exportCsv";
import type { PersonView, Radar } from "./types";
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
    people, peopleLoading, peopleError, refreshing, refreshMsg, peopleDiff, radar, stargazers,
    cmp, setCmp,
    poolInput, setPoolInput, poolLoading, poolProgress, pool, setPool,
    rankedPool, poolFrac,
    onRefresh, loadPeople, loadOverview, loadLive, loadCompare, loadPool,
    openOwner, onOwnerPick, onSearch, defaultOwner,
  } = d;

  // Follow-all for the "worth following" panel — one PUT per login via the
  // server's /api/follow proxy (needs GH_TOKEN with user:follow scope).
  // Last live-fetch provenance, shown next to the fetch buttons: cache hits
  // are instant, fresh pulls carry wall-clock time.
  const liveNote = liveInfo ? (
    liveInfo.cached
      ? <span className="chip live-info">{t("live.last_cached")}</span>
      : <span className="chip live-info">{t("live.last_fresh", { ms: liveInfo.ms })}</span>
  ) : null;
  const [followState, setFollowState] = React.useState<{
    busy: boolean; done: number; failed: number; err: string;
  }>({ busy: false, done: 0, failed: 0, err: "" });
  // GitHub's API endpoint is flaky on this network (the first handshake often
  // times out and a retry succeeds immediately) — retry once per action so a
  // one-click follow/unfollow doesn't surface a misleading "network error".
  const netErr = t("people.network_err");
  async function postAction(url: string, login: string, onRetry?: () => void): Promise<{ ok: boolean; err: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, {
          method: url.endsWith("/follow") ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login }),
        });
        const j = await r.json().catch(() => null);
        if (j && j.ok) return { ok: true, err: "" };
        return { ok: false, err: (j && j.err) || `HTTP ${r.status}` };
      } catch {
        // first failure is usually a flaky handshake — show "retrying" so the
        // user isn't staring at a silent spinner, then try once more
        if (attempt === 0 && onRetry) onRetry();
        if (attempt === 1) return { ok: false, err: netErr };
      }
    }
    return { ok: false, err: netErr };
  }
  async function followAll(targets: PersonView[]) {
    if (followState.busy || targets.length === 0) return;
    setFollowState({ busy: true, done: 0, failed: 0, err: "" });
    let done = 0;
    let failed = 0;
    let firstErr = "";
    const doneLogins: string[] = [];
    for (const p of targets) {
      const r = await postAction("/api/follow", p.login,
        () => setFollowState((s) => ({ ...s, err: t("people.retrying") })));
      if (r.ok) {
        done = done + 1;
        doneLogins.push(p.login);
      }
      else {
        failed = failed + 1;
        if (firstErr === "") firstErr = r.err;
      }
      setFollowState({ busy: true, done: done, failed: failed, err: firstErr });
    }
    setFollowState({ busy: false, done: done, failed: failed, err: firstErr });
    // Optimistic: append the successfully-followed logins to the local
    // following set so the worth list updates instantly — the server snapshot
    // is stale until a refresh actually re-fetches GitHub.
    if (doneLogins.length > 0) {
      setPeople((prev) => {
        if (!prev) return prev;
        const have = new Set(prev.following.map((g) => g.login));
        return {
          ...prev,
          following: [
            ...prev.following,
            ...targets.filter((p) => doneLogins.includes(p.login) && !have.has(p.login)),
          ],
        };
      });
    }
    // Best-effort server refresh so the snapshot catches up (rate-limited to
    // one run per owner per 60s — on 429 we keep the optimistic state and the
    // next manual refresh finishes the job).
    try {
      const res = await fetch("/api/refresh?owner=" + encodeURIComponent(owner));
      const j = await res.json().catch(() => null);
      if (j && j.ok) loadPeople(owner, !!live);
    } catch { /* keep optimistic */ }
  }

  // Unfollow-all for high-confidence water accounts in the following list —
  // one DELETE per login via /api/unfollow. Confirm first: unfollowing is
  // hard to reverse by hand at scale.
  const [unfollowState, setUnfollowState] = React.useState<{
    busy: boolean; done: number; failed: number; err: string;
  }>({ busy: false, done: 0, failed: 0, err: "" });
  const waterFollowing = people && people.following
    ? people.following.filter((p) => p.suspect === "high")
    : [];
  async function unfollowWater() {
    if (unfollowState.busy || waterFollowing.length === 0) return;
    if (!window.confirm(t("people.unfollow_confirm", { n: waterFollowing.length }))) return;
    setUnfollowState({ busy: true, done: 0, failed: 0, err: "" });
    let done = 0;
    let failed = 0;
    let firstErr = "";
    const doneLogins: string[] = [];
    for (const p of waterFollowing) {
      const r = await postAction("/api/unfollow", p.login,
        () => setUnfollowState((s) => ({ ...s, err: t("people.retrying") })));
      if (r.ok) {
        done = done + 1;
        doneLogins.push(p.login);
      }
      else {
        failed = failed + 1;
        if (firstErr === "") firstErr = r.err;
      }
      setUnfollowState({ busy: true, done: done, failed: failed, err: firstErr });
    }
    setUnfollowState({ busy: false, done: done, failed: failed, err: firstErr });
    // Optimistic: drop the unfollowed logins from the local following set so
    // the list updates instantly (server snapshot is stale until refreshed).
    if (doneLogins.length > 0) {
      setPeople((prev) => {
        if (!prev) return prev;
        return { ...prev, following: prev.following.filter((g) => !doneLogins.includes(g.login)) };
      });
    }
    // Best-effort server refresh; on 429 the optimistic state stands.
    try {
      const res = await fetch("/api/refresh?owner=" + encodeURIComponent(owner));
      const j = await res.json().catch(() => null);
      if (j && j.ok) loadPeople(owner, !!live);
    } catch { /* keep optimistic */ }
  }

  // relation insights over the people snapshot:
  // - mutual = followers who are also followed back (双向关注)
  // - worth = high-influence followers not yet followed back (值得关注)
  const mutualPeople = people
    ? people.followers.filter((f) => people.following.some((g) => g.login === f.login))
    : [];
  const worthPeople = people
    ? people.followers.filter(
        (f) => (f.score ?? 0) >= RADAR_SCORE && !people.following.some((g) => g.login === f.login)
      )
    : [];

  // One screen at a time — the dashboard used to stack the account analysis,
  // the full repo browser and the whole people/radar area on one long page.
  // Tabs keep each view focused: overview (profile + signals + charts +
  // top repos + compare/pool), repos (search + full paged list), people
  // (followers/following/radar/mutual + the action toolbar).
  const [tab, setTab] = React.useState<"overview" | "repos" | "people">("overview");
  // people tab is split into three sub-views — relations (mutual + worth),
  // insights (radar + stargazers), lists (diff + followers + following)
  const [peopleView, setPeopleView] = React.useState<"relation" | "insight" | "list">("relation");

  return (
    <div>
      <section className="hero">
        <h1>{t("hero.title")}</h1>
        <p>{t("hero.subtitle")}</p>
      </section>

      <OwnerPicker value={owner} cached={cached} onPick={onOwnerPick} onAnalyze={loadOverview} busy={loading} />

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
                {/* tools bar — always visible across the people sub-views */}
                <div className="panel tools" style={{ gridColumn: "1 / -1" }}>
                  <span className="muted">{t("people.snapshot_note")}</span>
                  <span className="muted">{refreshMsg}</span>
                  <button className="btn" onClick={onRefresh} disabled={refreshing}>
                    {refreshing ? t("people.refreshing") : t("people.refresh")}
                  </button>
                  <button className="btn" onClick={() => exportPeopleCsv(people, mutualPeople, worthPeople, radar)}>
                    {t("people.export_csv")}
                  </button>
                  {waterFollowing.length > 0 && (
                    <button
                      className="btn danger"
                      onClick={unfollowWater}
                      disabled={unfollowState.busy}
                    >
                      {unfollowState.busy
                        ? t("people.unfollowing", { done: unfollowState.done, total: waterFollowing.length })
                        : t("people.unfollow_water", { n: waterFollowing.length })}
                    </button>
                  )}
                </div>
                {unfollowState.err && (
                  <p className="muted" style={{ gridColumn: "1 / -1" }}>
                    {t("people.follow_err")}: {unfollowState.err}
                  </p>
                )}
                {/* sub-views: relations (mutual + worth), insights (radar +
                    stargazers), lists (diff + followers + following) */}
                <div className="people-subtabs" style={{ gridColumn: "1 / -1" }}>
                  <button
                    className={peopleView === "relation" ? "chip subtab active" : "chip subtab"}
                    onClick={() => setPeopleView("relation")}
                  >
                    {t("people.view_relation")}
                  </button>
                  <button
                    className={peopleView === "insight" ? "chip subtab active" : "chip subtab"}
                    onClick={() => setPeopleView("insight")}
                  >
                    {t("people.view_insight")}
                  </button>
                  <button
                    className={peopleView === "list" ? "chip subtab active" : "chip subtab"}
                    onClick={() => setPeopleView("list")}
                  >
                    {t("people.view_list")}
                  </button>
                </div>
                {followState.err && (
                  <p className="muted" style={{ gridColumn: "1 / -1" }}>
                    {t("people.follow_err")}: {followState.err}
                  </p>
                )}
                {peopleView === "relation" && (
                  <div className="people-grid">
                    <RelationPanel
                      title={t("people.mutual")}
                      people={mutualPeople}
                      emptyNote={t("people.mutual_none")}
                      t={t}
                      onOpen={openOwner}
                    />
                    <RelationPanel
                      title={t("people.worth")}
                      people={worthPeople}
                      emptyNote={t("people.worth_none")}
                      t={t}
                      onOpen={openOwner}
                      action={
                        worthPeople.length > 0 && (
                          <button
                            className="btn chip"
                            style={{ marginLeft: 8 }}
                            onClick={() => followAll(worthPeople)}
                            disabled={followState.busy}
                          >
                            {followState.busy
                              ? t("people.follow_all_busy", { done: followState.done, total: worthPeople.length })
                              : t("people.follow_all")}
                          </button>
                        )
                      }
                    />
                  </div>
                )}
                {peopleView === "insight" && (
                  <div className="people-grid">
                    {owner === defaultOwner ? (
                      <>
                        {radar ? (
                          <RadarPanel radar={radar} t={t} onOpen={openOwner} />
                        ) : (
                          <div className="panel">
                            <h2>{t("people.radar_title")}</h2>
                            <p className="muted">{t("people.radar_empty")}</p>
                          </div>
                        )}
                        {stargazers ? (
                          <StargazersPanel entries={Object.values(stargazers)} owner={owner} t={t} onOpen={openOwner} />
                        ) : (
                          <div className="panel">
                            <h2>{t("people.sg_title")}</h2>
                            <p className="muted">{t("people.sg_empty")}</p>
                          </div>
                        )}
                      </>
                    ) : (
                      // radar + stargazer profiles are generated for the
                      // default owner only — show the same hint for both.
                      <>
                        <div className="panel">
                          <h2>{t("people.radar_title")}</h2>
                          <p className="muted">{t("people.radar_owner_only", { owner: defaultOwner || "OWNER" })}</p>
                        </div>
                        <div className="panel">
                          <h2>{t("people.sg_title")}</h2>
                          <p className="muted">{t("people.sg_owner_only", { owner: defaultOwner || "OWNER" })}</p>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {peopleView === "list" && (
                  <>
                    {peopleDiff && peopleDiff.has_history && (
                      <div className="panel people-diff" style={{ gridColumn: "1 / -1" }}>
                        <h2>{t("people.diff_title")}</h2>
                        <div className="diff-grid">
                          <DiffLine label={t("people.diff_new_followers")} items={peopleDiff.added.followers} t={t} />
                          <DiffLine label={t("people.diff_gone_followers")} items={peopleDiff.gone.followers} t={t} />
                          <DiffLine label={t("people.diff_new_following")} items={peopleDiff.added.following} t={t} />
                          <DiffLine label={t("people.diff_gone_following")} items={peopleDiff.gone.following} t={t} />
                        </div>
                      </div>
                    )}
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
              </>
            )}
          </div>
          )}
        </>
      )}
    </div>
  );
}

// (RadarPanel moved to dashboard/lists.tsx — see RadarPanel there.)
// (DiffLine + RelationPanel moved to dashboard/panels.tsx)
