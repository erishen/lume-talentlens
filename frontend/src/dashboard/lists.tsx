import React from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { isNoSnapshot } from "../types";
import type { NoSnapshot, RepoView, PersonView, Radar, StargazerEntry } from "../types";

// Person lists (followers / following), repo rows, the paged repo
// browser, and the talent-radar panel (mutual high scorers grouped by
// money pattern with monetization-signal badges). `BrowsePage` pages
// through /api/repos in cached mode, or slices the in-memory live array
// when `liveAll` is provided.

const RECCOLOR: Record<string, string> = {
  active: "#22c55e",
  recent: "#38bdf8",
  dormant: "#f59e0b",
  stale: "#64748b",
  unknown: "#475569",
};

// tooltip for a suspect chip — API-confirmation evidence when available, else
// a plain hint that this is a pre-screen flag (no per-account data fetched)
function evidenceTitle(t: (k: string, p?: Record<string, string | number>) => string, p: PersonView): string {
  if (p.api) {
    return t("people.evidence", {
      followers: p.api.followers,
      repos: p.api.repos,
      created: p.api.created,
      note: p.api.note || "-",
    });
  }
  return t("people.click_name", { login: p.login });
}

// Followers / Following — a list of GitHub logins. Clicking one analyzes that
// person *in-app* (onOpen), it does NOT link out to their GitHub profile.
// When scores.json exists (make score), the header offers a by-influence sort
// and high scorers get a "radar" badge (the positive counterpart to the
// water-account flags). A high score also suppresses the water-account badge
// for the same person — a genuinely productive account flagged as a suspect
// is a false positive on the pre-screen, so radar wins.
export const RADAR_SCORE = 60; // people-score threshold for radar candidacy (2026-10 rework: quality-weighted, cap 93; radar re-scores with stars/activity)

// Shared person chip used by both the follower/following lists and the
// relation panels: avatar (or letter fallback), real name + @login, the
// water/recruiter/bot/radar labels and — when scored — the influence score
// (★ n; radar-green at >= RADAR_SCORE, muted grey below).
export function PersonChip({ p, t, onOpen, href }: {
  p: PersonView;
  t: (k: string, p2?: Record<string, string | number>) => string;
  onOpen?: (login: string) => void;
  href?: string;
}) {
  const score = p.score ?? 0;
  const inner = (
    <>
      {p.avatar ? (
        <img
          className="person-avatar"
          src={p.avatar}
          alt=""
          referrerPolicy="no-referrer"
          onError={(e) => {
            // broken avatar (deleted account / rate-limited CDN): hide
            // the img and show a letter chip instead
            (e.target as HTMLImageElement).style.display = "none";
            const next = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
            if (next) next.style.display = "inline-flex";
          }}
        />
      ) : null}
      <span
        className="person-avatar-letter"
        style={p.avatar ? { display: "none" } : undefined}
      >
        {(p.login || "?").slice(0, 1).toUpperCase()}
      </span>
      <span className="person-id">
        {p.name && p.name !== p.login ? <span className="person-name">{p.name}</span> : null}
        <span className="person-login">@{p.login}</span>
      </span>
      {p.type === "Bot" ? <span className="chip bot">{t("people.bot")}</span> : null}
      {p.recruiter ? <span className="chip recruiter">{t("people.recruiter")}</span> : null}
      {score < RADAR_SCORE && p.suspect === "high" ? <span className="chip suspect" title={evidenceTitle(t, p)}>{t("people.water")}</span> : null}
      {score < RADAR_SCORE && p.suspect === "medium" ? <span className="chip suspect-med" title={evidenceTitle(t, p)}>{t("people.maybe_water")}</span> : null}
      {score >= RADAR_SCORE ? <span className="chip radar">★ {score}</span> : null}
      {score > 0 && score < RADAR_SCORE && !p.suspect ? <span className="chip score-muted">★ {score}</span> : null}
    </>
  );
  if (href) {
    // relation-panel chip: the main body analyzes in-app (same click
    // behaviour as the follower lists), the small ↗ link opens GitHub.
    return (
      <span className="person-chip person-link">
        <button
          className="person-open"
          onClick={() => onOpen?.(p.login)}
          title={t("people.click_name", { login: p.login })}
        >
          {inner}
        </button>
        <a className="person-ext" href={href} target="_blank" rel="noreferrer" title={t("people.open_github")}>
          ↗
        </a>
      </span>
    );
  }
  return (
    <button
      className="person-chip"
      onClick={() => onOpen?.(p.login)}
      title={t("people.click_name", { login: p.login })}
    >
      {inner}
    </button>
  );
}

function PersonList({ title, people, totals, note, onOpen }: {
  title: string; people: PersonView[]; totals: number; note?: string;
  onOpen: (login: string) => void;
}) {
  const t = useT();
  // Default to the influence (score) sort — that's what the lists are for;
  // the toggle flips back to GitHub's native order.
  const [byScore, setByScore] = React.useState(true);
  // Long lists (hundreds of accounts) render the top chunk first; "show all"
  // expands the rest. Re-sorting resets back to the top chunk.
  const [showAll, setShowAll] = React.useState(false);
  const PAGE = 100;
  const scored = people.some((p) => typeof p.score === "number" && p.score > 0);
  const sorted = byScore
    ? [...people].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : people;
  const visible = showAll ? sorted : sorted.slice(0, PAGE);
  return (
    <div className="panel">
      <h2>
        {title} <span className="muted">{t("people.shown_total", { shown: visible.length, total: totals })}</span>
        {scored && (
          <button className="chip btn-sort" onClick={() => { setByScore(!byScore); setShowAll(false); }}>
            {byScore ? t("people.sort_score") : t("people.sort_default")}
          </button>
        )}
      </h2>
      {people.length === 0 && <p className="muted">{note || t("people.no_data")}</p>}
      {people.length > 0 && (
        <div className="person-list">
          {visible.map((p) => (
            <PersonChip key={p.login} p={p} t={t} onOpen={onOpen} />
          ))}
        </div>
      )}
      {people.length > PAGE && !showAll && (
        <p className="muted">
          <button className="chip btn-sort" onClick={() => setShowAll(true)}>
            {t("people.show_all", { n: people.length })}
          </button>
        </p>
      )}
      {people.length > 0 && totals > people.length && (
        <p className="muted">{t("people.more", { n: totals - people.length })}</p>
      )}
    </div>
  );
}

function RepoRow({ r, rank }: { r: RepoView; rank: number }) {
  const rc = RECCOLOR[r.recency] || RECCOLOR.unknown;
  return (
    <li className="repo-row">
      <span className="rank">{rank}</span>
      <a className="repo-name" href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
      <span className="chip">{r.lang || "—"}</span>
      <span className="chip">★ {r.stars}</span>
      <span className="chip">⑂ {r.forks}</span>
      <span className="chip" style={{ color: rc, borderColor: rc }}>{r.recency}</span>
      {r.is_fork && <span className="chip fork">fork</span>}
      {r.archived && <span className="chip archived">archived</span>}
    </li>
  );
}

// paged browser over /api/repos?owner= — OR, when liveAll is provided,
// paginate the in-memory live-fetched array client-side (no server call).
function BrowsePage({ limit, setLimit, owner, liveAll, totalRepos }: {
  limit: number; setLimit: (n: number) => void; owner: string;
  liveAll: RepoView[] | null; totalRepos?: number;
}) {
  const t = useT();
  const [offset, setOffset] = React.useState(0);
  const [page, setPage] = React.useState<RepoView[]>([]);
  const [total, setTotal] = React.useState(0);

  React.useEffect(() => {
    setOffset(0);
  }, [owner, liveAll]);

  React.useEffect(() => {
    if (liveAll) {
      // live mode: slice the in-memory array
      setTotal(liveAll.length);
      setPage(liveAll.slice(offset, offset + limit));
      return;
    }
    // cached mode: page through the server
    api.repos(offset, limit, owner).then((r) => {
      if (!isNoSnapshot(r)) {
        setTotal(r.total);
        setPage(r.repos);
      }
    });
  }, [offset, limit, owner, liveAll]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const cur = Math.floor(offset / limit) + 1;
  // changing the page size resets to page 1 — otherwise offset stays on a
  // non-multiple of the new limit and the "page N" indicator jumps around
  function setLimitSafe(n: number) {
    setOffset(0);
    setLimit(n);
  }

  return (
    <div>
      <div className="pager">
        <button className="chip" onClick={() => setLimitSafe(10)} disabled={limit === 10}>10</button>
        <button className="chip" onClick={() => setLimitSafe(25)} disabled={limit === 25}>25</button>
        <button className="chip" onClick={() => setLimitSafe(50)} disabled={limit === 50}>50</button>
        <span className="muted">{cur}/{pages} · {total} {t("all.repos_short")}
          {liveAll && totalRepos && totalRepos > liveAll.length
            ? ` · ${t("all.live_cap", { shown: liveAll.length, total: totalRepos })}`
            : ""}
        </span>
      </div>
      <ol className="top-list all">
        {page.map((r, i) => (
          <RepoRow key={r.name} r={r} rank={offset + i + 1} />
        ))}
      </ol>
      <div className="pager">
        <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>{t("all.prev")}</button>
        <button className="btn" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>{t("all.next")}</button>
      </div>
    </div>
  );
}

export { PersonList, RepoRow, BrowsePage, RADAR_MODES };

// ------------------------------------------------ talent radar panel
// Mutual high scorers from radar.json (make radar), grouped by the money
// pattern radar-scan.sh classified, each with its evidence note and — when
// the scan produced them — monetization-signal badges: a real profile URL
// ("site"), a repo with a homepage ("product" — the classic SaaS/paid tell),
// or a GitHub Sponsors listing ("sponsor"). A row with no signals shows a
// quiet "no public monetization signal" so every person is accounted for.

const RADAR_MODES = ["startup", "crypto", "company", "content", "tools", "hunting", "other"];

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
