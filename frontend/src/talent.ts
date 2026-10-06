import type { Overview, TalentSignals } from "./types";
import type { Lang } from "./i18n";

const YEAR_MS = 365 * 86400000;

// ---- talent-domain strings (labels / cadence / HR note) — bilingual.
// Kept here rather than i18n.ts: they belong to the note pipeline, not the
// dashboard chrome. Functions default to "en" so callers without a lang
// context (SSR-independent code paths) keep the previous behaviour.

const TAL: Record<Lang, Record<string, string>> = {
  zh: {
    label_active: "活跃维护者",
    label_archived: "有归档项目",
    label_forks: "常 fork 收藏",
    label_docs: "文档齐全",
    label_license: "带许可证开源",
    label_topics: "打主题标签",
    label_focused: "专注型作品集",
    label_community: "社区关注度高",
    cad_unknown: "活跃度未知",
    cad_month: "本月有推送",
    cad_quarter: "本季度活跃",
    cad_year: "一年内有推送",
    cad_months_ago: "{n} 个月前有推送",
    hrn_title: "@{owner} — 开源人才画像",
    hrn_repos: "{count} 个公开仓库（{non_fork} 个原创）。{since}主要语言 {lang}（{pct}）。",
    hrn_since: "自 {year} 起加入 GitHub。",
    hrn_output: "产出：近 90 天 {pct}% 仓库活跃；{cad}。",
    hrn_rigor: "严谨度：{doc}% 有文档、{lic}% 带许可证、{top}% 打主题标签。",
    hrn_signals: "信号：{labels}。",
    hrn_health: "开源健康度 {total}/100（活跃 {a}、严谨 {r}、专注 {f}、影响 {i}）。",
    hrn_md_head: "# 开源人才画像 — @{owner}\n\n",
    hrn_md_foot: "\n_权重 — 活跃 {a}% · 严谨 {r}% · 专注 {f}% · 影响 {i}% · 数据源：GitHub 公开仓库快照。_\n",
  },
  en: {
    label_active: "Active maintainer",
    label_archived: "Has archived projects",
    label_forks: "Curates via forks",
    label_docs: "Documents work",
    label_license: "Open-sources with licenses",
    label_topics: "Tags topics",
    label_focused: "Focused portfolio",
    label_community: "Followed community",
    cad_unknown: "unknown cadence",
    cad_month: "pushing this month",
    cad_quarter: "active this quarter",
    cad_year: "pushed within a year",
    cad_months_ago: "last push {n} months ago",
    hrn_title: "@{owner} — open-source talent read",
    hrn_repos: "{count} public repos ({non_fork} original). {since}Top language {lang} ({pct}).",
    hrn_since: "GitHub since {year}. ",
    hrn_output: "Output: {pct}% of repos active in the last 90 days; {cad}.",
    hrn_rigor: "Rigor: {doc}% documented, {lic}% licensed, {top}% topic-tagged.",
    hrn_signals: "Signals: {labels}.",
    hrn_health: "Open-source health {total}/100 (activity {a}, rigor {r}, focus {f}, influence {i}).",
    hrn_md_head: "# Open-source talent read — @{owner}\n\n",
    hrn_md_foot: "\n_Weights used — activity {a}% · rigor {r}% · focus {f}% · influence {i}% · source: GitHub public repos snapshot._\n",
  },
};

function fill(s: string, p: Record<string, string | number>): string {
  for (const [k, v] of Object.entries(p)) {
    s = s.replace("{" + k + "}", String(v));
  }
  return s;
}

function tal(lang: Lang, key: string): string {
  return TAL[lang][key] ?? TAL.en[key] ?? key;
}

function nowYear(): number {
  return new Date().getFullYear();
}

// Percent helper: 0..1 -> "N%"
export function pct(r: number): string {
  return Math.round(r * 100) + "%";
}

function topLangs(ov: Overview): [string, string[], number] {
  const entries = Object.entries(ov.languages).sort((a, b) => b[1] - a[1]);
  const top = entries.length ? entries[0][0] : "—";
  const rest = entries.slice(1, 4).map((e) => e[0]);
  // primary + secondary share — a cross-stack dev (e.g. TS+JS) is "focused",
  // not scattered. Returns the two-language share (0..1).
  const top2 = (entries[0]?.[1] ?? 0) + (entries[1]?.[1] ?? 0);
  return [top, rest, top2];
}

// Derive the recruiter-facing signals from an Overview.
export function deriveTalent(ov: Overview, lang: Lang = "en"): TalentSignals {
  const n = Math.max(1, ov.count || 1);
  const active = ov.recency?.active ?? 0; // repos pushed within 90d
  const [top, secondaries, top2] = topLangs(ov);
  const recent90 = active;

  let memberSince: number | null = null;
  let tenure: number | null = null;
  const created = ov.profile?.created_at;
  if (created) {
    const t = new Date(created).getTime();
    if (!Number.isNaN(t)) {
      memberSince = new Date(created).getFullYear();
      tenure = Math.max(0, Math.round((Date.now() - t) / YEAR_MS));
    }
  }

  const t = ov.talent;
  const topRepo = ov.top_by_stars?.[0];
  const labels: string[] = [];

  // Output / maintenance
  if (active > 0) labels.push(tal(lang, "label_active"));
  if ((ov.totals?.archived ?? 0) > 0) labels.push(tal(lang, "label_archived"));
  if ((ov.totals?.forked ?? 0) > 0) labels.push(tal(lang, "label_forks"));

  // Rigor
  if (t && t.with_desc / n >= 0.8) labels.push(tal(lang, "label_docs"));
  if (t && t.with_license / n >= 0.4) labels.push(tal(lang, "label_license"));
  if (t && t.with_topics / n >= 0.4) labels.push(tal(lang, "label_topics"));

  // Focus
  if (ov.non_fork_count && ov.non_fork_count <= 20) labels.push(tal(lang, "label_focused"));

  // Influence
  if ((ov.profile?.followers ?? 0) >= 100) labels.push(tal(lang, "label_community"));

  return {
    member_since_year: memberSince,
    tenure_years: tenure,
    output_ratio: active / n,
    avg_days_since_push: t?.avg_days_since_push ?? 0,
    desc_ratio: t ? t.with_desc / n : 0,
    license_ratio: t ? t.with_license / n : 0,
    topics_ratio: t ? t.with_topics / n : 0,
    top_lang: top,
    top_lang_ratio: (ov.languages?.[top] ?? 0) / n,
    top2_ratio: top2 / n,
    recent_active_ratio: recent90 / n,
    secondary_langs: secondaries,
    followers: ov.profile?.followers ?? 0,
    top_star_repo: topRepo ? { name: topRepo.name, stars: topRepo.stars } : null,
    labels,
  };
}

// Human-readable phrase for the last-push cadence.
export function cadence(d: number, lang: Lang = "en"): string {
  if (d < 0) return tal(lang, "cad_unknown");
  if (d <= 30) return tal(lang, "cad_month");
  if (d <= 90) return tal(lang, "cad_quarter");
  if (d <= 365) return tal(lang, "cad_year");
  return fill(tal(lang, "cad_months_ago"), { n: Math.round(d / 30) });
}

// ---- composite "open-source health" score (0–100) ----------------------
// Four weighted pillars. Weights are a single tweakable object so an HR team
// can re-balance what matters most to them. Everything is derived from the
// already-computed TalentSignals — no extra data.
export interface HealthWeights {
  activity: number; // currently shipping + maintenance cadence
  rigor: number;    // documentation / license / topic coverage
  focus: number;    // language concentration (specialization)
  influence: number; // followers + top-repo attention
}

// Default weighting: activity is the strongest hiring signal.
export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  activity: 0.4,
  rigor: 0.3,
  focus: 0.2,
  influence: 0.1,
};

// The weights are an HR-team preference, so they persist per-browser.
const W_KEY = "lume-talentlens.health-weights.v1";

export function loadHealthWeights(): HealthWeights {
  try {
    const raw = localStorage.getItem(W_KEY);
    if (!raw) return { ...DEFAULT_HEALTH_WEIGHTS };
    const p = JSON.parse(raw) as Partial<HealthWeights>;
    return {
      activity: num(p.activity, DEFAULT_HEALTH_WEIGHTS.activity),
      rigor: num(p.rigor, DEFAULT_HEALTH_WEIGHTS.rigor),
      focus: num(p.focus, DEFAULT_HEALTH_WEIGHTS.focus),
      influence: num(p.influence, DEFAULT_HEALTH_WEIGHTS.influence),
    };
  } catch {
    return { ...DEFAULT_HEALTH_WEIGHTS };
  }
}

export function saveHealthWeights(w: HealthWeights): void {
  try {
    localStorage.setItem(W_KEY, JSON.stringify(w));
  } catch {
    // storage unavailable (private mode) — degrade silently
  }
}

function num(v: number | undefined, d: number): number {
  return typeof v === "number" && isFinite(v) && v >= 0 ? v : d;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Each pillar returns 0..1; the weighted sum is scaled to 0–100.
export function pillarScores(t: TalentSignals): {
  activity: number;
  rigor: number;
  focus: number;
  influence: number;
} {
  // activity — "is still shipping": weight the last-90d share heavily, and
  // add a small recency bonus so a fresh push this month scores above an
  // old one. The bonus uses a floored floor (never below 0.5 factor) so a
  // handful of stale archived repos can't zero the whole pillar out.
  const recencyFactor =
    t.avg_days_since_push >= 0
      ? clamp01(Math.max(0.5, 1 - t.avg_days_since_push / 730)) // 2y+ -> 0.5, not 0
      : 0.5;
  const activity = clamp01(0.8 * t.recent_active_ratio + 0.2 * recencyFactor);

  // rigor: average of the three coverage ratios.
  const rigor = clamp01((t.desc_ratio + t.license_ratio + t.topics_ratio) / 3);

  // focus: primary + secondary language share. A cross-stack dev (TS+JS, or
  // Python+Rust) still reads as "specialized", not scattered.
  const focus = clamp01(t.top2_ratio);

  // influence: followers on a *personal-developer* scale (÷2, not ÷3) so 100
  // followers already reads as strong, plus top-repo attention.
  const infFollowers = clamp01(Math.log10(t.followers + 1) / 2); // 100 -> ~0.97
  const topStars = t.top_star_repo ? clamp01(t.top_star_repo.stars / 20) : 0;
  const influence = clamp01(0.6 * infFollowers + 0.4 * topStars);
  return { activity, rigor, focus, influence };
}

export function healthScore(
  t: TalentSignals,
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS
): { total: number; pillars: ReturnType<typeof pillarScores> } {
  const pillars = pillarScores(t);
  const sumW = w.activity + w.rigor + w.focus + w.influence || 1;
  const total = Math.round(
    (pillars.activity * w.activity +
      pillars.rigor * w.rigor +
      pillars.focus * w.focus +
      pillars.influence * w.influence) /
      sumW *
      100
  );
  return { total, pillars };
}

// A short, copy-paste-ready recruiting note (plain text / Markdown).
export function toHrNote(
  ov: Overview,
  t: TalentSignals,
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
  lang: Lang = "en"
): string {
  const { total, pillars } = healthScore(t, w);
  const L: string[] = [];
  L.push(fill(tal(lang, "hrn_title"), { owner: ov.owner }));
  L.push(
    fill(tal(lang, "hrn_repos"), {
      count: ov.count,
      non_fork: ov.non_fork_count,
      since: t.member_since_year ? fill(tal(lang, "hrn_since"), { year: t.member_since_year }) : "",
      lang: t.top_lang,
      pct: pct(t.top_lang_ratio),
    })
  );
  L.push(
    fill(tal(lang, "hrn_output"), {
      pct: Math.round(t.output_ratio * 100),
      cad: cadence(t.avg_days_since_push, lang),
    })
  );
  L.push(
    fill(tal(lang, "hrn_rigor"), {
      doc: pct(t.desc_ratio),
      lic: pct(t.license_ratio),
      top: pct(t.topics_ratio),
    })
  );
  if (t.labels.length) L.push(fill(tal(lang, "hrn_signals"), { labels: t.labels.join(", ") }));
  L.push(
    fill(tal(lang, "hrn_health"), {
      total,
      a: Math.round(pillars.activity * 100),
      r: Math.round(pillars.rigor * 100),
      f: Math.round(pillars.focus * 100),
      i: Math.round(pillars.influence * 100),
    })
  );
  return L.join("\n");
}

// Build a standalone Markdown document for download (title + the note).
export function hrNoteMarkdown(
  ov: Overview,
  t: TalentSignals,
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
  lang: Lang = "en"
): string {
  const head = fill(tal(lang, "hrn_md_head"), { owner: ov.owner });
  const foot = fill(tal(lang, "hrn_md_foot"), {
    a: Math.round(w.activity * 100),
    r: Math.round(w.rigor * 100),
    f: Math.round(w.focus * 100),
    i: Math.round(w.influence * 100),
  });
  return head + toHrNote(ov, t, w, lang) + foot;
}

// Trigger a browser download of the .md. Returns a promise resolving on click.
export function downloadHrNote(
  ov: Overview,
  t: TalentSignals,
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
  lang: Lang = "en"
): void {
  const md = hrNoteMarkdown(ov, t, w, lang);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `talent-note-${ov.owner}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function currentYear(): number {
  return nowYear();
}
