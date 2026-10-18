# lume-talentlens

A recruiting dashboard that reads a person's GitHub footprint and surfaces
**talent signals** — profile (open-to-work, socials), engineering rigor,
output cadence, focus, community — built on the
**Lume** single-binary C framework (a build with the outbound-HTTP
builtins; see [Requirements](#requirements)) with a **React + TypeScript**
client.

> Lume gives you a `.lume` DSL for routes/SSR/agent-tools plus a native HTTP
> server (loopback-only) and a built-in LLM chat agent. This project wires it
> to a local snapshot of `github.com` repos so the whole thing runs offline.

## Requirements

- **A Lume build with the outbound-HTTP builtins** — the app defaults to the
  release binary at `~/.local/bin/lume` (absolute path; override with
  `LUME=/path/to/lume`). It needs `http_get` / `http_put` / `http_delete`
  for the live-fetch proxy (`/api/live/github`), the people refresh
  (`/api/refresh`) and the follow/unfollow endpoints — `make dev` probes the
  binary and refuses to start with an incapable one. See the
  [Lume version](#lume-version) note below.
- **Node 22+ / pnpm** for the frontend (`(cd frontend && pnpm install)`) — the
  vitest/jsdom stack pulls in undici 8, which needs Node 22+ (CI runs 24).
- Optional: `.env` with `OWNER` / `GH_TOKEN` / `LLM_*` (see
  [Configuration](#configuration-env)).

> **Lume version:** there is no `lume --version`. The release binary is a
> build of the Lume fork checked out at `../lume` (sibling of this repo). To
> see which version it corresponds to, list the fork's tags
> (`git -C ../lume tag`, e.g. `v0.6.1`) or resolve its current HEAD
> (`git -C ../lume describe --tags --always`). The installed
> `~/.local/bin/lume` ships the fork's proxy-fallback tweak (retry direct
> after a dead proxy) as of 2026-10-08; the previous binary is kept at
> `~/.local/bin/lume.bak-20261008`. After upgrading Lume, re-run
> `make check` and `make dev` — the capability probe validates that the
> binary still ships the HTTP builtins.

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md) (Chinese) for a deep dive on layers,
data model, data flows and key mechanisms. See [TODO.md](TODO.md) for the
development roadmap (prioritised feature/quality backlog).

```
app/
  github.lume        # entry: imports the lib modules, server{}, run()
  lib/analyze.lume   # pure analysis helpers (histograms, sort, view, bundle)
  lib/history.lume   # daily timeline store — people/health history (JSONL, one record per day)
  lib/shared.lume    # owner/snapshot/string helpers + gh_get (shared by modules)
  lib/api.lume       # JSON APIs: owners/overview/repos/…/people/refresh/people_diff/people_history/health_history
  lib/live.lume      # live GitHub proxy (/api/live/github) + auth probe
  lib/trending.lume  # GitHub trending projects (/api/trending, scrape + search fallback)
  lib/classify.lume  # classification rollup (/api/classify — language + topic rollup)
  lib/ssr.lume       # SSR pages (/overview, /repos, /api reference)
  lib/tools.lume     # LLM agent tools (repo_* / github_*)
  lib/actions.lume   # /discovery + POST /api/follow + DELETE /api/unfollow
  lib/ui.lume        # SSR page components (nav, kpi, bars, repo_row, page)
frontend/
  src/main.tsx       # React entry — Dashboard (default) or Agent (data-page=chat)
  src/Dashboard.tsx  # tabs: overview (KPIs/bars/top-10/compare/pool), repos, people, trending, classify
  src/dashboard/trending.tsx  # GitHub trending tab: global feed + per-owner "new repos" scope
  src/dashboard/classify.tsx  # classification tab: language distribution + topic frequency
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
Makefile             # check / fetch / ui / dev
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
make test         # frontend unit tests (vitest — talent derivation, i18n parity, CSV escaping)
make classify     # print the owner's repo classification rollup (needs a server on :8091)
make daily        # daily radar + change digest -> logs/daily/<date>.md
make trending-push # push the GitHub trending board to a group robot (DingTalk/WeCom/Server酱)
make archive      # export the radar pool as a markdown knowledge base (for HR/learning)
make dev PORT=9000
```

The server always runs in the **foreground** — there is no background
`make run`; `make dev` is the one dev loop and it kills whatever already
holds the port before starting.

## Docker

A containerised deployment is included: the image bundles the React UI with
esbuild, compiles the Lume fork binary (released binaries lack the
outbound-HTTP builtins `http_get`/`http_put`/`http_delete` that the live
fetch / refresh / follow endpoints need) and publishes it on host port :18091.

```bash
docker compose up -d --build   # first build compiles Rust — takes a while
open http://127.0.0.1:18091
```

- **Configuration** comes from `.env` (the same file `make dev` reads),
  injected by compose; `OWNER` / `GH_TOKEN` / `LLM_*` work unchanged.
- **Data persists** under `./data` (mounted into the container): snapshots
  plus the live-cache disk tier survive rebuilds.
- **Loopback only** — the port is published as `127.0.0.1:18091:18091` (host
  18091 → container 18091), the container is never reachable from the network
  (same posture as the native install; see [Security & privacy](#security--privacy)).
  The bridge network needs the app to bind `0.0.0.0` *inside* the container
  (`LUME_GITHUB_BIND` is set by compose); only the host mapping is loopback.
- **Fetch inside the container**: `docker compose exec app make fetch`
  (or `OWNER=foo docker compose exec app make fetch`).
- **Host services**: the container runs on the bridge network, so its
  `127.0.0.1` is the container itself — compose rewrites the proxy and LLM
  endpoint to `host.docker.internal` (e.g.
  `LUME_HTTP_PROXY=http://host.docker.internal:7897`,
  `LLM_API_URL=http://host.docker.internal:19070/v1/chat/completions`),
  which OrbStack forwards to the host loopback. Set `LUME_HTTP_PROXY_HOST` /
  `LLM_API_URL_HOST` in `.env` only if a host service listens elsewhere.
- **Slow / failing git+crates downloads**: rebuild with the proxy as build
  args: `docker compose build --build-arg HTTP_PROXY=http://host.docker.internal:7897 --build-arg HTTPS_PROXY=http://host.docker.internal:7897`.

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
| `LIVE_CACHE_TTL_SEC` | Optional TTL in seconds for the `/api/live/github` in-memory response cache (default 300; `0` disables). Repeated views of the same profile are served from the cache to save GitHub rate limit and latency. Successful responses are also persisted under `data/github/live/` (disk tier, `LIVE_DISK_TTL_SEC` default 24h) so agent tools and every browser reuse them across restarts. |

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
> canned offline engine replies. Write actions (`/api/follow`, `/api/unfollow`)
> accept **only** `Content-Type: application/json` — a CSRF guard: cross-site
> JSON fetches are blocked by the browser (no CORS headers, preflight fails)
> and HTML-form / text-plain carriers are rejected with 403 before the body is
> parsed.

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

## Security & privacy

- **Loopback-only.** The server binds `127.0.0.1` only — nothing listens on
  the network. Don't tunnel or port-forward it to the public internet:
  `/api/follow` / `/api/unfollow` act on **your** GitHub account with your
  token, and the dashboards show your personal network graph.
- **Write actions are CSRF-guarded.** Follow/unfollow/refresh accept only
  `Content-Type: application/json` (HTML forms and text/plain fetches are
  rejected with 403) and the server sends no CORS headers, so cross-site
  JSON is blocked by the browser. This Lume build does not expose request
  headers, so no Origin/Referer allowlist is layered on top — keep the server
  loopback-only.
- **Secrets never leave `.env`.** `GH_TOKEN` / `LLM_API_KEY` are read via
  `env()`, which masks any name containing TOKEN/API_KEY/SECRET/PASSWORD, and
  are never logged. `.env` and `data/github/` (snapshots, scores, suspects)
  are gitignored — a public clone carries no credentials and no personal
  snapshot data.
- **Least-privilege tokens.** Reads (snapshots, trending, live proxy) work with
  a classic token that has **no scopes** (it still raises the limit to 5,000/h)
  or a fine-grained token limited to public repositories (read-only). Only
  follow/unfollow needs `user:follow`; use a **separate** token for it (or skip
  those actions) instead of granting it to the read token.
- **Local PII at rest.** `data/github/` snapshots and `.data/sessions/` agent
  transcripts are plaintext; both are gitignored but never expire on their own.
  `make purge` expires sessions older than `SESSIONS_TTL_DAYS` (default 30) and
  `make purge-owner OWNER=x` deletes one owner's snapshot.
- **LLM agent data.** When you configure `LLM_*` and chat with the agent, the
  relevant snapshot data (repo list, profile, radar/people summaries) is sent
  to the LLM provider you configured. Leave `LLM_*` unset to use the offline
  canned engine, which never makes outbound calls.

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
| GET | `/api/people?owner=x` | followers / following (first page, up to 100 each) + merged water-account / recruiter pre-screen + influence scores |
| GET | `/api/top` | top-10 by stars + by recency |
| GET | `/api/langs` `/api/recency` `/api/year` | single histograms |
| GET | `/api/search?q=rust` | substring match across name/desc/lang/topic — returns `{ owner, q, total, shown }` (shown ≤ 10) |
| GET | `/api/radar` | talent radar as-is — `{status:404,…}` until `make radar` has run |
| GET | `/api/people_diff` | who followed / unfollowed since the last refresh (`has_history: false` on first refresh) |
| GET | `/api/people_history?owner=x&days=90` | daily follower/following timeline — `{ ok, owner, days, points:[{ date, ts, followers, following, added_followers, gone_followers, added_following, gone_following }] }`. One point per calendar day (upsert by date, written by `make fetch` / `/api/refresh`); the added_*/gone_* lists diff each day against the previous, so the dashboard can answer "who followed last week". `days` caps the window (default 90, max 365) |
| GET | `/api/health_history?owner=x&days=90` | daily open-source-health score — `{ ok, owner, days, points:[{ date, ts, total, pillars:{ activity, rigor, focus, influence } }] }`. Recorded by `/api/overview` (same score the dashboard shows); pillars are stored 0..1 so the UI re-scores the series with the current weights |
| GET | `/api/refresh` | server-side re-fetch of followers/following + profile totals, rewrites `people.json` (rate-limited, 60s per owner) |
| GET | `/api/live/github?path=/users/<x>` | server-side GitHub proxy (outbound `http_get`); returns `{ ok, status, data, err }` — big payloads are slim-projected before returning |
| GET | `/api/github_auth` | `{ authed: bool }` — whether live calls carry `GH_TOKEN` (5000 req/h); never leaks the token |
| GET | `/api/classify?owner=<login>&since=monthly\|quarterly\|year` | Classification rollup — the owner's **public** repos created within the window, aggregated by GitHub's language detection (Linguist) and applied topics. Returns `{ ok, owner, since, days, generated_at, count, total, truncated, languages:[{name,count}], topics:[{name,count}], repos:[…] }`, TTL-cached. Default window `quarterly` (90d); `pages` (default 1, max 3 → at most 300 repos). Queries always carry `is:public` and drop private items defensively. Fuels the dashboard "classify" tab and `make classify` |
| GET | `/api/trending?since=daily\|weekly\|monthly&lang=go&tr=zh&owner=<login>` | GitHub trending projects — for the global feed the server **scrapes github.com/trending itself** (the exact list, order and star counts the page shows); returns `{ ok, scope, owner, since, days, generated_at, source, count, items }`, TTL-cached (`TRENDING_CACHE_TTL_SEC` default 120, disk `TRENDING_DISK_TTL_SEC` default 600); `refresh=1` (UI refresh button, `make trending-push`) bypasses both to fetch fresh. `source` is `github-trending` or `github-search`. The page has no API and no owner scope, so `owner=<login>` (one account's own newly-created public repos, `user:<login> created:>window is:public`, `scope:"owner"`) and languages with no slug (C++, C#) fall back to the **Search API** (repos created within the window, sorted by stars) — that search always carries `is:public` (the call uses the server token, which can otherwise see the token owner's private repos), and private items are dropped defensively. `tr=zh` machine-translates descriptions into Chinese via the LLM gateway (`desc_zh`; best-effort, memoised, falls back to English) |
| GET | `/discovery` | boot-time tool/skill/MCP catalog |
| POST | `/api/follow` | follow a login with the PAT — body `{ "login": … }` (idempotent, 204; needs `user:follow`) |
| DELETE | `/api/unfollow` | unfollow a login with the PAT — body `{ "login": … }` (idempotent, 204; needs `user:follow`) |

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
`radar_insights` filters the radar pool by keyword (`query`, all space-
separated terms must match a person's bio/evidence note/company/mode/top-repo
names+descriptions) and a `min_score`, returning the top hits with their
one-line evidence — ask "which of my mutual high scorers build AI tools" and it
cites real repos/stars.

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
`water? / maybe-water / recruiter?` chips on both lists:

```bash
make suspects                  # default owner, both lists (KIND=all)
KIND=following make suspects   # one list only
```

The heuristic thresholds are configurable via `.env` (no code change needed to
change a judgment call) — `SUSPECT_MODE=standard|strict|lenient` picks a
preset (default `standard` reproduces the historic behavior exactly; `strict`
flags more accounts — recent = est. 2022+, a new year alone can be high —
`lenient` flags fewer with higher confidence — recent must be 2025+ *and* have
a login pattern, high needs 2026+ with ≥2 patterns). On top, individual knobs
override the active preset: `SUSPECT_RECENT_BOUND`, `SUSPECT_HIGH_BOUND`,
`SUSPECT_HIGH_NEEDS_PATTERN`, `SUSPECT_PATTERN_MIN`,
`SUSPECT_RECENT_NEEDS_PATTERN`, `SUSPECT_USE_UID` (0 disables the avatar-uid
age signal, leaving pattern-only detection), `SUSPECT_BUZZWORDS` /
`SUSPECT_BATCH_NAMES` (comma lists that *replace* the default vocabularies).
Every default is pinned by `scripts/suspects-selftest.py` (runs in
`make test`).

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

`scripts/people-score.sh` ranks every follower/following by a profile-only
influence score (`min(40, repos/2) + min(20, followers/50) +
min(15, followers/following·5) + min(10, age_years) + 5·hireable + 3·bio`,
water-accounts −20/−10 at merge) into `scores.json` (gitignored). Followers
are deliberately demoted (inflated counts are the classic marketing-account
tell) and replaced by the followers-vs-following ratio; water accounts lose
score so they can't buy ranking. The dashboard sorts by score and badges
`high-score`; it also computes the **mutual-following** and **worth-following**
(high-score followers you don't follow yet) lists, and shows a
network-change diff after each refresh:

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
(people-score ≥ 60) and re-ranks them with a quality score that stars
actually dominate — `min(40, star_total/10) + min(25, star-per-repo·5) +
activity (20 recent-90d / 10 within-1y) + demoted followers/age + hireable/bio
− water penalty` (cap ≈123) — then classifies each by money pattern (startup /
crypto / company / content / tools / hunting / other) from live profile +
full repo list into `data/github/<owner>/radar.json`. The dashboard's
**Talent radar · money patterns** panel groups them, and each person chip analyzes
in-app on click.

Each person also carries **monetization-signal badges**:
`site` (a real profile/product URL in the bio blog field), `product` (a top
repo with a homepage — the classic SaaS/paid-product tell), and `sponsor`
(GitHub Sponsors listing, probed via GraphQL when a token is set; a failed
probe is `null`/"unknown", never a false negative). People with no public
signal show a quiet "no public monetization signal" note.

```bash
make radar                 # re-scan (fresh profiles)
```

The `hireable` flag is cross-checked against repo activity (≤90d push =
genuinely job-hunting) and against founder signals (bio/company shows
founder/CEO/CTO → the chip reads "open to collab/hiring" instead of "open
to work", since founders keep the flag on to recruit).

## Daily radar & change digest

`scripts/daily-scan.sh` (`make daily`) runs the whole offline pipeline once a
day — snapshot, people, suspects, scores, radar — and writes a readable
day-over-day **change summary** to `logs/daily/<date>.md`: new followers /
unfollowers, new mutual high scorers ("新增高手"), and unfollowed water
accounts ("取关水号"). Safe to hook to a scheduler (launchd / cron) — it never
pushes notifications unless asked (publication requires an explicit
instruction; `NOTIFY=1` opts in, see "Push to a group robot"). A failed
step is recorded in the summary (with a non-zero exit) instead of aborting:
every overwriting step first snapshots the current file to a `*.prev.json`
copy, so old data is never destroyed.

```bash
make daily                     # full pipeline (GH_TOKEN recommended for the radar)
RADAR=0 make daily             # snapshot + people diff only (no score/radar)
DRY_RUN=1 make daily           # compose the summary from existing data (read-only)
```

The digest compares against the previous calendar day in `people_history.jsonl`
(already written by `make fetch` / `/api/refresh`), so consecutive runs produce
readable diffs even when a retry runs twice in one day.

## Push to a group robot (DingTalk / WeCom / Server酱)

Pushing to a chat group is an **explicit opt-in** — nothing is sent by default
(the "publication requires an instruction" rule). Configure a webhook in `.env`:

```bash
# .env
TREND_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=XXX
TREND_WEBHOOK_SECRET=SECxxx      # DingTalk 加签 secret; leave empty for keyword/IP mode

make trending-push               # push the GitHub trending board (daily, top 10, Chinese)
SINCE=weekly TOP=15 LANG_FILTER=Python make trending-push
DRY_RUN=1 make trending-push     # print the message, don't send
NOTIFY=1 make daily              # also push the daily change summary
```

- **Trending content**: prefers the running server's `/api/trending` — for the
  global feed that now reads **github.com/trending itself** (the exact list,
  order and star counts the page shows), TTL-cached, with `tr=zh` translating
  the descriptions so the group reads Chinese. With no server up it falls back to
  the **GitHub Search API** directly (repos created in the window, sorted by
  stars; descriptions stay English).
- **Message**: plain text (works for DingTalk/WeCom/Server酱), e.g.
  `📈 GitHub 趋势榜 · 每日 · 2026-10-18` + `n. owner/repo ⭐3.4k · Lang` + desc.
  Each repo is followed by its full `https://github.com/<owner>/<repo>` URL and
  the footer links `https://github.com/trending` — plain-text clients auto-link
  complete `https://` URLs, so every line is tappable (a bare `owner/repo` or
  `github.com/…` without the scheme would not be).
- **`scripts/notify.py`** is the transport: DingTalk 加签 (timestamp+sign, only
  for `oapi.dingtalk.com`), transport-layer retries (timeout/5xx/429, honours
  `Retry-After`), a business check on the 200 body's `errcode` (WeCom fails with
  200 too), and it masks the token-bearing URL in logs. It mirrors
  `work/sale/daoye-signal`'s module of the same name.
- Robot security settings, pick one: **加签** (recommended, set
  `TREND_WEBHOOK_SECRET`), **keyword** (set `TREND_WEBHOOK_KEYWORD` — `notify.py`
  prepends `【<keyword>】` to every message so both the trending board and the
  daily summary pass keyword inspection), or an **IP allowlist**.
- **Push trail**: `NOTIFY=1 make daily` appends one line per attempt to
  `logs/daily/last-push-status.log` (`<iso-ts> owner=… status=ok|fail rc=…`)
  so the push history stays auditable even after the terminal output is gone.
- **Privacy — this is the one place data leaves your machine.** The trending
  board only carries public repo names/stars/descriptions, but
  `NOTIFY=1 make daily` pushes the daily summary, which **includes third-party
  personal data: the GitHub logins of your new / lost followers, high-score
  mutuals, and unfollowed water accounts**. Only enable it (and only point it at
  a group you trust) when you accept that those logins are sent to the chat
  provider. Same rule for the LLM agent: with `LLM_*` set, chatting sends the
  owner's people/radar data (third-party logins) to the configured endpoint.

### Schedule it (macOS launchd)

`make trending-push` sends once, when you run it. To send the board every day
automatically, install a launchd agent:

```bash
make schedule-install              # install + load, daily at 09:00 local
make schedule-install HOUR=8 MIN=30
make schedule-status               # loaded? schedule? tail the run log
make schedule-uninstall
launchctl kickstart -k gui/$(id -u)/com.lume-talentlens.trending-push  # push now (test)
```

- `scripts/schedule.sh` renders `scripts/launchd/*.plist.in` into
  `~/Library/LaunchAgents/com.lume-talentlens.trending-push.plist` and loads it;
  `scripts/trending-push-scheduled.sh` is what it runs (same push as the make
  target — the running server for Chinese descriptions, else a direct GitHub
  fallback in English). Output lands in `logs/trending-push/scheduled.log`.
- If the Mac is asleep at the scheduled minute, launchd runs the missed slot
  **once** on next wake. `RunAtLoad` is deliberately off, so installing does not
  fire an immediate push.
- `launchd` is macOS-only; on Linux wire the same
  `bash scripts/trending-push-scheduled.sh` into cron instead.

## Talent knowledge base (`make archive`)

`scripts/archive.py` (`make archive`) turns the radar pool — profit signals,
money patterns, monetization signals (site / product / sponsor) — into a
structured **markdown knowledge base** for HR / learning. Each person gets a
section: one-line evidence, best-effort monetization tags (Sponsors / product
landing page / personal site / course / consulting), blog, company, location,
hireable status, star influence, and top repos. A summary table groups the pool
by money pattern. Offline — reads only `radar.json` + `people.json` (needs
`make score && make radar`, or `make daily`). Writes
`data/github/<owner>/archive.md` (gitignored, personal); override with
`OUT=/path/to/file.md make archive`.

## License

MIT — see [LICENSE](LICENSE).
