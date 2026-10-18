import React from "react";

// Tiny dependency-free SVG sparkline (the dashboard ships no chart library —
// all charts are hand-written, see panels.tsx PushTrend / bars.tsx). Renders
// nothing meaningful for <2 points (a single point has no line); callers hide
// it in that case, but we still guard here so a 0/1-length array never throws.
// Above this many points, per-point dots would clutter the tiny canvas — show
// only the latest point (the "current value" marker) instead.
const MAX_DOTS = 24;

export function Sparkline({
  values,
  width = 108,
  height = 30,
  color = "#38bdf8",
  label,
  domain,
  area = true,
  strokeWidth = 2.25,
  fillOpacity = 0.22,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  // Fix the vertical scale (e.g. [0, 100] for a bounded score) instead of
  // autoscaling to the data. Autoscaling collapses a constant series onto the
  // bottom edge (min === max), which reads as an empty axis; a fixed domain
  // also keeps the line's height meaningful as the history grows.
  domain?: [number, number];
  // Fill under the line so even a flat series reads as a chart, not a bare
  // rule. Off by default for callers that only want the stroke.
  area?: boolean;
  strokeWidth?: number;
  fillOpacity?: number;
}) {
  if (!values || values.length < 2) {
    return <span className="sparkline sparkline-empty" aria-hidden="true" />;
  }
  const pad = 2;
  const lo = domain ? domain[0] : Math.min(...values);
  const hi = domain ? domain[1] : Math.max(...values);
  const span = hi - lo;
  const stepX = (width - pad * 2) / (values.length - 1);
  const base = height - pad; // baseline the area fill drops to
  const xy: Array<[number, number]> = values.map((v, i) => {
    const x = pad + i * stepX;
    // normalize into 0..1; a flat series (span 0) sits mid-height so it reads
    // as a real line instead of collapsing onto the bottom edge, and values
    // outside a fixed domain are clamped so the line never leaves the canvas
    const norm = span === 0 ? 0.5 : Math.max(0, Math.min(1, (v - lo) / span));
    const y = pad + (height - pad * 2) * (1 - norm);
    return [x, y];
  });
  const pts = xy.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  const areaPts =
    `${pad.toFixed(1)},${base.toFixed(1)} ` + pts + ` ${(width - pad).toFixed(1)},${base.toFixed(1)}`;
  // colour by direction: rising = sky, falling = amber, flat = slate
  const rising = values[values.length - 1] >= values[0];
  const stroke = values[values.length - 1] === values[0] ? "#cbd5e1" : rising ? color : "#f59e0b";
  const dots = values.length <= MAX_DOTS ? xy : [xy[xy.length - 1]];
  const dotR = Math.max(1.2, strokeWidth * 1.05);
  const latestR = dotR * 1.4;
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {area && <polygon className="sparkline-area" points={areaPts} fill={stroke} fillOpacity={fillOpacity} />}
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {dots.map(([x, y], i) => (
        <circle
          className={i === dots.length - 1 ? "sparkline-dot latest" : "sparkline-dot"}
          key={i}
          cx={x.toFixed(1)}
          cy={y.toFixed(1)}
          r={i === dots.length - 1 ? latestR : dotR}
          fill={stroke}
        />
      ))}
    </svg>
  );
}
