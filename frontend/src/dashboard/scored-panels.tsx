import React from "react";
import type { Radar, StargazerEntry } from "../types";
import { RADAR_SCORE } from "./people-list";

// Talent-radar + stargazer profile panels. Split out of lists.tsx (which now
// just re-exports). Both render scored people profiles (influence formula from
// scripts/radar-scan.sh / stargazers-scan.sh).

// Mutual high scorers from radar.json (make radar), grouped by the money
// pattern radar-scan.sh classified, each with its evidence note and — when
// the scan produced them — monetization-signal badges: a real profile URL
// ("site"), a repo with a homepage ("product" — the classic SaaS/paid tell),
// or a GitHub Sponsors listing ("sponsor"). A row with no signals shows a
// quiet "no public monetization signal" so every person is accounted for.
export const RADAR_MODES = ["startup", "crypto", "company", "content", "tools", "hunting", "other"];

function sigUrl(blog: string | undefined): string {
  if (!blog) return "";
  return /^https?:/.test(blog) ? blog : "https://" + blog;
}

export function RadarPanel({ radar, t, onOpen }: {
  radar: Radar; t: (k: string, p?: Record<string, string | number>) => string;
  onOpen: (login: string) => void;
}) {
  const groups = RADAR_MODES
    .map((m) => ({ mode: m, people: radar.people.filter((p) => p.mode === m) }))
    .filter((g) => g.people.length > 0);
  if (groups.length === 0) return null;
  // freshness: profiles/classifications go stale — nudge a rescan when the
  // scan is more than a week old
  const scanMs = new Date(radar.scanned_at).getTime();
  const stale = Number.isFinite(scanMs) && Date.now() - scanMs > 7 * 86400000;
  return (
    <div className="panel radar-panel" style={{ gridColumn: "1 / -1" }}>
      <h2>
        {t("people.radar_title")}{" "}
        <span className="muted">{t("people.radar_meta", { n: radar.people.length, at: radar.scanned_at.slice(0, 10) })}</span>
        {stale && <span className="chip radar">{t("people.radar_stale")}</span>}
        {radar.self && typeof radar.self.score === "number" ? (
          <span className="radar-self muted">
            {t("people.radar_self", { me: radar.self.login, score: radar.self.score, line: radar.min_score })}
          </span>
        ) : null}
      </h2>
      <div className="radar-groups">
        {groups.map((g) => (
          <div key={g.mode} className="radar-group" data-mode={g.mode}>
            <div className="radar-mode">{t("people.radar_mode_" + g.mode)} <span className="muted">{g.people.length}</span></div>
            {g.people.map((p) => (
              <div key={p.login} className="radar-row">
                <button className="radar-person" onClick={() => onOpen(p.login)}>
                  <span className="radar-login">@{p.login} <span className="chip radar">{p.score}☆</span></span>
                  <span className="radar-note">{p.note}</span>
                  <span className="radar-signals">
                    {p.signals && p.signals.length > 0 ? (
                      <>
                        {p.signals.includes("site") && p.blog ? (
                          <a className="chip sig" href={sigUrl(p.blog)} target="_blank" rel="noreferrer"
                             title={t("people.radar_sig_site_tip", { url: p.blog })}>{t("people.radar_sig_site")}</a>
                        ) : null}
                        {p.signals.includes("product") ? (
                          <span className="chip sig" title={t("people.radar_sig_product_tip")}>{t("people.radar_sig_product")}</span>
                        ) : null}
                        {p.signals.includes("sponsor") ? (
                          <a className="chip sig sig-sponsor" href={"https://github.com/sponsors/" + p.login}
                             target="_blank" rel="noreferrer"
                             title={t("people.radar_sig_sponsor_tip")}>{t("people.radar_sig_sponsor")}</a>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted radar-sig-none">{t("people.radar_sig_none")}</span>
                    )}
                  </span>
                </button>
                <a
                  className="radar-ext"
                  href={"https://github.com/" + p.login}
                  target="_blank"
                  rel="noreferrer"
                  title={"github.com/" + p.login}
                >
                  ↗
                </a>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Stargazer profile: everyone who starred this owner's repos, scored with
// the same influence formula as /api/people (scripts/stargazers-scan.sh).
// Sorted by score; SELF / EXPERT (>= RADAR_SCORE) / water flagged.
export function StargazersPanel({ entries, owner, t, onOpen }: {
  entries: StargazerEntry[]; owner: string;
  t: (k: string, p?: Record<string, string | number>) => string;
  onOpen: (login: string) => void;
}) {
  if (entries.length === 0) return null;
  const rows = [...entries].sort((a, b) => b.score - a.score);
  return (
    <div className="panel sg-panel" style={{ gridColumn: "1 / -1" }}>
      <h2>
        {t("people.sg_title")}{" "}
        <span className="muted">{t("people.sg_meta", { n: entries.length })}</span>
      </h2>
      <div className="sg-table">
        <div className="sg-row sg-head">
          <span>{t("people.sg_login")}</span>
          <span>{t("people.sg_score")}</span>
          <span>{t("people.sg_repos")}</span>
          <span>{t("people.sg_followers")}</span>
          <span>{t("people.sg_starred")}</span>
          <span>{t("people.sg_flag")}</span>
        </div>
        {rows.map((e) => {
          const isSelf = e.login === owner;
          const expert = !isSelf && e.score >= RADAR_SCORE;
          const water = !isSelf && !expert && !!e.sus_penalty;
          return (
            <div key={e.login} className="sg-row">
              <button className="sg-login" onClick={() => onOpen(e.login)}>@{e.login}</button>
              <span className={expert ? "sg-score hot" : "sg-score"}>{e.score}</span>
              <span>{e.repos}</span>
              <span>{e.followers}</span>
              <span>{e.starred_repos}</span>
              <span>
                {isSelf ? <span className="chip sg-self">{t("people.sg_flag_self")}</span>
                  : expert ? <span className="chip radar">{t("people.sg_flag_expert")}</span>
                  : water ? <span className="chip suspect">{t("people.sg_flag_water")}</span>
                  : <span className="muted">—</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
