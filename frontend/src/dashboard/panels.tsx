import React from "react";
import type { Overview, TalentSignals } from "../types";
import {
  deriveTalent, cadence, pct, healthScore, toHrNote, downloadHrNote,
  DEFAULT_HEALTH_WEIGHTS, type HealthWeights,
} from "../talent";
import { SignalBar } from "./bars";

// Recruiter-facing summary panels: the profile card ("who are they"), the
// talent-signal panel with re-weightable health score, the side-by-side
// comparison, and the last-12-months push trend.

// GitHub homepage / profile card — everything the `/users/{login}` endpoint
// exposes: avatar, name, bio, open-to-work, location/company, social links,
// snapshot meta. Rendered first so a recruiter sees the "who are they" before
// the numbers.
function ProfileCard({ ov }: { ov: Overview }) {
  const p = ov.profile;
  const year = p?.created_at ? new Date(p.created_at).getFullYear() : null;
  const social: { label: string; href: string; icon: string }[] = [];
  if (p?.html_url) social.push({ label: "GitHub", href: p.html_url, icon: "🐙" });
  if (p?.blog) social.push({ label: "Website", href: /^https?:/.test(p.blog) ? p.blog : "https://" + p.blog, icon: "🔗" });
  if (p?.twitter_username) social.push({ label: "@" + p.twitter_username, href: "https://twitter.com/" + p.twitter_username, icon: "🐦" });

  return (
    <section className="panel profile-card">
      <div className="pc-head">
        {p?.avatar_url ? (
          <img className="pc-avatar" src={p.avatar_url} alt={ov.owner} loading="lazy"
               onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="pc-avatar pc-avatar-fallback">{(ov.owner || "?").slice(0, 1).toUpperCase()}</div>
        )}
        <div className="pc-id">
          <h2>
            {p?.name || ov.owner}
            <span className="muted"> @{ov.owner}</span>
          </h2>
          <p className="pc-bio">{p?.bio || "No bio."}</p>
          <div className="pc-badges">
            {p?.hireable ? <span className="chip o2w" title="hireable flag on the GitHub profile">open to work</span> : null}
            {p?.location ? <span className="chip">📍 {p.location}</span> : null}
            {p?.company ? <span className="chip">🏢 {p.company}</span> : null}
            {year ? <span className="chip">member since {year}</span> : null}
          </div>
        </div>
      </div>

      <div className="pc-links">
        {social.length > 0 && (
          <div className="pc-social">
            {social.map((s) => (
              <a key={s.label} className="social-chip" href={s.href} target="_blank" rel="noreferrer" title={s.label}>
                {s.icon} <span>{s.label}</span>
              </a>
            ))}
          </div>
        )}
        <div className="pc-stats muted">
          <span><b>{p?.followers ?? 0}</b> followers</span>
          <span><b>{p?.following ?? 0}</b> following</span>
          <span><b>{p?.public_repos ?? ov.count}</b> repos</span>
          <span><b>{p?.public_gists ?? 0}</b> gists</span>
        </div>
      </div>

      <p className="pc-snapshot muted">snapshot {ov.fetched_at} · {ov.count} public repos ({ov.non_fork_count} original)</p>
    </section>
  );
}

// Recruiter-facing summary: tenure, output, rigor, focus, influence.
// Slider-based re-weighting of the health score. An HR team can tune what
// matters most to them; the change persists per browser (localStorage) and
// re-scores the panel, the compare view, and the candidate pool live.
function WeightTuner({ weights, onChange }: {
  weights: HealthWeights;
  onChange: (w: HealthWeights) => void;
}) {
  const rows: { key: keyof HealthWeights; label: string }[] = [
    { key: "activity", label: "Activity" },
    { key: "rigor", label: "Rigor" },
    { key: "focus", label: "Focus" },
    { key: "influence", label: "Influence" },
  ];
  return (
    <div className="weight-tuner">
      <div className="weight-tuner-head">
        <span className="muted">Re-weight the health score</span>
        <button
          className="chip"
          onClick={() => onChange({ ...DEFAULT_HEALTH_WEIGHTS })}
          title="Reset to defaults (40/30/20/10)"
        >
          reset
        </button>
      </div>
      {rows.map((r) => (
        <label className="weight-row" key={r.key}>
          <span className="weight-label">{r.label}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(weights[r.key] * 100)}
            onChange={(e) => onChange({ ...weights, [r.key]: Number(e.target.value) / 100 })}
          />
          <span className="weight-val">{Math.round(weights[r.key] * 100)}%</span>
        </label>
      ))}
    </div>
  );
}

function TalentPanel({ t, ov, weights, onWeights }: {
  t: TalentSignals; ov: Overview; weights: HealthWeights; onWeights: (w: HealthWeights) => void;
}) {
  const focusBits = [
    t.top_lang,
    t.secondary_langs.length ? t.secondary_langs.join(" / ") : null,
  ].filter(Boolean) as string[];
  const { total, pillars } = healthScore(t, weights);
  const [copied, setCopied] = React.useState(false);
  function copyNote() {
    const text = toHrNote(ov, t, weights);
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false)
    );
  }
  function dlNote() {
    downloadHrNote(ov, t, weights);
  }
  return (
    <section className="panel talent">
      <div className="talent-head">
        <div>
          <h2>Talent signals</h2>
          <p className="muted talent-lead">
            Recruiting reads of this GitHub footprint — derived from {ov.count} public repos, not a ranking.
          </p>
        </div>
        <div
          className="talent-score"
          title={`Activity ${Math.round(weights.activity * 100)}% · Rigor ${Math.round(weights.rigor * 100)}% · Focus ${Math.round(weights.focus * 100)}% · Influence ${Math.round(weights.influence * 100)}%`}
        >
          <div className="score-num">{total}</div>
          <div className="score-cap">open-source health /100</div>
        </div>
        <button className="btn" onClick={copyNote} title="Copy a recruiting note">
          {copied ? "✓ copied" : "Copy HR note"}
        </button>
        <button className="btn" onClick={dlNote} title="Download the recruiting note as a .md file">
          ↓ .md
        </button>
      </div>
      <div className="talent-pillars">
        <span>activity <b>{Math.round(pillars.activity * 100)}</b></span>
        <span>rigor <b>{Math.round(pillars.rigor * 100)}</b></span>
        <span>focus <b>{Math.round(pillars.focus * 100)}</b></span>
        <span>influence <b>{Math.round(pillars.influence * 100)}</b></span>
      </div>

      <WeightTuner weights={weights} onChange={onWeights} />

      <div className="talent-grid">
        <div className="talent-card">
          <h3>Tenure</h3>
          <div className="talent-big">
            {t.member_since_year ? `since ${t.member_since_year}` : "—"}
          </div>
          <p className="muted">
            {t.tenure_years != null ? t.tenure_years + " yrs on GitHub" : "account age unknown"}
          </p>
        </div>

        <div className="talent-card">
          <h3>Output &amp; maintenance</h3>
          <SignalBar label="Currently shipping" ratio={t.output_ratio} />
          <p className="muted">{cadence(t.avg_days_since_push)} · {Math.round(t.avg_days_since_push)}d avg to last push</p>
        </div>

        <div className="talent-card">
          <h3>Engineering rigor</h3>
          <SignalBar label="Documents repos" ratio={t.desc_ratio} />
          <SignalBar label="Adds licenses" ratio={t.license_ratio} />
          <SignalBar label="Tags topics" ratio={t.topics_ratio} />
        </div>

        <div className="talent-card">
          <h3>Focus &amp; influence</h3>
          <p><b>{t.top_lang}</b> {pct(t.top_lang_ratio)} · {focusBits.join(" · ")}</p>
          <p className="muted">
            {t.followers} followers
            {t.top_star_repo ? ` · top repo “${t.top_star_repo.name}” ★${t.top_star_repo.stars}` : null}
          </p>
        </div>
      </div>

      {t.labels.length > 0 && (
        <div className="talent-labels">
          {t.labels.map((l) => <span className="chip label" key={l}>{l}</span>)}
        </div>
      )}
    </section>
  );
}

// Side-by-side comparison of the current owner (A) against a second candidate
// (B). Both go through the same deriveTalent / healthScore pipeline so the
// numbers are directly comparable.
function ComparePanel({ ovA, ovB, weights }: {
  ovA: Overview; ovB: Overview; weights: HealthWeights;
}) {
  const ta = deriveTalent(ovA);
  const tb = deriveTalent(ovB);
  const sa = healthScore(ta, weights).total;
  const sb = healthScore(tb, weights).total;
  const row = (
    label: string, a: React.ReactNode, b: React.ReactNode,
    higherIsBetter?: boolean, aNum?: number, bNum?: number
  ) => {
    const aWins =
      aNum !== undefined && bNum !== undefined
        ? higherIsBetter ? aNum >= bNum : aNum <= bNum
        : false;
    return (
      <div className="cmp-row">
        <span className="cmp-label">{label}</span>
        <span className={"cmp-val " + (aWins ? "win" : "")}>{a}</span>
        <span className={"cmp-val " + (!aWins && aNum !== undefined ? "win" : "")}>{b}</span>
      </div>
    );
  };
  return (
    <section className="panel compare">
      <h2>
        Compare <code>@{ovA.owner}</code> vs <code>@{ovB.owner}</code>
      </h2>
      <div className="cmp-grid">
        <div className="cmp-head" />
        <div className="cmp-head">{ovA.owner}</div>
        <div className="cmp-head">{ovB.owner}</div>

        {row("Health /100", <b>{sa}</b>, <b>{sb}</b>, true, sa, sb)}
        {row("Repos", ovA.count, ovB.count, true, ovA.count, ovB.count)}
        {row("Original (non-fork)", ovA.non_fork_count, ovB.non_fork_count, true, ovA.non_fork_count, ovB.non_fork_count)}
        {row("Active ≤90d", ovA.recency.active || 0, ovB.recency.active || 0, true, ovA.recency.active || 0, ovB.recency.active || 0)}
        {row("Shipping", pct(ta.output_ratio), pct(tb.output_ratio), true, ta.output_ratio, tb.output_ratio)}
        {row(
          "Rigor",
          Math.round(((ta.desc_ratio + ta.license_ratio + ta.topics_ratio) / 3) * 100) + "%",
          Math.round(((tb.desc_ratio + tb.license_ratio + tb.topics_ratio) / 3) * 100) + "%",
          true,
          ta.desc_ratio + ta.license_ratio + ta.topics_ratio,
          tb.desc_ratio + tb.license_ratio + tb.topics_ratio
        )}
        {row("Top language", ta.top_lang + " " + pct(ta.top_lang_ratio), tb.top_lang + " " + pct(tb.top_lang_ratio))}
        {row("GitHub since", ta.member_since_year || "—", tb.member_since_year || "—")}
        {row("Followers", ta.followers, tb.followers, true, ta.followers, tb.followers)}
        {row("Stars (total)", ovA.totals.stars, ovB.totals.stars, true, ovA.totals.stars, ovB.totals.stars)}
      </div>
      <p className="muted cmp-note">Accent value wins each row · higher is better for all metrics shown.</p>
    </section>
  );
}

// Last-12-months push-activity trend (the recruiter "still shipping?" signal).
// Ordered newest → oldest; everything before the 12-month window is folded
// into a single "older" row. Uses the same .bar-* styling as `Bars`.
function PushTrend({ data }: { data: Record<string, number> }) {
  const months: string[] = [];
  const now = new Date();
  const cur = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }
  const inWindow = new Set(months);
  let older = 0;
  for (const [m, n] of Object.entries(data)) {
    if (!inWindow.has(m)) older += n;
  }
  const rows: { k: string; v: number }[] = months.map((m) => ({ k: m, v: data[m] || 0 }));
  if (older > 0) rows.push({ k: "older", v: older });
  const max = Math.max(1, ...rows.map((r) => r.v));
  const activeMonths = rows.filter((r) => r.v > 0 && r.k !== "older").length;
  return (
    <div className="panel">
      <h2>Push activity — last 12 mo</h2>
      <div className="bars">
        {rows.map((r) => (
          <div className="bar-row" key={r.k}>
            <span className="bar-label" title={r.k}>{r.k}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(r.v / max) * 100}%`, background: "#38bdf8" }} />
            </div>
            <span className="bar-val">{r.v}</span>
          </div>
        ))}
      </div>
      <p className="muted push-note">
        {activeMonths} of last 12 months had pushes · repos pushed this month: {data[cur] || 0}
      </p>
    </div>
  );
}

export { ProfileCard, TalentPanel, WeightTuner, ComparePanel, PushTrend };
