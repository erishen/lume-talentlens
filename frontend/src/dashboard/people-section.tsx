import React from "react";
import { exportPeopleCsv } from "../exportCsv";
import { PersonList, RadarPanel, StargazersPanel, RADAR_SCORE } from "./lists";
import { DiffLine, RelationPanel } from "./panels";
import type { People, PeopleDiff, PersonView, Radar, Stargazers } from "../types";
import type { FollowState } from "./useFollowActions";

// The whole "people" tab — split out of Dashboard.tsx so the dashboard file
// only wires the tab switch. Tools bar (refresh / export / unfollow water),
// the relation/insight/list sub-view tabs and every sub-view live here.

export interface PeopleSectionProps {
  people: People | null;
  peopleLoading: boolean;
  peopleError: string;
  peopleView: "relation" | "insight" | "list";
  setPeopleView: (v: "relation" | "insight" | "list") => void;
  owner: string;
  defaultOwner: string;
  peopleDiff: PeopleDiff | null;
  radar: Radar | null;
  stargazers: Stargazers | null;
  refreshMsg: string;
  refreshing: boolean;
  onRefresh: () => void;
  loadPeople: (o: string, viaLive: boolean) => void;
  viaLive: boolean;
  openOwner: (login: string) => void;
  followState: FollowState;
  unfollowState: FollowState;
  waterFollowing: PersonView[];
  followAll: (targets: PersonView[]) => void;
  unfollowWater: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

export function PeopleSection(props: PeopleSectionProps) {
  const {
    people, peopleLoading, peopleError,
    peopleView, setPeopleView,
    owner, defaultOwner,
    peopleDiff, radar, stargazers,
    refreshMsg, refreshing, onRefresh,
    loadPeople, viaLive, openOwner,
    followState, unfollowState, waterFollowing, followAll, unfollowWater,
    t,
  } = props;

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

  // Insights (radar + stargazer profiles) only exist for the default owner;
  // lists and relations work for every account. A stale "insight" view on a
  // non-default owner falls back to relations.
  const effectiveView = owner === defaultOwner || peopleView !== "insight" ? peopleView : "relation";

  return (
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
          <div className="no-snap-actions">
            <button className="btn" onClick={() => loadPeople(owner, viaLive)}>{t("people.retry")}</button>
            <button className="btn" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? t("people.refreshing") : t("people.refresh")}
            </button>
          </div>
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
              className={effectiveView === "relation" ? "chip subtab active" : "chip subtab"}
              onClick={() => setPeopleView("relation")}
            >
              {t("people.view_relation")}
            </button>
            {owner === defaultOwner && (
              <button
                className={effectiveView === "insight" ? "chip subtab active" : "chip subtab"}
                onClick={() => setPeopleView("insight")}
              >
                {t("people.view_insight")}
              </button>
            )}
            <button
              className={effectiveView === "list" ? "chip subtab active" : "chip subtab"}
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
          {effectiveView === "relation" && (
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
          {effectiveView === "insight" && owner === defaultOwner && (
            <div className="people-grid">
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
            </div>
          )}
          {effectiveView === "list" && (
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
  );
}
