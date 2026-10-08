// exportPeopleCsv — dump the people/radar views into a downloadable CSV.
// Pure client-side (Blob + <a download>); no server round-trip. Columns:
// relationship (follower / following / mutual / worth), login, score, radar
// money pattern + note, hireable, profile URL.
import type { People, PersonView, Radar } from "./types";

const HEADERS = ["relation", "login", "score", "radar_mode", "radar_note", "hireable", "url"] as const;

// CSV cell escape: quote cells containing , " or newlines (standard RFC 4180).
// Additionally neutralize cells that START with a spreadsheet formula
// character (= + - @) by prefixing a single quote — the standard OWASP
// CSV-injection mitigation. GitHub logins can't contain those characters,
// but radar notes / bios are external text that may begin with e.g. "=".
export function esc(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (s === "") return "";
  const needsQuote = /[",\n]/.test(s);
  const body = s.replace(/"/g, '""');
  if (/^[=+\-@]/.test(s)) return "'" + (needsQuote ? `"${body}"` : body);
  return needsQuote ? `"${body}"` : body;
}

function row(p: PersonView, relation: string, radarByLogin: Map<string, Radar["people"][number]>): string {
  const r = radarByLogin.get(p.login);
  return [
    relation,
    p.login,
    p.score ?? "",
    r?.mode ?? "",
    r?.note ?? "",
    r?.hireable ? "yes" : "",
    p.url,
  ].map(esc).join(",");
}

export function exportPeopleCsv(
  people: People,
  mutual: PersonView[],
  worth: PersonView[],
  radar: Radar | null
): void {
  const radarByLogin = new Map<string, Radar["people"][number]>();
  if (radar) for (const p of radar.people) radarByLogin.set(p.login, p);

  const lines = [HEADERS.join(",")];
  const seen = new Set<string>();
  const push = (p: PersonView, relation: string) => {
    if (seen.has(p.login)) return; // a person appears once (mutual first)
    seen.add(p.login);
    lines.push(row(p, relation, radarByLogin));
  };
  for (const p of mutual) push(p, "mutual");
  for (const p of worth) push(p, "worth");
  for (const p of people.followers) push(p, "follower");
  for (const p of people.following) push(p, "following");

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `talent-pool-${people.owner}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
