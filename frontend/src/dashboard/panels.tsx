import React from "react";
import type { Overview, TalentSignals, PersonView } from "../types";
import { useLang, useT } from "../i18n";
import {
  deriveTalent, cadence, pct, healthScore, toHrNote, downloadHrNote,
  DEFAULT_HEALTH_WEIGHTS, type HealthWeights,
} from "../talent";
import { SignalBar } from "./bars";
import { RADAR_SCORE, PersonChip } from "./lists";

// Recruiter-facing summary panels: the profile card ("who are they"), the
// talent-signal panel with re-weightable health score, the side-by-side
// comparison, the last-12-months push trend, plus the network-change diff
// cells and mutual / worth-following relation panels.

// GitHub homepage / profile card — everything the `/users/{login}` endpoint
// exposes: avatar, name, bio, open-to-work, location/company, social links,
// snapshot meta. Rendered first so a recruiter sees the "who are they" before
// the numbers.
function ProfileCard({ ov }: { ov: Overview }) {
  const tr = useT();
  const p = ov.profile;
  const year = p?.created_at ? new Date(p.created_at).getFullYear() : null;
  const social: { label: string; href: string; icon: string }[] = [];
  if (p?.html_url) social.push({ label: "GitHub", href: p.html_url, icon: "🐙" });
  if (p?.blog) social.push({ label: tr("pc.website"), href: /^https?:/.test(p.blog) ? p.blog : "https://" + p.blog, icon: "🔗" });
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
          <p className="pc-bio">{p?.bio || tr("pc.no_bio")}</p>
          <div className="pc-badges">
            {p?.hireable ? <OpenToWork p={p} tr={tr} /> : null}
            {p?.location ? <span className="chip">📍 {p.location}</span> : null}
            {p?.company ? <span className="chip">🏢 {p.company}</span> : null}
            {year ? <span className="chip">{tr("pc.since", { year })}</span> : null}
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
          <span><b>{p?.followers ?? 0}</b> {tr("pc.followers")}</span>
          <span><b>{p?.following ?? 0}</b> {tr("pc.following")}</span>
          <span><b>{p?.public_repos ?? ov.count}</b> {tr("pc.repos")}</span>
          <span><b>{p?.public_gists ?? 0}</b> {tr("pc.gists")}</span>
        </div>
      </div>

      <p className="pc-snapshot muted">{tr("pc.snapshot", { fetched: ov.fetched_at, count: ov.count, non_fork: ov.non_fork_count })}</p>
    </section>
  );
}

// "Open to work" chip cross-checked against repo activity. The GitHub
// hireable flag is self-reported and often stale (left on after landing a
// job); a recent push (<= 90d) means the person is likely genuinely
// job-hunting, while a stale one flags the switch as possibly outdated.
// Falls back to the plain chip when no repo activity is known (cached path).
//
// Founder exception: for accounts whose bio/company carries founder/CEO/CTO
// signals, hireable almost never means "looking for a job" — founders keep
// the flag on to recruit, find co-founders or take consulting. Label those
// "open to collaborate / hiring" instead of "job hunting".
const FOUNDER_RE = /(founder|co-?founder|\bceo\b|\bcto\b|\bcreator\b|\bowner\b)/i;

function OpenToWork({ p, tr }: { p: Overview["profile"]; tr: (k: string, p?: Record<string, string | number>) => string }) {
  const founder = FOUNDER_RE.test(`${p?.bio ?? ""} ${p?.company ?? ""}`);
  if (founder) {
    return <span className="chip o2w o2w-founder" title={tr("pc.o2w_founder_title")}>{tr("pc.o2w_founder")}</span>;
  }
  const last = p?.last_push;
  const days = last ? Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 86400000)) : -1;
  if (days >= 0 && days <= 90) {
    return <span className="chip o2w o2w-active" title={tr("pc.o2w_active_title")}>{tr("pc.o2w_active")}</span>;
  }
  if (days > 90) {
    return <span className="chip o2w o2w-stale" title={tr("pc.o2w_stale_title")}>{tr("pc.o2w_stale")}</span>;
  }
  return <span className="chip o2w" title={tr("pc.o2w_title")}>{tr("pc.open_to_work")}</span>;
}

// Recruiter-facing summary: tenure, output, rigor, focus, influence.
// Slider-based re-weighting of the health score. An HR team can tune what
// matters most to them; the change persists per browser (localStorage) and
// re-scores the panel, the compare view, and the candidate pool live.
function WeightTuner({ weights, onChange }: {
  weights: HealthWeights;
  onChange: (w: HealthWeights) => void;
}) {
  const tr = useT();
  const rows: { key: keyof HealthWeights; label: string }[] = [
    { key: "activity", label: tr("tal.activity") },
    { key: "rigor", label: tr("tal.rigor") },
    { key: "focus", label: tr("tal.focus") },
    { key: "influence", label: tr("tal.influence") },
  ];
  return (
    <div className="weight-tuner">
      <div className="weight-tuner-head">
        <span className="muted">{tr("tal.reweight")}</span>
        <button
          className="chip"
          onClick={() => onChange({ ...DEFAULT_HEALTH_WEIGHTS })}
          title={tr("tal.reset_title")}
        >
          {tr("tal.reset")}
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
  const tr = useT();
  const { lang } = useLang();
  const focusBits = [
    t.top_lang,
    t.secondary_langs.length ? t.secondary_langs.join(" / ") : null,
  ].filter(Boolean) as string[];
  const { total, pillars } = healthScore(t, weights);
  const [copied, setCopied] = React.useState(false);
  function copyNote() {
    const text = toHrNote(ov, t, weights, lang);
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false)
    );
  }
  function dlNote() {
    downloadHrNote(ov, t, weights, lang);
  }
  return (
    <section className="panel talent">
      <div className="talent-head">
        <div>
          <h2>{tr("tal.signals")}</h2>
          <p className="muted talent-lead">
            {tr("tal.lead", { count: ov.count })}
          </p>
        </div>
        <div
          className="talent-score"
          title={tr("tal.weights_title", {
            a: Math.round(weights.activity * 100),
            r: Math.round(weights.rigor * 100),
            f: Math.round(weights.focus * 100),
            i: Math.round(weights.influence * 100),
          })}
        >
          <div className="score-num">{total}</div>
          <div className="score-cap">{tr("tal.health")}</div>
        </div>
        <button className="btn" onClick={copyNote} title={tr("tal.copy_title")}>
          {copied ? tr("tal.copied") : tr("tal.copy")}
        </button>
        <button className="btn" onClick={dlNote} title={tr("tal.dl_title")}>
          {tr("tal.download")}
        </button>
      </div>
      <div className="talent-pillars">
        <span>{tr("tal.activity")} <b>{Math.round(pillars.activity * 100)}</b></span>
        <span>{tr("tal.rigor")} <b>{Math.round(pillars.rigor * 100)}</b></span>
        <span>{tr("tal.focus")} <b>{Math.round(pillars.focus * 100)}</b></span>
        <span>{tr("tal.influence")} <b>{Math.round(pillars.influence * 100)}</b></span>
      </div>

      <WeightTuner weights={weights} onChange={onWeights} />

      <div className="talent-grid">
        <div className="talent-card">
          <h3>{tr("tal.tenure")}</h3>
          <div className="talent-big">
            {t.member_since_year ? tr("tal.since", { year: t.member_since_year }) : "—"}
          </div>
          <p className="muted">
            {t.tenure_years != null ? tr("tal.tenure_years", { n: t.tenure_years }) : tr("tal.tenure_unknown")}
          </p>
        </div>

        <div className="talent-card">
          <h3>{tr("tal.output")}</h3>
          <SignalBar label={tr("tal.shipping")} ratio={t.output_ratio} />
          <p className="muted">{cadence(t.avg_days_since_push, lang)} · {tr("tal.avg_push", { d: Math.round(t.avg_days_since_push) })}</p>
        </div>

        <div className="talent-card">
          <h3>{tr("tal.engineering")}</h3>
          <SignalBar label={tr("tal.docs")} ratio={t.desc_ratio} />
          <SignalBar label={tr("tal.licenses")} ratio={t.license_ratio} />
          <SignalBar label={tr("tal.topics")} ratio={t.topics_ratio} />
        </div>

        <div className="talent-card">
          <h3>{tr("tal.focus_title")}</h3>
          <p><b>{t.top_lang}</b> {pct(t.top_lang_ratio)} · {focusBits.join(" · ")}</p>
          <p className="muted">
            {tr("tal.followers", { n: t.followers })}
            {t.top_star_repo ? tr("tal.top_repo", { name: t.top_star_repo.name, stars: t.top_star_repo.stars }) : null}
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
  const tr = useT();
  const { lang } = useLang();
  const ta = deriveTalent(ovA, lang);
  const tb = deriveTalent(ovB, lang);
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
        {tr("cmp.title", { a: "@" + ovA.owner, b: "@" + ovB.owner })}
      </h2>
      <div className="cmp-grid">
        <div className="cmp-head" />
        <div className="cmp-head">{ovA.owner}</div>
        <div className="cmp-head">{ovB.owner}</div>

        {row(tr("cmp.health"), <b>{sa}</b>, <b>{sb}</b>, true, sa, sb)}
        {row(tr("cmp.repos"), ovA.count, ovB.count, true, ovA.count, ovB.count)}
        {row(tr("cmp.original"), ovA.non_fork_count, ovB.non_fork_count, true, ovA.non_fork_count, ovB.non_fork_count)}
        {row(tr("cmp.active_90d"), ovA.recency.active || 0, ovB.recency.active || 0, true, ovA.recency.active || 0, ovB.recency.active || 0)}
        {row(tr("cmp.shipping"), pct(ta.output_ratio), pct(tb.output_ratio), true, ta.output_ratio, tb.output_ratio)}
        {row(
          tr("cmp.rigor"),
          Math.round(((ta.desc_ratio + ta.license_ratio + ta.topics_ratio) / 3) * 100) + "%",
          Math.round(((tb.desc_ratio + tb.license_ratio + tb.topics_ratio) / 3) * 100) + "%",
          true,
          ta.desc_ratio + ta.license_ratio + ta.topics_ratio,
          tb.desc_ratio + tb.license_ratio + tb.topics_ratio
        )}
        {row(tr("cmp.top_lang"), ta.top_lang + " " + pct(ta.top_lang_ratio), tb.top_lang + " " + pct(tb.top_lang_ratio))}
        {row(tr("cmp.since"), ta.member_since_year || "—", tb.member_since_year || "—")}
        {row(tr("cmp.followers"), ta.followers, tb.followers, true, ta.followers, tb.followers)}
        {row(tr("cmp.stars"), ovA.totals.stars, ovB.totals.stars, true, ovA.totals.stars, ovB.totals.stars)}
      </div>
      <p className="muted cmp-note">{tr("cmp.note")}</p>
    </section>
  );
}

// Last-12-months push-activity trend (the recruiter "still shipping?" signal).
// Ordered newest → oldest; everything before the 12-month window is folded
// into a single "older" row. Uses the same .bar-* styling as `Bars`.
function PushTrend({ data }: { data: Record<string, number> }) {
  const tr = useT();
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
  const olderLabel = tr("bars.older");
  const max = Math.max(1, ...rows.map((r) => r.v));
  const activeMonths = rows.filter((r) => r.v > 0 && r.k !== "older").length;
  return (
    <div className="panel">
      <h2>{tr("bars.push_activity")}</h2>
      <div className="bars">
        {rows.map((r) => (
          <div className="bar-row" key={r.k}>
            <span className="bar-label" title={r.k}>{r.k === "older" ? olderLabel : r.k}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(r.v / max) * 100}%`, background: "#38bdf8" }} />
            </div>
            <span className="bar-val">{r.v}</span>
          </div>
        ))}
      </div>
      <p className="muted push-note">
        {tr("bars.months_note", { n: activeMonths, cur: data[cur] || 0 })}
      </p>
    </div>
  );
}

// one diff cell: "新关注我: @a, @b, @c +2 更多" (items are GitHub logins)
function DiffLine({ label, items, t }: { label: string; items: string[]; t: (k: string, p?: Record<string, string | number>) => string }) {
  if (!items || items.length === 0) {
    return (
      <div className="diff-cell">
        <span className="diff-label">{label}</span>
        <span className="muted">—</span>
      </div>
    );
  }
  const shown = items.slice(0, 5).map((s) => "@" + s).join("  ");
  const more = items.length > 5 ? "  " + t("people.diff_more", { n: items.length - 5 }) : "";
  return (
    <div className="diff-cell">
      <span className="diff-label">{label}</span>
      <span className="diff-items">{shown}{more}</span>
    </div>
  );
}

// Mutual / worth-following — a chip list whose entries link OUT to the
// Mutually-followed / worth-following lists. Clicking a chip analyzes the
// person in-app (same behaviour as the follower lists); the small ↗ link
// opens their GitHub profile.
function RelationPanel({ title, people, emptyNote, t, onOpen, action }: {
  title: string; people: PersonView[]; emptyNote: string;
  t: (k: string, p?: Record<string, string | number>) => string;
  onOpen?: (login: string) => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel" style={{ gridColumn: "1 / -1" }}>
      <h2>
        {title} <span className="muted">{people.length}</span>
        {action}
      </h2>
      {people.length === 0 ? (
        <p className="muted">{emptyNote}</p>
      ) : (
        <div className="person-list">
          {people.map((p, i) => (
            <PersonChip key={i} p={p} t={t} onOpen={onOpen} href={p.url} />
          ))}
        </div>
      )}
    </div>
  );
}

export { ProfileCard, TalentPanel, WeightTuner, ComparePanel, PushTrend, DiffLine, RelationPanel };
