import React from "react";
import { api } from "../api";
import { useLang, useT } from "../i18n";
const WINDOWS: Array<"daily" | "weekly" | "monthly"> = ["daily", "weekly", "monthly"];// GitHub trending projects — a standalone dashboard tab that does NOT depend
// on the selected owner/snapshot. The server (/api/trending) scrapes
// github.com/trending itself (exact list/order/star counts) and returns an
// already-slimmed item list; it falls back to the Search API (repos created
// within the window, sorted by stars) when the page can't be parsed.

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

function homeUrl(h: string): string {
  return /^https?:/.test(h) ? h : "https://" + h;
}

export interface PersonalProfile {
  langs: Record<string, number>; // normalized language weights 0..1
  topics: Set<string>;
  topLangs: Array<{ name: string; w: number }>;
}

export function buildProfile(ov?: any | null): PersonalProfile | null {
  if (!ov) return null;
  const langs = ov.languages || {};
  const entries = Object.entries(langs).sort((a:any,b:any)=>(b[1] as number)-(a[1] as number));
  if (entries.length === 0) return null;
  const max = entries[0][1] || 1;
  const out: Record<string, number> = {};
  const topLangs: Array<{name:string,w:number}> = [];
  for (const [k,v] of entries) {
    const w = (v as number) / (max as number);
    out[k] = w;
    if (topLangs.length < 3) topLangs.push({name:k,w});
  }
  const topics = new Set<string>();
  const repos = [...(ov.top_by_stars||[]), ...(ov.top_by_activity||[])];
  for (const r of repos) {
    for (const tp of (r.topics||[])) {
      topics.add(tp.toLowerCase());
    }
  }
  return { langs: out, topics, topLangs };
}

export function matchScore(it: any, p: PersonalProfile | null): number {
  if (!p) return 0;
  let s = 0;
  // language 60%
  const itLang = (it.lang||"").toLowerCase();
  const langKey = Object.keys(p.langs).find(k=>k.toLowerCase()===itLang);
  if (langKey && p.langs[langKey]) s += p.langs[langKey]*60;
  // topics 40%
  const itTopics = (it.topics||[]).map((x:any)=>x.toLowerCase());
  if (itTopics.length>0 && p.topics.size>0) {
    let c=0;
    for (const tp of itTopics) if (p.topics.has(tp)) c++;
    s += (c/Math.max(1,itTopics.length))*40;
  }
  if (s<0) s=0; if (s>100) s=100;
  return Math.round(s);
}

export function matchDetail(it: any, p: PersonalProfile | null): { lang: string | null; topics: string[] } {
  if (!p) return { lang: null, topics: [] };
  const itLang = (it.lang || "").toLowerCase();
  const langKey = Object.keys(p.langs).find((k) => k.toLowerCase() === itLang) || null;
  const hits: string[] = [];
  for (const tp of (it.topics || []).map((x: any) => String(x).toLowerCase())) {
    if (p.topics.has(tp)) hits.push(tp);
  }
  return { lang: langKey, topics: hits.slice(0, 3) };
}

function TrendRow({ it, rank, score, reasons }: { it: any; rank: number; score?: number; reasons?: string }) {
  const t = useT();
  // machine-translated description (when the UI is Chinese and the server
  // provided one); the English original stays available via the title tooltip.
  const zh = it.desc_zh && it.desc_zh.trim() !== "" ? it.desc_zh : "";
  const shown = zh || it.desc;
  const showScore = typeof score === "number";
  return (
    <li className="trend-card">
      <span className="rank">{rank}</span>
      <div className="trend-body">
        <div className="trend-top">
          <a className="repo-name" href={it.url} target="_blank" rel="noreferrer">{it.full_name}</a>
          <span className="chip">{it.lang || "—"}</span>
          <span className="chip">★ {it.stars}</span>
          <span className="chip">⑂ {it.forks}</span>
          {showScore ? <span className="chip match" title={reasons || undefined}>{t("trend.match_pct", { score: String(score ?? 0) })}</span> : null}
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
              {it.topics.slice(0, 6).map((tp: any) => (
                <span key={tp} className="chip topic">{tp}</span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function TrendingPanel({ owner = "", ov }: { owner?: string; ov?: any | null }) {
  const t = useT();
  // UI language drives automatic description translation; `lang` below is the
  // unrelated GitHub-language FILTER for the search query.
  const { lang: uiLang } = useLang();
  const [scope, setScope] = React.useState<"global" | "owner">("global");
  const [since, setSince] = React.useState<"daily" | "weekly" | "monthly">("daily");
  const [langDraft, setLangDraft] = React.useState("");
  const [lang, setLang] = React.useState("");
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [order, setOrder] = React.useState<"trend" | "match">("trend");
  const seq = React.useRef(0);

  // owner scope only makes sense with a resolved login
  const ownerScope = scope === "owner" && owner !== "";

  const load = React.useCallback((force?: boolean) => {
    const s = ++seq.current;
    setLoading(true);
    setErr("");
    api.trending(since, lang, uiLang === "zh" ? "zh" : "", ownerScope ? owner : undefined, force).then((r) => {
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

  const prof = React.useMemo(() => buildProfile(ov), [ov]);
  const items0 = data?.items ?? [];
  const items = React.useMemo(() => {
    if (order !== "match" || !prof) return items0;
    const withs = items0.map((it: any) => ({ it, score: matchScore(it, prof) }));
    return withs.sort((a:any,b:any)=>b.score-a.score).map((x:any)=>x.it);
  }, [items0, order, prof]);

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
        {prof ? (
          <div className="trend-windows">
            <button className={order==="trend"?"chip subtab active":"chip subtab"} onClick={()=>setOrder("trend")}>{t("trend.order_trend")}</button>
            <button className={order==="match"?"chip subtab active":"chip subtab"} onClick={()=>setOrder("match")}>{t("trend.order_match")}</button>
          </div>
        ) : null}
        <div className="search-row trend-lang">
          <input
            className="search-input"
            placeholder={t("trend.lang_placeholder")}
            value={langDraft}
            onChange={(e) => setLangDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setLang(langDraft.trim())}
          />
          <button className="btn" onClick={() => setLang(langDraft.trim())}>{t("trend.apply")}</button>
          <button className="btn" onClick={() => load(true)} disabled={loading}>{t("trend.refresh")}</button>
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
            {prof && order==="match" ? <> · {t("trend.sorted_match")}</> : null}
          </p>
          {items.length === 0 ? (
            <p className="muted">{ownerScope ? t("trend.owner_empty", { owner }) : t("trend.empty")}</p>
          ) : (
            <ol className={loading ? "trend-list trend-list-loading" : "trend-list"}>
              {items.map((it: any, i: number) => {
                const score = prof ? matchScore(it, prof) : 0;
                const d = prof ? matchDetail(it, prof) : { lang: null, topics: [] as string[] };
                const reasonParts: string[] = [];
                if (d.lang) reasonParts.push(t("trend.rec_lang", { lang: d.lang }));
                if (d.topics.length > 0) reasonParts.push(t("trend.rec_topics", { topics: d.topics.join(", ") }));
                const reasons = reasonParts.join(" · ");
                return <TrendRow key={it.full_name} it={it} rank={i + 1} score={order==="match"||score>0? score: undefined} reasons={reasons} />;
              })}
            </ol>
          )}
          <p className="muted trend-note">{t("trend.hint")}</p>
        </>
      )}
    </section>
  );
}
