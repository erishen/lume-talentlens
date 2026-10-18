import React from "react";
import type { PersonView } from "../types";
import { useT } from "../i18n";
import { PersonChip } from "./people-list";
import { SignalBar } from "./bars";

// People-panels: PushTrend, DiffLine, RelationPanel (all small UI panels used
// in the people tab). Split out of panels.tsx (which now just re-exports).

// Last-12-months push-activity trend (the recruiter "still shipping?" signal).
// Ordered newest → oldest; everything before the 12-month window is folded
// into a single "older" row. Uses the same .bar-* styling as `Bars`.
export function PushTrend({ data }: { data: Record<string, number> }) {
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
export function DiffLine({ label, items, t }: { label: string; items: string[]; t: (k: string, p?: Record<string, string | number>) => string }) {
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
export function RelationPanel({ title, people, emptyNote, t, onOpen, action }: {
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
          {people.map((p) => (
            <PersonChip key={p.login} p={p} t={t} onOpen={onOpen} href={p.url} />
          ))}
        </div>
      )}
    </div>
  );
}
