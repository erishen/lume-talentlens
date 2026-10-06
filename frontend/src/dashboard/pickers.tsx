import React from "react";

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
  const [input, setInput] = React.useState(value);
  React.useEffect(() => setInput(value), [value]);
  return (
    <div className="owner-row">
      <label className="owner-label" htmlFor="gh-owner">GitHub owner</label>
      <input
        id="gh-owner"
        className="search-input owner-input"
        list="gh-cached-owners"
        value={input}
        placeholder="enter a GitHub username"
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
        {busy ? "…" : "Analyze"}
      </button>
      {cached.length > 0 && (
        <span className="cached-row">
          cached:
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
