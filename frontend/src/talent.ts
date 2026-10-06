import type { Overview, TalentSignals } from "./types";

const YEAR_MS = 365 * 86400000;

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
export function deriveTalent(ov: Overview): TalentSignals {
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
  if (active >= 0) labels.push("Active maintainer");
  if ((ov.totals?.archived ?? 0) > 0) labels.push("Has archived projects");
  if ((ov.totals?.forked ?? 0) > 0) labels.push("Curates via forks");

  // Rigor
  if (t && t.with_desc / n >= 0.8) labels.push("Documents work");
  if (t && t.with_license / n >= 0.4) labels.push("Open-sources with licenses");
  if (t && t.with_topics / n >= 0.4) labels.push("Tags topics");

  // Focus
  if (ov.non_fork_count && ov.non_fork_count <= 20) labels.push("Focused portfolio");

  // Influence
  if ((ov.profile?.followers ?? 0) >= 100) labels.push("Followed community");

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
export function cadence(d: number): string {
  if (d < 0) return "unknown cadence";
  if (d <= 30) return "pushing this month";
  if (d <= 90) return "active this quarter";
  if (d <= 365) return "pushed within a year";
  return "last push " + Math.round(d / 30) + " months ago";
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
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS
): string {
  const { total, pillars } = healthScore(t, w);
  const L: string[] = [];
  L.push(`@${ov.owner} — open-source talent read`);
  L.push(
    `${ov.count} public repos (${ov.non_fork_count} original). ` +
      (t.member_since_year ? `GitHub since ${t.member_since_year}. ` : "") +
      `Top language ${t.top_lang} (${pct(t.top_lang_ratio)}).`
  );
  L.push(
    `Output: ${Math.round(t.output_ratio * 100)}% of repos active in the last 90 days; ${cadence(t.avg_days_since_push)}.`
  );
  L.push(
    `Rigor: ${pct(t.desc_ratio)} documented, ${pct(t.license_ratio)} licensed, ${pct(t.topics_ratio)} topic-tagged.`
  );
  if (t.labels.length) L.push(`Signals: ${t.labels.join(", ")}.`);
  L.push(
    `Open-source health ${total}/100 ` +
      `(activity ${Math.round(pillars.activity * 100)}, rigor ${Math.round(pillars.rigor * 100)}, ` +
      `focus ${Math.round(pillars.focus * 100)}, influence ${Math.round(pillars.influence * 100)}). `
  );
  return L.join("\n");
}

// Build a standalone Markdown document for download (title + the note).
export function hrNoteMarkdown(
  ov: Overview,
  t: TalentSignals,
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS
): string {
  const head = `# Open-source talent read — @${ov.owner}\n\n`;
  const foot =
    `\n_Weights used — activity ${Math.round(w.activity * 100)}% · rigor ` +
    `${Math.round(w.rigor * 100)}% · focus ${Math.round(w.focus * 100)}% · influence ` +
    `${Math.round(w.influence * 100)}% · source: GitHub public repos snapshot._\n`;
  return head + toHrNote(ov, t, w) + foot;
}

// Trigger a browser download of the .md. Returns a promise resolving on click.
export function downloadHrNote(
  ov: Overview,
  t: TalentSignals,
  w: HealthWeights = DEFAULT_HEALTH_WEIGHTS
): void {
  const md = hrNoteMarkdown(ov, t, w);
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
