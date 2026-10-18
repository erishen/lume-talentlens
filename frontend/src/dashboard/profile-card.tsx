import React from "react";
import type { Overview } from "../types";
import { useT } from "../i18n";

// GitHub homepage / profile card + the "open to work" chip. Split out of
// panels.tsx (which now just re-exports).

// GitHub exposes no LinkedIn field, so we synthesise a link: if the profile's
// `blog` already points at linkedin.com we use it directly, otherwise we fall
// back to a LinkedIn people-search seeded with the GitHub login (and the name
// when no login is known). Returns null when there is nothing to search with.
export function linkedinTarget(
  p?: { name?: string; login?: string; company?: string; blog?: string },
): { href: string; q: string } | null {
  const blog = (p?.blog || "").trim();
  if (/linkedin\.com/i.test(blog)) {
    return { href: /^https?:/.test(blog) ? blog : "https://" + blog, q: blog };
  }
  const q = (p?.login || p?.name || "").trim();
  if (!q) return null;
  return { href: "https://www.linkedin.com/search/results/all/?keywords=" + encodeURIComponent(q), q };
}

// "Open to work" chip cross-checked against repo activity. The GitHub
// hireable flag is self-reported and often stale (left on after landing a
// job); a recent push (<= 90d) means the person is likely genuinely
// job-hunting, while a stale one flags the switch as possibly outdated.
// Falls back to the plain chip when no repo activity is known (cached path).
//
// Founder exception: for accounts whose bio/company carries founder/CEO/CTO
// signals, hireable almost never means "looking for a job" — founders keep
// the flag on to recruit, find co-founders or take consulting. Label those
// "open to collaborate / hiring" instead of "job hunting".
const FOUNDER_RE = /(founder|co-?founder|\bceo\b|\bcto\b|\bcreator\b|\bowner\b)/i;

function OpenToWork({ p, tr }: { p: Overview["profile"]; tr: (k: string, p?: Record<string, string | number>) => string }) {
  const founder = FOUNDER_RE.test(`${p?.bio ?? ""} ${p?.company ?? ""}`);
  if (founder) {
    return <span className="chip o2w o2w-founder" title={tr("pc.o2w_founder_title")}>{tr("pc.o2w_founder")}</span>;
  }
  const last = p?.last_push;
  const days = last ? Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 86400000)) : -1;
  if (days >= 0 && days <= 90) {
    return <span className="chip o2w o2w-active" title={tr("pc.o2w_active_title")}>{tr("pc.o2w_active")}</span>;
  }
  if (days > 90) {
    return <span className="chip o2w o2w-stale" title={tr("pc.o2w_stale_title")}>{tr("pc.o2w_stale")}</span>;
  }
  return <span className="chip o2w" title={tr("pc.o2w_title")}>{tr("pc.open_to_work")}</span>;
}

// GitHub homepage / profile card — everything the `/users/{login}` endpoint
// exposes: avatar, name, bio, open-to-work, location/company, social links,
// snapshot meta. Rendered first so a recruiter sees the "who are they" before
// the numbers.
export function ProfileCard({ ov }: { ov: Overview }) {
  const tr = useT();
  const p = ov.profile;
  const year = p?.created_at ? new Date(p.created_at).getFullYear() : null;
  const social: { label: string; href: string; icon: string; title?: string }[] = [];
  if (p?.html_url) social.push({ label: "GitHub", href: p.html_url, icon: "🐙" });
  if (p?.blog) social.push({ label: tr("pc.website"), href: /^https?:/.test(p.blog) ? p.blog : "https://" + p.blog, icon: "🔗" });
  if (p?.twitter_username) social.push({ label: "@" + p.twitter_username, href: "https://twitter.com/" + p.twitter_username, icon: "🐦" });
  const li = linkedinTarget({ ...(p || {}), login: p?.login || ov.owner });
  if (li) social.push({ label: tr("pc.linkedin"), href: li.href, icon: "in", title: tr("pc.linkedin_tip", { q: li.q }) });

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
          <p className="pc-bio">{p?.bio || tr("pc.no_bio")}</p>
          <div className="pc-badges">
            {p?.hireable ? <OpenToWork p={p} tr={tr} /> : null}
            {p?.location ? <span className="chip">📍 {p.location}</span> : null}
            {p?.company ? <span className="chip">🏢 {p.company}</span> : null}
            {year ? <span className="chip">{tr("pc.since", { year })}</span> : null}
          </div>
        </div>
      </div>

      <div className="pc-links">
        {social.length > 0 && (
          <div className="pc-social">
            {social.map((s) => (
              <a key={s.label} className="social-chip" href={s.href} target="_blank" rel="noreferrer" title={s.title || s.label}>
                {s.icon} <span>{s.label}</span>
              </a>
            ))}
          </div>
        )}
        <div className="pc-stats muted">
          <span><b>{p?.followers ?? 0}</b> {tr("pc.followers")}</span>
          <span><b>{p?.following ?? 0}</b> {tr("pc.following")}</span>
          <span><b>{p?.public_repos ?? ov.count}</b> {tr("pc.repos")}</span>
          <span><b>{p?.public_gists ?? 0}</b> {tr("pc.gists")}</span>
        </div>
      </div>

      <p className="pc-snapshot muted">{tr("pc.snapshot", { fetched: ov.fetched_at, count: ov.count, non_fork: ov.non_fork_count })}</p>
    </section>
  );
}
