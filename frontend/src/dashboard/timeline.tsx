import React from "react";
import { aggregateWeeks, type WeekBucket } from "../history";
import type { PeopleHistoryPoint } from "../types";

// Weekly follower/following trend — the recruiter "is this account growing?"
// signal. Daily snapshots (from make fetch / 刷新列表) are grouped into the
// last N weeks; clicking a week expands the exact logins that were added or
// lost, each of which analyzes that person in-app (onOpen).
export function PeopleTimeline({
  points,
  weeks = 12,
  onOpen,
  t,
}: {
  points: PeopleHistoryPoint[];
  weeks?: number;
  onOpen?: (login: string) => void;
  t: (k: string, params?: Record<string, string | number>) => string;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const buckets = React.useMemo(() => aggregateWeeks(points, weeks), [points, weeks]);

  if (!points || points.length === 0) {
    return (
      <div className="panel timeline" style={{ gridColumn: "1 / -1" }}>
        <h2>{t("people.timeline_title")}</h2>
        <p className="muted">{t("people.timeline_empty")}</p>
      </div>
    );
  }

  // scale the bars to the busiest week (either direction)
  const max = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.added.followers, b.gone.followers))
  );

  return (
    <div className="panel timeline" style={{ gridColumn: "1 / -1" }}>
      <h2>{t("people.timeline_title")}</h2>
      <p className="muted">{t("people.timeline_lead")}</p>
      <div className="tl-rows">
        {buckets.map((b) => {
          const isOpen = open === b.key;
          const quiet = b.added.followers === 0 && b.gone.followers === 0 &&
            b.added.following === 0 && b.gone.following === 0;
          return (
            <div className={"tl-item" + (isOpen ? " open" : "")} key={b.key}>
              <button
                className="tl-row"
                onClick={() => setOpen(isOpen ? null : b.key)}
                aria-expanded={isOpen}
                title={t("people.timeline_expand")}
              >
                <span className="tl-week">{b.label}</span>
                <span className="tl-bars">
                  <span
                    className="tl-bar add"
                    style={{ width: `${(b.added.followers / max) * 100}%` }}
                    title={t("people.timeline_added_f") + ": " + b.added.followers}
                  />
                  <span
                    className="tl-bar gone"
                    style={{ width: `${(b.gone.followers / max) * 100}%` }}
                    title={t("people.timeline_gone_f") + ": " + b.gone.followers}
                  />
                </span>
                <span className="tl-nums">
                  <span className="tl-add">+{b.added.followers}</span>
                  <span className="tl-gone">-{b.gone.followers}</span>
                  <span className={"tl-net " + (b.netFollowers >= 0 ? "up" : "down")}>
                    {b.netFollowers >= 0 ? "+" : ""}
                    {b.netFollowers}
                  </span>
                </span>
                <span className="muted tl-freq">{t("people.timeline_following_short", {
                  a: b.added.following, g: b.gone.following,
                })}</span>
              </button>
              {isOpen && (
                <WeekDetail bucket={b} onOpen={onOpen} t={t} quiet={quiet} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Expanded week: the actual logins, grouped by direction. Each login is a
// button that opens that person's in-app analysis (or, when the caller has no
// onOpen, a plain chip showing the handle).
function WeekDetail({
  bucket,
  onOpen,
  t,
  quiet,
}: {
  bucket: WeekBucket;
  onOpen?: (login: string) => void;
  t: (k: string, params?: Record<string, string | number>) => string;
  quiet: boolean;
}) {
  if (quiet) {
    return (
      <div className="tl-detail muted">
        {t("people.timeline_none_week")}
      </div>
    );
  }
  const groups: { key: string; label: string; logins: string[]; cls: string }[] = [
    { key: "af", label: t("people.timeline_added_f"), logins: bucket.addedFollowers, cls: "add" },
    { key: "gf", label: t("people.timeline_gone_f"), logins: bucket.goneFollowers, cls: "gone" },
    { key: "ag", label: t("people.timeline_added_g"), logins: bucket.addedFollowing, cls: "add" },
    { key: "gg", label: t("people.timeline_gone_g"), logins: bucket.goneFollowing, cls: "gone" },
  ].filter((g) => g.logins.length > 0);

  return (
    <div className="tl-detail">
      <div className="tl-days muted">{t("people.timeline_days", { n: bucket.days })}</div>
      {groups.map((g) => (
        <div className="tl-group" key={g.key}>
          <span className={"tl-group-label " + g.cls}>{g.label}</span>
          <div className="tl-logins">
            {g.logins.map((l) =>
              onOpen ? (
                <button
                  key={g.key + l}
                  className="chip tl-login"
                  onClick={() => onOpen(l)}
                  title={t("people.click_name", { login: l })}
                >
                  @{l}
                </button>
              ) : (
                <span className="chip tl-login" key={g.key + l}>
                  @{l}
                </span>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
