import React from "react";
import { useT } from "../i18n";

// Owner picker: free-text input + datalist of locally-cached owners + the
// active owner's quick chips. Enter or the button analyzes the input owner.

function OwnerPicker({
  value, cached, onPick, onAnalyze, busy,
}: {
  value: string;
  cached: string[];
  onPick: (o: string) => void;
  onAnalyze: (o: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const [input, setInput] = React.useState(value);
  React.useEffect(() => setInput(value), [value]);
  return (
    <div className="owner-row">
      <label className="owner-label" htmlFor="gh-owner">{t("owner.label")}</label>
      <input
        id="gh-owner"
        className="search-input owner-input"
        list="gh-cached-owners"
        value={input}
        placeholder={t("owner.placeholder")}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) { onPick(input.trim()); onAnalyze(input.trim()); }
        }}
      />
      <datalist id="gh-cached-owners">
        {cached.map((o) => <option key={o} value={o} />)}
      </datalist>
      <button className="btn" disabled={busy || input.trim() === ""}
        onClick={() => { onPick(input.trim()); onAnalyze(input.trim()); }}>
        {busy ? "…" : t("owner.analyze")}
      </button>
      {cached.length > 0 && (
        <span className="cached-row">
          {t("owner.cached")}:
          {cached.map((o) => (
            <button key={o} className={"chip owner-chip" + (o === value ? " active" : "")}
              onClick={() => { onPick(o); onAnalyze(o); }}>
              {o}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

export { OwnerPicker };
