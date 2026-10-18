import React from "react";
import type { Overview } from "../types";
import { useLang, useT } from "../i18n";
import { deriveTalent, healthScore, type HealthWeights } from "../talent";

// Side-by-side comparison of the current owner (A) against a second candidate
// (B). Both go through the same deriveTalent / healthScore pipeline so the
// numbers are directly comparable.
export function ComparePanel({ ovA, ovB, weights }: {
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

// helper needed inside ComparePanel
function pct(v: number) {
  return Math.round(v * 100) + "%";
}
