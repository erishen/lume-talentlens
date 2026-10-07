# lume-talentlens

A recruiting dashboard that reads a person's GitHub footprint and surfaces
**talent signals** — profile (open-to-work, socials), engineering rigor,
output cadence, focus, community — built on the
**Lume** single-binary C framework (a **full build**; see
[Requirements](#requirements)) with a **React + TypeScript** client.

> Lume gives you a `.lume` DSL for routes/SSR/agent-tools plus a native HTTP
> server (loopback-only) and a built-in LLM chat agent. This project wires it
> to a local snapshot of `github.com` repos so the whole thing runs offline.

## Requirements

- **A full Lume build** — the app defaults to `LUME ?= ../research/lume/bin/lume`
  (the full build checked out beside this repo; build it with `make` in
  `../research/lume`). Override with `LUME=/path/to/lume`. A *release* binary
  will be rejected at startup with a clear message — see the outbound-HTTP
  note below.
- **Node 18+ / pnpm** for the frontend (`(cd frontend && pnpm install)`).
- Optional: `.env` with `OWNER` / `GH_TOKEN` / `LLM_*` (see
  [Configuration](#configuration-env)).

> **Outbound HTTP note:** the Lume *release* binary (agent-httpd 1.0) ships
> without the `http_get` / `http_put` / `http_delete` builtins, so the
> live-fetch proxy (`/api/live/github`), the people refresh (`/api/refresh`)
> and the follow/unfollow endpoints cannot work on it. This app therefore
> requires a **full build**; `make dev` probes the binary and refuses to start
> with an incapable one.

## Layout

```
app/
  github.lume        # entry: server{}, JSON routes, SSR pages, agent tools, run()
  lib/github.lume    # pure analysis helpers (histograms, sort, view, bundle)
  lib/ui.lume        # SSR page components (nav, kpi, bars, repo_row, page)
frontend/
  src/main.tsx       # React entry — Dashboard (default) or Agent (data-page=chat)
  src/Dashboard.tsx  # KPIs, language/recency/year bars, top-10, search, paged list
  src/Agent.tsx      # SSE chat client for the server-native /react/api/chat
  src/api.ts, types.ts, tsconfig.json, package.json
www/github/
  index.html         # SPA shell at "/" (React dashboard)  <- served via views dir
  chat.html          # agent shell at /chat
  app.css            # shared dark stylesheet (SSR + React)
  app.js             # React bundle (built output)
data/github/         # snapshot produced by scripts/fetch-github.sh
scripts/
  fetch-github.sh    # paginate /users/<owner>/repos, pre-compute derived fields
  build-ui.sh        # pnpm-managed deps + run esbuild
Makefile             # check / fetch / ui / run
```

## Quick start

```bash
(cd frontend && pnpm install) # frontend deps (react, esbuild, typescript) — first clone only
make dev          # kill any server on the port + build UI + esbuild watch +
                  # foreground server on :8091 (Ctrl-C stops server + watcher)
# or step by step:
make fetch        # snapshot your repos -> data/github/
make ui           # esbuild React bundle -> www/github/app.js
make check        # type-check the .lume files + runtime sanity (sanity.lume)
make dev PORT=9000
```

The server always runs in the **foreground** — there is no background
`make run`; `make dev` is the one dev loop and it kills whatever already
holds the port before starting.

Open <http://127.0.0.1:8091/> for the React dashboard, `/chat` for the agent,
or the JSON below.

## Configuration (`.env`)

Copy `.env.example` to `.env` and set your own values — the file is gitignored,
so a public clone carries **no personal data** (your snapshots under
`data/github/` are gitignored too, and no owner is hard-coded anywhere):

```bash
cp .env.example .env   # then edit OWNER=your-github-login
```

| Key | Purpose |
|---|---|
| `OWNER` | Your GitHub login. Default owner until `data/github/last_owner` exists, and the **only** owner whose follower/following lists get the water-account / recruiter pre-screen (`suspects.json`) merged into `/api/people`. |
| `GH_TOKEN` | Optional classic PAT (scope `user:follow`): 60 → 5000 req/h for the live proxy (`/api/live/github`), people refresh (`/api/refresh`), `fetch-github.sh`, `people-scan.sh`, `unfollow.sh`. Never commit a real token. |
| `LUME_GITHUB_PORT` | Optional port override (default 8091). |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | Optional, for the `/chat` agent and agent tools: point Lume's built-in LLM bridge at any OpenAI-compatible endpoint (e.g. `https://api.openai.com/v1` + `gpt-4o-mini`). Leave unset to get the canned offline engine. |
| `LLM_TIMEOUT` | Optional; seconds to wait on the upstream LLM stream (default 60). |
| `LLM_SYSTEM_EXTRA` | Optional raw text **appended to the agent's system prompt** — scenario guidance the agent must always follow (which data to answer from, how to cite evidence, output language). Single line only (the `.env` loader reads line by line). |
| `AGENTHTTPD_CSP_IMG_SRC` | Optional space-separated origins **appended to the server's `Content-Security-Policy` `img-src`** (default policy: `'self' data:`). Needed when the UI loads third-party images — this app uses it to allow GitHub avatar CDNs: `AGENTHTTPD_CSP_IMG_SRC=https://avatars.githubusercontent.com`. |

Every key above is **exported to the app/server processes by the Makefile**
(`export …` next to `-include .env`) at `make dev` startup — the server also
has a lazy `.env` loader, but the explicit export is the reliable path. The
shell/python scripts source `.env` too. Any of these can also be passed as a
normal env var (e.g. `OWNER=acme make fetch`), which always wins.

> The server binds `127.0.0.1` only. The agent and dashboard run against the
> **local snapshot** for cached owners. Uncached owners are fetched on demand
> through the server's `/api/live/github` route, which calls GitHub's REST API
> from the host via Lume's built-in `http_get()` (outbound TLS through
> libssl) and **projects the response down to the fields the app consumes**
> (raw 100-repo pages are ~250KB and would break the framework's response cap).
> Set `GH_TOKEN` for the 5000 req/h authenticated limit; without it the shared
> server IP is limited to ~60 req/h unauthenticated. Set the `LLM_*` vars (see
> the Configuration table above) to enable real model-backed chat; otherwise a
> canned offline engine replies.

> **Two view tiers.** The SSR pages (`/overview`, `/repos`, `/api`) are a
> read-only, dependency-free view of the same snapshot. The React dashboard at
> `/` is the full interactive product: talent signals, composite health
> score, copy-ready HR note, side-by-side compare, push-activity trend, and
> server-fetched live data for uncached owners. Prefer the React dashboard for
> anything an HR / recruiter would act on.
>
> `make dev` is the one dev loop (Ctrl-C stops server + watcher); it kills any
> previous server on the port, prunes stale agent session transcripts
> (`.data/sessions`, newest 30 kept) and rotates `logs/access.log` before
> starting.

## Routes

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/` | React SPA dashboard (static, `views` dir) |
| GET | `/overview` | SSR overview (KPIs + bars + top-10) |
| GET | `/repos` | SSR full repo list |
| GET | `/api` | SSR API reference |
| GET | `/chat` | React agent chat shell |
| GET | `/api/overview` | aggregates + talent signals + push_trend |
| GET | `/api/repos?offset=&limit=` | paged normalized repos (cap 50/page) |
| GET | `/api/owners` | locally-cached owners + current default |
| GET | `/api/people?owner=x` | followers / following (first page, up to 100 each) |
| GET | `/api/top` | top-10 by stars + by recency |
| GET | `/api/langs` `/api/recency` `/api/year` | single histograms |
| GET | `/api/search?q=rust` | substring match across name/desc/lang/topic — returns `{ owner, q, total, shown }` (shown ≤ 10) |
| GET | `/api/live/github?path=/users/<x>` | server-side GitHub proxy (outbound `http_get`); returns `{ ok, status, data, err }` — big payloads are slim-projected before returning |
| GET | `/discovery` | boot-time tool/skill/MCP catalog |

> The framework caps a single response body, so `/api/overview` ships
> aggregates only, the full repo list is paged via `/api/repos`, and the live
> proxy projects raw GitHub JSON down to app-consumed fields.

## Agent tools

`repo_insights`, `repo_search`, `repo_language`, `repo_recency`, `repo_year`,
`repo_stats` — all read the in-memory snapshot and return compact JSON.
`github_story` shapes the same data into interview self-intro / project-story
material. Network-side tools: `github_owners` (cached owners + default),
`github_radar` (mutual high scorers grouped by money pattern — startup /
crypto / company / content / tools / hunting / other, with one-line evidence)
and `github_people` (followers/following first pages + totals + merged
water-account suspect flags + mutual overlap). Ask the agent "who in my
network are real talents / how do they make money / who are the water
accounts" and it answers from local data with the radar/people tools.

## Data pipeline

`scripts/fetch-github.sh` (Python, no external deps beyond `curl`) paginates
`/users/<owner>/repos`, then **pre-computes** derived fields the Lume app
consumes: `created_year`, `age_days`, `days_since_push`, `days_since_updated`,
`recency` (active ≤90d / recent ≤365d / dormant ≤2y / stale — bucketed by
**days since last push**, not updated_at), trimmed
`description`, capped `topics`, and `push_month` (YYYY-MM, drives the
"recent activity" trend). The snapshot is projected to ~24 fields/repo so
the JSON stays small. Snapshots live in `data/github/<owner>/`, so any number
of owners can coexist; the last one fetched is recorded in
`data/github/last_owner` and used as the default owner (after the `OWNER`
env/`.env` setting) everywhere.

## Choosing an owner

The dashboard has an **owner box** (with a datalist of cached owners). Analyze
a GitHub account in either of two ways:

1. **Live (any owner, no pre-fetch)** — type a username and, if it isn't
   cached, the dashboard offers **Fetch live from GitHub**. The browser calls
   the same-origin `/api/live/github` route, which proxies GitHub's REST API
   *from the server* via Lume's built-in `http_get()` (outbound TLS). This
   sidesteps any browser CORS / egress problem with `api.github.com` — the
   page only ever talks to its own host. Unauthenticated it's shared at
   ~60 req/h; set `GH_TOKEN` to raise it.
2. **Cached / offline** — run `OWNER=acme make fetch` once; the owner is then
   listed under **cached** and every route + agent tool serves it from
   `data/github/acme/` with no network.

Supporting plumbing:
- **API**: append `?owner=<login>` to any route
  (`/api/overview?owner=torvalds`); without the param the default (last
  fetched) owner is used.
- **Missing snapshot**: JSON routes answer a 200 body
  `{"status":404,"error":"no_snapshot","owner":…,"hint":"…"}`; the UI renders
  that as the two-option panel above.
- **Agent tools**: all `repo_*` tools take an optional `owner` argument;
  `github_owners` lists the locally cached owners.

## Water-account / recruiter pre-screen

`scripts/people-suspects.py` flags likely mass-registered water accounts
(zombie/bulk-follow) among an owner's **followers and following** using only
local data (avatar-uid account-age proxy + login-name patterns) — **no GitHub
API cost**. It writes `data/github/<owner>/suspects.json`, and the server
merges that pre-screen into `/api/people` by login, so the dashboard shows
`水号 / maybe 水号 / 招聘方` chips on both lists:

```bash
make suspects                  # default owner, both lists (KIND=all)
KIND=following make suspects   # one list only
```

`scripts/unfollow.sh` is **data-driven** — it reads the `kind=following`
suspects from `suspects.json` (default level `high`; `--level medium` /
`--also "login …"` to widen) and unfollows them with a `user:follow` PAT.
Try it without a token first:

```bash
bash scripts/unfollow.sh --dry-run   # prints the candidate list, changes nothing
GH_TOKEN=ghp_xxx bash scripts/unfollow.sh
```

Precise per-account confirmation (followers_count / repo count / account
age) needs the GitHub API — see `scripts/people-scan.sh --help`.

## Talent radar, scoring & follow-worthy

`scripts/people-score.sh` ranks every follower/following by an influence
score (`min(50, repos*2) + min(50, followers/20) + min(30, age_years*3) +
5·hireable + 3·bio`) into `scores.json` (gitignored). The dashboard sorts by
score and badges `高分`; it also computes the **mutual-following** and
**worth-following** (high-score followers you don't follow yet) lists, and
shows a network-change diff after each refresh:

```bash
make score                 # re-rank everyone (default owner)
```

`scripts/follow-worthy.sh` follows back the high-score followers who haven't
been followed yet (idempotent, `user:follow` PAT required):

```bash
DRY_RUN=1 make follow-worthy        # list only
make follow-worthy                  # follow them
```

`scripts/radar-scan.sh` (make radar) scans your **mutual high scorers**
(score ≥ 120) and classifies each by money pattern — startup / crypto /
company / content / tools / hunting / other — from live profile + top repos
(2 API calls per person) into `data/github/<owner>/radar.json`. The
dashboard's **高手洞察 · 盈利模式** panel groups them, and each person chip
analyzes in-app on click:

```bash
make radar                 # re-scan (fresh profiles)
```

| GET | `/api/people_diff` | who followed/unfollowed since the last refresh (`has_history: false` on first refresh) |
| GET | `/api/radar` | radar.json as-is (`{status:404,…}` when `make radar` hasn't run) |

The `hireable` flag is cross-checked against repo activity (≤90d push =
genuinely job-hunting) and against founder signals (bio/company shows
founder/CEO/CTO → the chip reads "open to collab/hiring" instead of "open
to work", since founders keep the flag on to recruit).

## License

MIT — see [LICENSE](LICENSE).
