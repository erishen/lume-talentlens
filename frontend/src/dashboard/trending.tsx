import React from "react";
import { api } from "../api";
import { useLang, useT } from "../i18n";
import type { Trending, TrendingItem } from "../types";

// GitHub trending projects — a standalone dashboard tab that does NOT depend
// on the selected owner/snapshot. The server (/api/trending) emulates
// github.com/trending with the Search API (repos created within the window,
// sorted by stars) and returns an already-slimmed item list.

const WINDOWS: Array<"daily" | "weekly" | "monthly"> = ["daily", "weekly", "monthly"];

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

function homeUrl(h: string): string {
  return /^https?:/.test(h) ? h : "https://" + h;
}

function TrendRow({ it, rank }: { it: TrendingItem; rank: number }) {
  const t = useT();
  // machine-translated description (when the UI is Chinese and the server
  // provided one); the English original stays available via the title tooltip.
  const zh = it.desc_zh && it.desc_zh.trim() !== "" ? it.desc_zh : "";
  const shown = zh || it.desc;
  return (
    <li className="trend-card">
      <span className="rank">{rank}</span>
      <div className="trend-body">
        <div className="trend-top">
          <a className="repo-name" href={it.url} target="_blank" rel="noreferrer">{it.full_name}</a>
          <span className="chip">{it.lang || "—"}</span>
          <span className="chip">★ {it.stars}</span>
          <span className="chip">⑂ {it.forks}</span>
          {zh ? <span className="chip mt" title={t("trend.mt_title")}>{t("trend.mt")}</span> : null}
          {it.homepage ? (
            <a className="chip" href={homeUrl(it.homepage)} target="_blank" rel="noreferrer">
              {t("trend.homepage")}
            </a>
          ) : null}
        </div>
        {shown ? <p className="trend-desc" title={zh ? it.desc : undefined}>{shown}</p> : null}
        <div className="trend-sub muted">
          <span>@{it.owner}</span>
          <span>· {t("trend.created", { date: fmtDate(it.created_at) })}</span>
          {it.topics && it.topics.length > 0 ? (
            <span className="trend-topics">
              {it.topics.slice(0, 6).map((tp) => (
                <span key={tp} className="chip topic">{tp}</span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function TrendingPanel({ owner = "" }: { owner?: string }) {
  const t = useT();
  // UI language drives automatic description translation; `lang` below is the
  // unrelated GitHub-language FILTER for the search query.
  const { lang: uiLang } = useLang();
  const [scope, setScope] = React.useState<"global" | "owner">("global");
  const [since, setSince] = React.useState<"daily" | "weekly" | "monthly">("daily");
  const [langDraft, setLangDraft] = React.useState("");
  const [lang, setLang] = React.useState("");
  const [data, setData] = React.useState<Trending | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");
  const seq = React.useRef(0);

  // owner scope only makes sense with a resolved login
  const ownerScope = scope === "owner" && owner !== "";

  const load = React.useCallback(() => {
    const s = ++seq.current;
    setLoading(true);
    setErr("");
    api.trending(since, lang, uiLang === "zh" ? "zh" : "", ownerScope ? owner : undefined).then((r) => {
      if (s !== seq.current) return;
      if (r && r.ok) {
        setData(r);
      } else {
        setData(null);
        setErr((r && r.err) || t("trend.error"));
      }
      setLoading(false);
    }).catch((e) => {
      if (s !== seq.current) return;
      setData(null);
      setErr(String((e as Error)?.message || e));
      setLoading(false);
    });
  }, [since, lang, uiLang, ownerScope, owner, t]);

  React.useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];

  // an owner rarely ships daily — bump the default window when switching to
  // owner scope so the first result isn't almost always empty.
  const pickOwnerScope = () => {
    setScope("owner");
    if (since === "daily") setSince("monthly");
  };

  return (
    <section className="panel trend-panel">
      <h2>{t("trend.title")}</h2>
      <p className="muted trend-lead">
        {ownerScope ? t("trend.owner_lead", { owner }) : t("trend.lead")}
      </p>

      <div className="trend-controls">
        {owner ? (
          <div className="trend-windows">
            <button
              className={scope === "global" ? "chip subtab active" : "chip subtab"}
              onClick={() => setScope("global")}
            >
              {t("trend.scope_global")}
            </button>
            <button
              className={scope === "owner" ? "chip subtab active" : "chip subtab"}
              onClick={pickOwnerScope}
            >
              {t("trend.scope_owner", { owner })}
            </button>
          </div>
        ) : null}
        <div className="trend-windows">
          {WINDOWS.map((w) => (
            <button
              key={w}
              className={since === w ? "chip subtab active" : "chip subtab"}
              onClick={() => setSince(w)}
            >
              {t("trend." + w)}
            </button>
          ))}
        </div>
        <div className="search-row trend-lang">
          <input
            className="search-input"
            placeholder={t("trend.lang_placeholder")}
            value={langDraft}
            onChange={(e) => setLangDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setLang(langDraft.trim())}
          />
          <button className="btn" onClick={() => setLang(langDraft.trim())}>{t("trend.apply")}</button>
          <button className="btn" onClick={load} disabled={loading}>{t("trend.refresh")}</button>
        </div>
      </div>

      {loading && <p className="muted trend-loading">{t("trend.loading")}</p>}
      {err && <p className="err">{err}</p>}

      {/* keep the previous list mounted while a refresh is in flight, so the
          page height (and thus the scrollbar) never collapses mid-load — the
          old "swap the whole list for a one-line loading note" caused the
          layout to jump on every fetch. */}
      {data && (
        <>
          <p className="muted trend-meta">
            {ownerScope
              ? t("trend.owner_meta", { days: data.days ?? 0, owner, n: items.length })
              : t("trend.meta", { days: data.days ?? 0, n: items.length })}
            {data.cached ? <> · {t("trend.cached")}</> : null}
          </p>
          {items.length === 0 ? (
            <p className="muted">{ownerScope ? t("trend.owner_empty", { owner }) : t("trend.empty")}</p>
          ) : (
            <ol className={loading ? "trend-list trend-list-loading" : "trend-list"}>
              {items.map((it, i) => (
                <TrendRow key={it.full_name} it={it} rank={i + 1} />
              ))}
            </ol>
          )}
          <p className="muted trend-note">{t("trend.hint")}</p>
        </>
      )}
    </section>
  );
}
