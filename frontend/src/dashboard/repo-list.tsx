import React from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { isNoSnapshot } from "../types";
import type { RepoView } from "../types";

// Repo rows and the paged repo browser. Split out of lists.tsx (which now
// just re-exports). `BrowsePage` pages through /api/repos in cached mode, or
// slices the in-memory live array when `liveAll` is provided.

const RECCOLOR: Record<string, string> = {
  active: "#22c55e",
  recent: "#38bdf8",
  dormant: "#f59e0b",
  stale: "#64748b",
  unknown: "#475569",
};

export function RepoRow({ r, rank }: { r: RepoView; rank: number }) {
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
export function BrowsePage({ limit, setLimit, owner, liveAll, totalRepos }: {
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
