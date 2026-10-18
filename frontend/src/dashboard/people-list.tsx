import React from "react";
import { useT } from "../i18n";
import type { PersonView } from "../types";

// Followers / Following lists and the shared person chip. Split out of
// lists.tsx (which now just re-exports) so the person-list UI lives on its own.

// people-score threshold for radar candidacy (2026-10 rework: quality-weighted,
// cap 93; radar re-scores with stars/activity). A high score gets a "radar"
// badge (the positive counterpart to the water-account flags) and suppresses
// the water-account badge for the same person — a genuinely productive account
// flagged as a suspect is a false positive on the pre-screen, so radar wins.
export const RADAR_SCORE = 60;

// tooltip for a suspect chip — API-confirmation evidence when available, else
// a plain hint that this is a pre-screen flag (no per-account data fetched)
function evidenceTitle(t: (k: string, p?: Record<string, string | number>) => string, p: PersonView): string {
  if (p.api) {
    return t("people.evidence", {
      followers: p.api.followers,
      repos: p.api.repos,
      created: p.api.created,
      note: p.api.note || "-",
    });
  }
  return t("people.click_name", { login: p.login });
}

// Shared person chip used by both the follower/following lists and the
// relation panels: avatar (or letter fallback), real name + @login, the
// water/recruiter/bot/radar labels and — when scored — the influence score
// (★ n; radar-green at >= RADAR_SCORE, muted grey below).
export function PersonChip({ p, t, onOpen, href }: {
  p: PersonView;
  t: (k: string, p2?: Record<string, string | number>) => string;
  onOpen?: (login: string) => void;
  href?: string;
}) {
  const score = p.score ?? 0;
  const inner = (
    <>
      {p.avatar ? (
        <img
          className="person-avatar"
          src={p.avatar}
          alt=""
          referrerPolicy="no-referrer"
          onError={(e) => {
            // broken avatar (deleted account / rate-limited CDN): hide
            // the img and show a letter chip instead
            (e.target as HTMLImageElement).style.display = "none";
            const next = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
            if (next) next.style.display = "inline-flex";
          }}
        />
      ) : null}
      <span
        className="person-avatar-letter"
        style={p.avatar ? { display: "none" } : undefined}
      >
        {(p.login || "?").slice(0, 1).toUpperCase()}
      </span>
      <span className="person-id">
        {p.name && p.name !== p.login ? <span className="person-name">{p.name}</span> : null}
        <span className="person-login">@{p.login}</span>
      </span>
      {p.type === "Bot" ? <span className="chip bot">{t("people.bot")}</span> : null}
      {p.recruiter ? <span className="chip recruiter">{t("people.recruiter")}</span> : null}
      {score < RADAR_SCORE && p.suspect === "high" ? <span className="chip suspect" title={evidenceTitle(t, p)}>{t("people.water")}</span> : null}
      {score < RADAR_SCORE && p.suspect === "medium" ? <span className="chip suspect-med" title={evidenceTitle(t, p)}>{t("people.maybe_water")}</span> : null}
      {score >= RADAR_SCORE ? <span className="chip radar">★ {score}</span> : null}
      {score > 0 && score < RADAR_SCORE && !p.suspect ? <span className="chip score-muted">★ {score}</span> : null}
    </>
  );
  if (href) {
    // relation-panel chip: the main body analyzes in-app (same click
    // behaviour as the follower lists), the small ↗ link opens GitHub.
    return (
      <span className="person-chip person-link">
        <button
          className="person-open"
          onClick={() => onOpen?.(p.login)}
          title={t("people.click_name", { login: p.login })}
        >
          {inner}
        </button>
        <a className="person-ext" href={href} target="_blank" rel="noreferrer" title={t("people.open_github")}>
          ↗
        </a>
      </span>
    );
  }
  return (
    <button
      className="person-chip"
      onClick={() => onOpen?.(p.login)}
      title={t("people.click_name", { login: p.login })}
    >
      {inner}
    </button>
  );
}

// Followers / Following — a list of GitHub logins. Clicking one analyzes that
// person *in-app* (onOpen), it does NOT link out to their GitHub profile.
// When scores.json exists (make score), the header offers a by-influence sort
// and high scorers get a "radar" badge.
export function PersonList({ title, people, totals, note, onOpen }: {
  title: string; people: PersonView[]; totals: number; note?: string;
  onOpen: (login: string) => void;
}) {
  const t = useT();
  // Default to the influence (score) sort — that's what the lists are for;
  // the toggle flips back to GitHub's native order.
  const [byScore, setByScore] = React.useState(true);
  // Long lists (hundreds of accounts) render the top chunk first; "show all"
  // expands the rest. Re-sorting resets back to the top chunk.
  const [showAll, setShowAll] = React.useState(false);
  const PAGE = 100;
  const scored = people.some((p) => typeof p.score === "number" && p.score > 0);
  const sorted = byScore
    ? [...people].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : people;
  const visible = showAll ? sorted : sorted.slice(0, PAGE);
  return (
    <div className="panel">
      <h2>
        {title} <span className="muted">{t("people.shown_total", { shown: visible.length, total: totals })}</span>
        {scored && (
          <button className="chip btn-sort" onClick={() => { setByScore(!byScore); setShowAll(false); }}>
            {byScore ? t("people.sort_score") : t("people.sort_default")}
          </button>
        )}
      </h2>
      {people.length === 0 && <p className="muted">{note || t("people.no_data")}</p>}
      {people.length > 0 && (
        <div className="person-list">
          {visible.map((p) => (
            <PersonChip key={p.login} p={p} t={t} onOpen={onOpen} />
          ))}
        </div>
      )}
      {people.length > PAGE && !showAll && (
        <p className="muted">
          <button className="chip btn-sort" onClick={() => setShowAll(true)}>
            {t("people.show_all", { n: people.length })}
          </button>
        </p>
      )}
      {people.length > 0 && totals > people.length && (
        <p className="muted">{t("people.more", { n: totals - people.length })}</p>
      )}
    </div>
  );
}
