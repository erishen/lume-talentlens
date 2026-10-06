import React from "react";
import { pct } from "../talent";

// Small visual primitives shared across the dashboard panels: a number KPI,
// a labeled progress bar, and a generic vertical bar chart.

function Kpi({ n, label }: { n: string; label: string }) {
  return (
    <div className="kpi">
      <div className="kpi-num">{n}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function SignalBar({ label, ratio, detail }: { label: string; ratio: number; detail?: string }) {
  const p = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="signal">
      <div className="signal-head">
        <span className="signal-label">{label}</span>
        <span className="signal-val">{pct(ratio)}</span>
      </div>
      <div className="signal-track">
        <div className="signal-fill" style={{ width: p + "%" }} />
      </div>
      {detail ? <div className="signal-detail muted">{detail}</div> : null}
    </div>
  );
}

function Bars({ title, data, color }: { title: string; data: Record<string, number>; color?: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="bars">
        {entries.map(([k, v]) => (
          <div className="bar-row" key={k}>
            <span className="bar-label" title={k}>{k}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(v / max) * 100}%`, background: color || "var(--color-accent)" }}
              />
            </div>
            <span className="bar-val">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { Kpi, SignalBar, Bars };
