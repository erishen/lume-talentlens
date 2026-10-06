# lume-talentlens

A recruiting dashboard that reads a person's GitHub footprint and surfaces
**talent signals** — profile (open-to-work, socials), engineering rigor,
output cadence, focus, community — built on the
**[Lume](../research/lume)** single-binary C framework with a
**React + TypeScript** client.

> Lume gives you a `.lume` DSL for routes/SSR/agent-tools plus a native HTTP
> server (loopback-only) and a built-in LLM chat agent. This project wires it
> to a local snapshot of `github.com` repos so the whole thing runs offline.

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
  build-ui.sh        # symlink node_modules + run esbuild
Makefile             # check / fetch / ui / run
```

## Quick start

```bash
make run          # fetch (if missing) + build UI + start on :8091
# or step by step:
make fetch        # snapshot your repos -> data/github/
make ui           # esbuild React bundle -> www/github/app.js
make check        # type-check the .lume files
make run PORT=9000
```

Open <http://127.0.0.1:8091/> for the React dashboard, `/chat` for the agent,
or the JSON below.

> The server binds `127.0.0.1` only. The agent and dashboard run against the
> **local snapshot** for cached owners. Uncached owners are fetched on demand
> through the server's `/api/live/github` route, which calls GitHub's REST API
> from the host via Lume's built-in `http_get()` (outbound TLS through
> libssl) and **projects the response down to the fields the app consumes**
> (raw 100-repo pages are ~250KB and would break the framework's response cap).
> Set `GH_TOKEN` for the 5000 req/h authenticated limit; without it the shared
> server IP is limited to ~60 req/h unauthenticated. Set `LLM_*` env vars (see
> the Lume docs) to enable real model-backed chat; otherwise a canned offline
> engine replies.

> **Two view tiers.** The SSR pages (`/overview`, `/repos`, `/api`) are a
> read-only, dependency-free view of the same snapshot. The React dashboard at
> `/` is the full interactive product: talent signals, composite health
> score, copy-ready HR note, side-by-side compare, push-activity trend, and
> server-fetched live data for uncached owners. Prefer the React dashboard for
> anything an HR / recruiter would act on.
>
> `make stop` kills the Lume server and the dev-loop esbuild watcher.

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
`data/github/last_owner` and used as the default everywhere.

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
