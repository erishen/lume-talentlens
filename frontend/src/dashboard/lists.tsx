import React from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { isNoSnapshot } from "../types";
import type { NoSnapshot, RepoView, PersonView } from "../types";

// Person lists (followers / following), repo rows, and the paged repo
// browser. `BrowsePage` pages through /api/repos in cached mode, or slices
// the in-memory live array when `liveAll` is provided.

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
export const RADAR_SCORE = 120; // influence score at/above which a person is "radar"

function PersonList({ title, people, totals, note, onOpen }: {
  title: string; people: PersonView[]; totals: number; note?: string;
  onOpen: (login: string) => void;
}) {
  const t = useT();
  const [byScore, setByScore] = React.useState(false);
  const scored = people.some((p) => typeof p.score === "number" && p.score > 0);
  const sorted = byScore
    ? [...people].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : people;
  return (
    <div className="panel">
      <h2>
        {title} <span className="muted">{t("people.shown_total", { shown: people.length, total: totals })}</span>
        {scored && (
          <button className="chip btn-sort" onClick={() => setByScore(!byScore)}>
            {byScore ? t("people.sort_default") : t("people.sort_score")}
          </button>
        )}
      </h2>
      {people.length === 0 && <p className="muted">{note || t("people.no_data")}</p>}
      {people.length > 0 && (
        <div className="person-list">
          {sorted.map((p, i) => (
            <button
              key={i}
              className="person-chip"
              onClick={() => onOpen(p.login)}
              title={t("people.click_name", { login: p.login })}
            >
              {p.avatar ? (
                <img
                  className="person-avatar"
                  src={p.avatar}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <span className="person-login">@{p.login}</span>
              {p.type === "Bot" ? <span className="chip bot">{t("people.bot")}</span> : null}
              {p.recruiter ? <span className="chip recruiter">{t("people.recruiter")}</span> : null}
              {(p.score ?? 0) < RADAR_SCORE && p.suspect === "high" ? <span className="chip suspect" title={evidenceTitle(t, p)}>{t("people.water")}</span> : null}
              {(p.score ?? 0) < RADAR_SCORE && p.suspect === "medium" ? <span className="chip suspect-med" title={evidenceTitle(t, p)}>{t("people.maybe_water")}</span> : null}
              {(p.score ?? 0) >= RADAR_SCORE ? <span className="chip radar">{t("people.radar")}</span> : null}
            </button>
          ))}
        </div>
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
function BrowsePage({ limit, setLimit, owner, liveAll }: {
  limit: number; setLimit: (n: number) => void; owner: string; liveAll: RepoView[] | null;
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
        <span className="muted">{cur}/{pages} · {total} {t("all.repos_short")}</span>
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

export { PersonList, RepoRow, BrowsePage };
