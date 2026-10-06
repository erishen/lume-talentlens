import React from "react";
import { api } from "./api";
import type { Overview, RepoView, NoSnapshot, PersonView, People } from "./types";
import { isNoSnapshot } from "./types";
import { fetchLive, fetchLivePeople, searchLocal, type LiveResult, type LiveProgress } from "./live";
import { deriveTalent, cadence, pct, healthScore, toHrNote, downloadHrNote, loadHealthWeights, saveHealthWeights, DEFAULT_HEALTH_WEIGHTS, type HealthWeights } from "./talent";
import type { TalentSignals } from "./types";

const RECCOLOR: Record<string, string> = {
  active: "#22c55e",
  recent: "#38bdf8",
  dormant: "#f59e0b",
  stale: "#64748b",
  unknown: "#475569",
};

function Kpi({ n, label }: { n: string; label: string }) {
  return (
    <div className="kpi">
      <div className="kpi-num">{n}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

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

// Followers / Following — a list of GitHub logins. Clicking one analyzes that
// person *in-app* (onOpen), it does NOT link out to their GitHub profile.
function PersonList({ title, people, totals, note, onOpen }: {
  title: string; people: PersonView[]; totals: number; note?: string;
  onOpen: (login: string) => void;
}) {
  return (
    <div className="panel">
      <h2>
        {title} <span className="muted">· {people.length} shown / {totals} total</span>
      </h2>
      {people.length === 0 && <p className="muted">{note || "no data"}</p>}
      {people.length > 0 && (
        <div className="person-list">
          {people.map((p, i) => (
            <button
              key={i}
              className="person-chip"
              onClick={() => onOpen(p.login)}
              title={"Analyze @" + p.login + " (in-app)"}
            >
              @{p.login}
              {p.type === "Bot" ? <span className="chip bot">bot</span> : null}
            </button>
          ))}
        </div>
      )}
      {people.length > 0 && totals > people.length && (
        <p className="muted">…and {totals - people.length} more (first page shown). Click a name to analyze that person.</p>
      )}
    </div>
  );
}

function RepoRow({ r, rank }: { r: RepoView; rank: number }) {
  const rc = RECCOLOR[r.recency] || RECCOLOR.unknown;
  return (
    <li className="repo-row">
      <span className="rank">{rank}</span>
      <a className="repo-name" href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
      <span className="chip">{r.lang || "—"}</span>
      <span className="chip">★ {r.stars}</span>
      <span className="chip">⑂ {r.forks}</span>
      <span className="chip" style={{ color: rc, borderColor: rc }}>{r.recency}</span>
      {r.is_fork && <span className="chip fork">fork</span>}
      {r.archived && <span className="chip archived">archived</span>}
    </li>
  );
}

// ---------------- owner picker (input + cached-owner datalist) ----------------
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

export function Dashboard() {
  const [owner, setOwner] = React.useState("");
  const [cached, setCached] = React.useState<string[]>([]);
  // request-sequence guards: the latest load wins, older in-flight responses
  // are dropped instead of clobbering the view when the user switches owners
  // quickly (or compares several candidates in a row).
  const reqSeq = React.useRef(0);
  const cmpSeq = React.useRef(0);
  const poolSeq = React.useRef(0);
  // recruiting-scoring weights — an HR-team preference, persisted per browser
  const [weights, setWeights] = React.useState<HealthWeights>(() => loadHealthWeights());
  React.useEffect(() => {
    saveHealthWeights(weights);
  }, [weights]);
  const [ov, setOv] = React.useState<Overview | null>(null);
  const [live, setLive] = React.useState<LiveResult | null>(null);
  const [noSnap, setNoSnap] = React.useState<NoSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [liveLoading, setLiveLoading] = React.useState(false);
  const [liveErr, setLiveErr] = React.useState("");
  const [liveProgress, setLiveProgress] = React.useState<LiveProgress | null>(null);
  const [err, setErr] = React.useState("");
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<RepoView[]>([]);
  const [hitsTotal, setHitsTotal] = React.useState(0);
  const [searched, setSearched] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [limit, setLimit] = React.useState(20);
  const [people, setPeople] = React.useState<People | null>(null);
  const [peopleLoading, setPeopleLoading] = React.useState(false);
  const [peopleError, setPeopleError] = React.useState("");

  // side-by-side compare with a second candidate (B)
  const [cmp, setCmp] = React.useState<{ target: string; ov: Overview | null; loading: boolean; err: string }>({
    target: "",
    ov: null,
    loading: false,
    err: "",
  });

  // N-person candidate pool: enter several owners, rank them by health score
  const [poolInput, setPoolInput] = React.useState("");
  const [poolLoading, setPoolLoading] = React.useState(false);
  const [poolProgress, setPoolProgress] = React.useState<{
    done: number; total: number;
    curOwner?: string; curPage?: number; curTotal?: number;
  } | null>(null);
  const [pool, setPool] = React.useState<{ target: string; ov: Overview | null; score: number; err: string }[]>([]);

  // Load the follower / following lists for the current owner. Cached owners
  // hit the server's /api/people; live owners (or when the running server
  // predates that route) fetch in the browser instead.
  function loadPeople(o: string, viaLive: boolean) {
    setPeople(null);
    setPeopleError("");
    setPeopleLoading(true);
    const target = o.trim();
    if (!target) return;
    if (viaLive) {
      loadLivePeople(target);
      return;
    }
    api.people(target).then((r) => {
      if (isNoSnapshot(r)) {
        loadLivePeople(target);
        return;
      }
      setPeople(r as People);
      setPeopleLoading(false);
    }).catch(() => {
      // /api/people unavailable (older server) → live fallback
      loadLivePeople(target);
    });
  }

  // browser-side people fetch (live owners + fallback when server lacks route).
  // GitHub may be rate-limited / unreachable (e.g. from mainland China); in
  // that case we surface an explicit error state instead of silent emptiness.
  function loadLivePeople(o: string) {
    const target = o.trim();
    if (!target) return;
    fetchLivePeople(target).then((p) => {
      if (p.followers.length === 0 && p.following.length === 0) {
        setPeople(p);
        setPeopleError("Could not reach GitHub for this owner (network or rate limit). " +
          "For a cached owner, restart the server so /api/people is available, then click Retry.");
      } else {
        setPeople(p);
        setPeopleError("");
      }
      setPeopleLoading(false);
    }).catch(() => {
      setPeople(null);
      setPeopleError("Failed to load followers/following.");
      setPeopleLoading(false);
    });
  }
  // resolve an owner: prefer its local snapshot; if absent, fetch live in the
  // browser (so ANY typed owner works without a pre-baked snapshot).
  function loadOverview(o: string) {
    const target = o.trim();
    if (!target) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setErr("");
    setNoSnap(null);
    setOv(null);
    setLive(null);
    setLiveErr("");
    api.overview(target).then((r) => {
      if (seq !== reqSeq.current) return; // superseded by a newer load
      if (isNoSnapshot(r)) {
        // no local snapshot — fall back to a live browser fetch
        setNoSnap(r as NoSnapshot);
        setLoading(false);
        return;
      }
      setOv(r as Overview);
      loadPeople(target, false);
      setLoading(false);
    }).catch((e) => {
      if (seq !== reqSeq.current) return;
      setErr(e.message);
      setLoading(false);
    });
  }

  async function loadLive(o: string) {
    const target = o.trim();
    if (!target) return;
    const seq = ++reqSeq.current;
    setLiveLoading(true);
    setLiveErr("");
    setNoSnap(null);
    setLiveProgress(null);
    try {
      const res = await fetchLive(target, undefined, (p) => {
        if (seq === reqSeq.current) setLiveProgress(p);
      });
      if (seq !== reqSeq.current) return;
      setOv(res.overview);
      setLive(res);
      setLiveProgress(null);
      loadPeople(target, true);
      setLoading(false);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setLiveErr(e instanceof Error ? e.message : String(e));
      setOv(null);
      setLive(null);
      setLoading(false);
    } finally {
      if (seq === reqSeq.current) setLiveLoading(false);
    }
  }

  // Load a second candidate for side-by-side comparison. Mirrors the primary
  // path: local snapshot first, live browser fetch when uncached.
  async function loadCompare(o: string) {
    const target = o.trim();
    if (!target) return;
    const seq = ++cmpSeq.current;
    setCmp({ target, ov: null, loading: true, err: "" });
    const r = await api.overview(target);
    if (seq !== cmpSeq.current) return;
    if (isNoSnapshot(r)) {
      try {
        const res = await fetchLive(target);
        if (seq !== cmpSeq.current) return;
        setCmp({ target, ov: res.overview, loading: false, err: "" });
      } catch (e) {
        if (seq !== cmpSeq.current) return;
        setCmp({ target, ov: null, loading: false, err: String((e as Error)?.message || e) });
      }
      return;
    }
    setCmp({ target, ov: r as Overview, loading: false, err: "" });
  }

  // Load an N-person candidate pool: several owners, ranked by health score.
  // Owners are fetched in PARALLEL — the getGithub throttle in live.ts caps
  // concurrency (3) and paces unauthenticated requests so a big pool doesn't
  // burn the 60 req/h limit; a 429/403 trips the breaker and the rest fail
  // fast. Each owner mirrors the primary path (snapshot first, live when
  // uncached).
  async function loadPool(raw: string) {
    const names = Array.from(
      new Set(
        raw
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    if (names.length === 0) return;
    const seq = ++poolSeq.current;
    setPoolLoading(true);
    setPool([]);
    setPoolProgress({ done: 0, total: names.length });

    const rows: { target: string; ov: Overview | null; score: number; err: string }[] = names.map((n) => ({
      target: n,
      ov: null,
      score: 0,
      err: "",
    }));
    let done = 0;

    await Promise.all(
      rows.map(async (row) => {
        let ov: Overview | null = null;
        let errMsg = "";
        try {
          const r = await api.overview(row.target);
          if (isNoSnapshot(r)) {
            const res = await fetchLive(row.target, undefined, (p) => {
              if (seq === poolSeq.current) {
                // merge the current owner's repo-page progress into the bar:
                // show "fetching @x (repos page 2/3)" while paging through
                setPoolProgress({ done, total: names.length, curOwner: row.target, curPage: p.page, curTotal: p.total });
              }
            });
            ov = res.overview;
          } else {
            ov = r as Overview;
          }
        } catch (e) {
          errMsg = String((e as Error)?.message || e);
        }
        row.ov = ov;
        row.err = errMsg;
        row.score = ov ? healthScore(deriveTalent(ov)).total : 0;
        done += 1;
        if (seq === poolSeq.current) {
          setPoolProgress({ done, total: names.length });
        }
      })
    );

    if (seq !== poolSeq.current) return; // superseded by a newer pool run
    // rank by health score, failures last
    rows.sort((a, b) => b.score - a.score);
    setPool(rows);
    setPoolProgress(null);
    setPoolLoading(false);
  }

  React.useEffect(() => {
    // cached owners + default (last fetched) owner
    api.owners().then((r) => {
      setCached(r.owners);
      if (owner === "") setOwner(r.current); // adopt the server default
      loadOverview(r.current);
    }).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onOwnerPick(o: string) {
    setOwner(o);
    setQ(""); setHits([]); setSearched(false);
    setPeople(null);
  }

  // Clicking a follower/following name analyzes that person in-app:
  // cached owners read the local snapshot, everyone else is fetched live.
  function openOwner(login: string) {
    onOwnerPick(login);
    if (cached.includes(login)) {
      loadOverview(login);
    } else {
      loadLive(login);
    }
  }

  // search: live results are searched client-side; cached owners hit the server
  function onSearch() {
    if (!owner) return;
    if (live) {
      const res = searchLocal(live.all, q);
      setHits(res);
      setHitsTotal(res.length);
      setSearched(true);
      return;
    }
    setSearching(true);
    api.search(q, owner).then((r) => {
      if (isNoSnapshot(r)) {
        setNoSnap(r as NoSnapshot);
      } else {
        setHits(r.shown);
        setHitsTotal(r.total);
      }
      setSearched(true);
      setSearching(false);
    }).catch(() => setSearching(false));
  }

  // Re-score + re-rank the pool with the CURRENT weights so dragging the
  // WeightTuner sliders re-orders candidates live.
  const rankedPool = pool
    .map((p) => ({
      ...p,
      score: p.ov ? healthScore(deriveTalent(p.ov), weights).total : 0,
    }))
    .sort((a, b) => b.score - a.score);

  // pool progress fraction: finished owners + the current owner's page
  // progress (falls back to owner-count only when the page total is unknown)
  const poolFrac = poolProgress
    ? poolProgress.curTotal
      ? Math.min(1, (poolProgress.done + Math.min(poolProgress.curPage ?? 0, poolProgress.curTotal) / poolProgress.curTotal) / poolProgress.total)
      : poolProgress.done / Math.max(1, poolProgress.total)
    : 0;

  return (
    <div>
      <section className="hero">
        <h1>Recruiting lens over a GitHub footprint</h1>
        <p>Pick an owner to read their talent signals — profile, engineering rigor, output, focus (local snapshots, offline).</p>
      </section>

      <OwnerPicker value={owner} cached={cached} onPick={onOwnerPick} onAnalyze={loadOverview} busy={loading} />

      <div className="pool-row">
        <span className="muted">rank</span>
        <input
          className="search-input"
          placeholder="candidate pool — several owners, comma/space separated (e.g. erishen, acme, bob)"
          value={poolInput}
          onChange={(e) => setPoolInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !poolLoading && loadPool(poolInput)}
        />
        <button className="btn" onClick={() => loadPool(poolInput)} disabled={poolLoading}>
          {poolLoading ? "…" : "Rank"}
        </button>
        {pool.length > 0 && (
          <button className="chip" onClick={() => { setPool([]); setPoolInput(""); }}>
            ✕ clear
          </button>
        )}
      </div>

      {poolLoading && poolProgress && (
        <div className="panel pool-progress">
          <h2>Candidate ranking · loading</h2>
          <div className="pool-prog-bar">
            <div className="pool-prog-fill" style={{ width: `${poolFrac * 100}%` }} />
          </div>
          <p className="muted">
            {poolProgress.done} / {poolProgress.total} loaded
            {poolProgress.curOwner ? (
              <>
                {" "}· fetching <code>@{poolProgress.curOwner}</code>
                {poolProgress.curTotal ? (
                  <> (repos page {Math.min(poolProgress.curPage ?? 0, poolProgress.curTotal)}/{poolProgress.curTotal})</>
                ) : null}
              </>
            ) : null}
            {" "}(live pulls are throttled to stay under the 60 req/h limit)
          </p>
        </div>
      )}

      {pool.length > 0 && !poolLoading && (
        <section className="panel pool">
          <h2>Candidate ranking · by open-source health</h2>
          <div className="pool-table">
            {rankedPool.map((p, i) => (
              <div className="pool-row-item" key={p.target}>
                <span className="pool-rank">#{i + 1}</span>
                <button
                  className="pool-name"
                  onClick={() => openOwner(p.target)}
                  title={"Analyze @" + p.target + " (in-app)"}
                >
                  @{p.target}
                </button>
                <span className="pool-score">
                  {p.ov ? <b>{p.score}</b> : <span className="muted">—</span>}
                </span>
                <span className="pool-detail">
                  {p.err ? (
                    <span className="muted err">{p.err}</span>
                  ) : p.ov ? (
                    <span>
                      {p.ov.count} repos · top <code>{Object.keys(p.ov.languages || {})[0] || "—"}</code>{" "}
                      · {p.ov.recency.active || 0} active ≤90d
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <p className="muted pool-note">
            Click a name to open the full analysis · sorted by the current health weights
            ({Math.round(weights.activity * 100)}/{Math.round(weights.rigor * 100)}/
            {Math.round(weights.focus * 100)}/{Math.round(weights.influence * 100)}) — adjust them in Talent
            signals and the ranking updates live.
          </p>
        </section>
      )}

      <div className="compare-row">
        <span className="muted">vs</span>
        <input
          className="search-input"
          placeholder="compare with another GitHub owner (e.g. torvalds)"
          value={cmp.target}
          onChange={(e) => setCmp((c) => ({ ...c, target: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && loadCompare(cmp.target)}
        />
        <button className="btn" onClick={() => loadCompare(cmp.target)} disabled={cmp.loading}>
          {cmp.loading ? "…" : "Compare"}
        </button>
        {cmp.ov && (
          <button className="chip" onClick={() => setCmp({ target: "", ov: null, loading: false, err: "" })}>
            ✕ clear
          </button>
        )}
      </div>
      {cmp.err && <div className="panel error">Compare failed: {cmp.err}</div>}
      {ov && cmp.ov && ov.owner !== cmp.target ? (
        <ComparePanel ovA={ov} ovB={cmp.ov} weights={weights} />
      ) : null}

      {err && <div className="panel error">{err}</div>}

      {loading && <div className="panel">Loading…</div>}

      {liveLoading && (
        <div className="panel">
          <h2>Fetching <code>{owner}</code> live from GitHub…</h2>
          {liveProgress && liveProgress.total > 0 ? (
            <>
              <div className="pool-prog-bar">
                <div
                  className="pool-prog-fill"
                  style={{ width: `${(Math.min(liveProgress.page, liveProgress.total) / liveProgress.total) * 100}%` }}
                />
              </div>
              <p className="muted">
                repos page {Math.min(liveProgress.page, liveProgress.total)}/{liveProgress.total} · {liveProgress.repos} repos pulled
              </p>
            </>
          ) : (
            <p className="muted">pulling repos…</p>
          )}
        </div>
      )}

      {liveErr && !liveLoading && (
        <div className="panel error">
          <h2>Live fetch failed{owner ? <code> @{owner}</code> : null}</h2>
          <p>{liveErr}</p>
          {owner && (
            <div className="no-snap-actions">
              <button className="btn" onClick={() => loadLive(owner)}>Retry</button>
              <span className="muted">offline fallback — run:</span>
              <code className="hint-cmd">{`OWNER=${owner} make fetch`}</code>
            </div>
          )}
        </div>
      )}

      {noSnap && !loading && !liveLoading && (
        <div className="panel no-snap">
          <h2>No local snapshot for <code>{noSnap.owner}</code></h2>
          <p>Two ways to analyze <code>{noSnap.owner}</code>:</p>
          <div className="no-snap-actions">
            <button className="btn" onClick={() => loadLive(noSnap.owner)}>Fetch live from GitHub</button>
            <span className="muted">or, offline / rate-limit-proof:</span>
            <code className="hint-cmd">{`OWNER=${noSnap.owner} make fetch`}</code>
          </div>
          <p className="muted">
            Live fetch goes through the server's /api/live/github proxy (outbound http_get);
            unauthenticated it is shared at ~60 req/h — set GH_TOKEN to raise it.
          </p>
        </div>
      )}

      {ov && !loading && !noSnap && !liveLoading && (
        <>
          <ProfileCard ov={ov} />

          <TalentPanel t={deriveTalent(ov)} ov={ov} weights={weights} onWeights={setWeights} />

          <section className="kpis">
            <Kpi n={String(ov.count)} label="repos" />
            <Kpi n={String(ov.non_fork_count)} label="original" />
            <Kpi n={String(ov.totals.stars)} label="stars total" />
            <Kpi n={String(ov.totals.forks)} label="forks total" />
            <Kpi n={String(ov.recency.active || 0)} label="active ≤90d" />
          </section>

          <section className="grid">
            <Bars title="Languages" data={ov.languages} />
            <Bars title="Recency" data={ov.recency} color="#22c55e" />
            <Bars title="Created per year" data={ov.years} color="#f59e0b" />
          </section>

          {ov.push_trend && (
            <section className="grid">
              <PushTrend data={ov.push_trend} />
            </section>
          )}

          <div className="grid two">
            {peopleLoading && (
              <div className="panel">
                <h2>Followers &amp; Following</h2>
                <p className="muted">Loading…</p>
              </div>
            )}
            {!peopleLoading && peopleError && (
              <div className="panel error" style={{ gridColumn: "1 / -1" }}>
                <h2>Followers &amp; Following</h2>
                <p>{peopleError}</p>
                <button className="btn" onClick={() => loadPeople(owner, !!live)}>Retry</button>
              </div>
            )}
            {!peopleLoading && !peopleError && people && (
              <>
                <PersonList
                  title="Followers"
                  people={people.followers}
                  totals={people.totals.followers}
                  note={people.note}
                  onOpen={openOwner}
                />
                <PersonList
                  title="Following"
                  people={people.following}
                  totals={people.totals.following}
                  note={people.note}
                  onOpen={openOwner}
                />
              </>
            )}
          </div>

          <section className="panel">
            <h2>Top 10 by stars</h2>
            <ol className="top-list">
              {ov.top_by_stars.map((r, i) => (
                <RepoRow key={r.name} r={r} rank={i + 1} />
              ))}
            </ol>
          </section>

          <section className="panel">
            <h2>Search {owner ? <span className="muted">in {owner}</span> : null}</h2>
            <div className="search-row">
              <input
                className="search-input"
                value={q}
                placeholder="filter by name / description / language / topic…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
              />
              <button className="btn" onClick={onSearch} disabled={searching || !owner}>
                {searching ? "…" : "Search"}
              </button>
            </div>
            {searched && (
              <ol className="top-list">
                {hits.map((r, i) => (
                  <RepoRow key={r.name} r={r} rank={i + 1} />
                ))}
                {hits.length === 0 && <li className="muted">no matches for “{q}”</li>}
                {hits.length > 0 && <li className="muted">{hitsTotal} match{hitsTotal === 1 ? "" : "es"}</li>}
              </ol>
            )}
          </section>

          <section className="panel">
            <h2>All repos</h2>
            <BrowsePage limit={limit} setLimit={setLimit} owner={owner}
              liveAll={live ? live.all : null} />
          </section>
        </>
      )}
    </div>
  );
}

// paged browser over /api/repos?owner= — OR, when liveAll is provided,
// paginate the in-memory live-fetched array client-side (no server call).
function BrowsePage({ limit, setLimit, owner, liveAll }: {
  limit: number; setLimit: (n: number) => void; owner: string; liveAll: RepoView[] | null;
}) {
  const [offset, setOffset] = React.useState(0);
  const [page, setPage] = React.useState<RepoView[]>([]);
  const [total, setTotal] = React.useState(0);

  React.useEffect(() => {
    setOffset(0);
  }, [owner, liveAll]);

  React.useEffect(() => {
    if (liveAll) {
      // live mode: slice the in-memory array
      setTotal(liveAll.length);
      setPage(liveAll.slice(offset, offset + limit));
      return;
    }
    // cached mode: page through the server
    api.repos(offset, limit, owner).then((r) => {
      if (!isNoSnapshot(r)) {
        setTotal(r.total);
        setPage(r.repos);
      }
    });
  }, [offset, limit, owner, liveAll]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const cur = Math.floor(offset / limit) + 1;

  return (
    <div>
      <div className="pager">
        <button className="chip" onClick={() => setLimit(10)} disabled={limit === 10}>10</button>
        <button className="chip" onClick={() => setLimit(25)} disabled={limit === 25}>25</button>
        <button className="chip" onClick={() => setLimit(50)} disabled={limit === 50}>50</button>
        <span className="muted">{cur}/{pages} · {total} repos</span>
      </div>
      <ol className="top-list all">
        {page.map((r, i) => (
          <RepoRow key={r.name} r={r} rank={offset + i + 1} />
        ))}
      </ol>
      <div className="pager">
        <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>← prev</button>
        <button className="btn" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>next →</button>
      </div>
    </div>
  );
}
