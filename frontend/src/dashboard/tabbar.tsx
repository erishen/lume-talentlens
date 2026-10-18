import React from "react";

// Accessible tab bar (WAI-ARIA tabs pattern): role=tablist with roving
// tabindex, aria-selected / aria-controls, and Left/Right/Home/End keyboard
// navigation. Screen readers and keyboard users switch tabs the same way
// mouse users do. Panels render elsewhere with role="tabpanel" +
// aria-labelledby="<idPrefix>-tab-<key>".

export interface TabDef<K extends string> {
  key: K;
  label: string;
}

export function TabBar<K extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
  idPrefix,
}: {
  tabs: TabDef<K>[];
  active: K;
  onSelect: (k: K) => void;
  ariaLabel: string;
  idPrefix: string;
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const idx = tabs.findIndex((t) => t.key === active);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    e.preventDefault();
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${tabs[next].key}`);
    el?.focus();
    onSelect(tabs[next].key);
  }

  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.key}
          id={`${idPrefix}-tab-${t.key}`}
          role="tab"
          aria-selected={active === t.key}
          aria-controls={`${idPrefix}-panel-${t.key}`}
          tabIndex={active === t.key ? 0 : -1}
          className={active === t.key ? "tab active" : "tab"}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}