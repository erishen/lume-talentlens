import React from "react";
import type { Overview, TalentSignals } from "../types";
import { useLang, useT } from "../i18n";
import {
  deriveTalent, cadence, pct, healthScore, toHrNote, downloadHrNote,
  DEFAULT_HEALTH_WEIGHTS, type HealthWeights,
} from "../talent";
import { SignalBar } from "./bars";

// Recruiter-facing talent summary and weight tuner.

export function WeightTuner({ weights, onChange }: {
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

export function TalentPanel({ t, ov, weights, onWeights }: {
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
