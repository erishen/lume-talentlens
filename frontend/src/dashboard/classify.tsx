import React from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { Kpi } from "./bars";
import type { Classify, ClassifyCount, ClassifyRepo } from "../types";

// "归类总览" — GitHub classification rollup for the selected owner: the
// primary-language distribution and topic-tag frequency of the owner's PUBLIC
// repos created within a window (all rolled up server-side by /api/classify).

const WINDOWS: Array<"monthly" | "quarterly" | "year"> = ["monthly", "quarterly", "year"];

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

// language bars — rendered inline (NOT via <Bars>) so we don't nest a .panel
// inside the classify panel (which would draw a double border/shadow).
function LangBars({ items }: { items: ClassifyCount[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="bars">
      {items.map((it) => (
        <div className="bar-row" key={it.name}>
          <span className="bar-label" title={it.name}>{it.name}</span>
          <div className="bar-track">
            <div className="bar-fill cls-bar-fill" style={{ width: `${(it.count / max) * 100}%` }} />
          </div>
          <span className="bar-val">{it.count}</span>
        </div>
      ))}
    </div>
  );
}

function byCountDesc(items: ClassifyCount[]): ClassifyCount[] {
  return [...items].sort((a, b) => b.count - a.count);
}

function TagCloud({ items }: { items: ClassifyCount[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="cls-cloud">
      {items.map((it) => (
        <span className="chip topic cls-tag" key={it.name} style={{ fontSize: `${0.72 + 0.28 * (it.count / max)}rem` }}>
          {it.name}
          <b className="cls-tag-n">{it.count}</b>
        </span>
      ))}
    </div>
  );
}

function RepoCard({ r, rank }: { r: ClassifyRepo; rank: number }) {
  return (
    <li className="cls-repo">
      <span className="rank">{rank}</span>
      <div className="cls-repo-body">
        <div className="cls-repo-top">
          <a className="repo-name" href={r.url} target="_blank" rel="noreferrer">{r.full_name}</a>
          {r.lang ? <span className="chip">{r.lang}</span> : null}
          <span className="chip">★ {r.stars}</span>
        </div>
        {r.topics && r.topics.length > 0 ? (
          <div className="cls-repo-topics">
            {r.topics.slice(0, 8).map((tp) => <span className="chip topic" key={tp}>{tp}</span>)}
          </div>
        ) : null}
      </div>
      <span className="muted cls-repo-date" title={t0(r.created_at)}>{fmtDate(r.created_at)}</span>
    </li>
  );
}

// tiny helper so RepoCard doesn't need the i18n hook
function t0(s: string): string { return s; }

export function ClassifyPanel({ owner }: { owner: string }) {
  const t = useT();
  const [since, setSince] = React.useState<"monthly" | "quarterly" | "year">("quarterly");
  const [data, setData] = React.useState<Classify | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  const load = React.useCallback(() => {
    if (!owner) return;
    setLoading(true);
    setErr("");
    api.classify(owner, since).then((d) => {
      if (d && d.ok) {
        setData(d);
      } else {
        setErr((d && d.err) || t("classify.error"));
      }
      setLoading(false);
    }).catch((e) => {
      setErr(String((e && e.message) || e));
      setLoading(false);
    });
  }, [owner, since, t]);

  React.useEffect(() => { load(); }, [load]);

  const langs = byCountDesc(data?.languages ?? []);
  const topics = byCountDesc(data?.topics ?? []);
  const repos = data?.repos ?? [];
  const hasData = !!data;

  return (
    <section className="panel cls-panel">
      <h2>{t("classify.title", { owner: owner ? "@" + owner : "" })}</h2>
      <p className="muted cls-lead">{t("classify.lead")}</p>

      <div className="cls-controls">
        <div className="trend-windows">
          {WINDOWS.map((w) => (
            <button
              key={w}
              className={since === w ? "chip subtab active" : "chip subtab"}
              onClick={() => setSince(w)}
            >
              {t("classify." + w)}
            </button>
          ))}
        </div>
        <button className="btn cls-refresh" onClick={load} disabled={loading}>
          {loading ? t("classify.loading_short") : t("classify.refresh")}
        </button>
      </div>

      {err ? <p className="error cls-note">{err}</p> : null}
      {!owner ? <p className="muted cls-note">{t("classify.no_owner")}</p> : null}

      {hasData ? (
        <>
          <div className="kpis cls-kpis">
            <Kpi n={data!.count ?? 0} label={t("classify.kpi.repos")} />
            <Kpi n={langs.length} label={t("classify.kpi.langs")} />
            <Kpi n={topics.length} label={t("classify.kpi.topics")} />
          </div>

          <p className="muted cls-meta">
            {t("classify.meta", { days: data!.days ?? 0, n: data!.count ?? 0 })}
            {data!.truncated ? <> · {t("classify.truncated", { total: data!.total ?? 0 })}</> : null}
            {data!.cached ? <> · {t("classify.cached")}</> : null}
          </p>

          <div className={loading ? "cls-body cls-body-loading" : "cls-body"}>
            <div className="cls-grid">
              <div className="cls-col">
                <h3 className="cls-h3">{t("classify.languages")}</h3>
                {langs.length > 0 ? <LangBars items={langs} /> : <p className="muted">{t("classify.empty")}</p>}
              </div>
              <div className="cls-col">
                <h3 className="cls-h3">{t("classify.topics")}</h3>
                {topics.length > 0 ? <TagCloud items={topics} /> : <p className="muted">{t("classify.empty")}</p>}
              </div>
            </div>

            <h3 className="cls-h3 cls-repos-h">{t("classify.repos")}</h3>
            {repos.length > 0 ? (
              <ul className="cls-repos">
                {repos.map((r, i) => <RepoCard key={r.full_name} r={r} rank={i + 1} />)}
              </ul>
            ) : (
              <p className="muted">{t("classify.empty")}</p>
            )}
          </div>

          <p className="muted cls-hint">{t("classify.hint")}</p>
        </>
      ) : null}

      {loading && !hasData ? <p className="muted cls-note">{t("classify.loading")}</p> : null}
    </section>
  );
}
