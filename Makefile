# lume-talentlens — Lume recruiting dashboard for GitHub footprints
#
# Defaults to the RELEASE Lume binary at ~/.local/bin/lume (absolute path,
# no repo-relative lookup). This app needs a build that ships the
# outbound-HTTP builtins http_get/http_put/http_delete for its live fetch /
# people refresh / follow / unfollow endpoints; a binary without them fails
# fast at `make dev` (capability probe). Override with
# LUME=/path/to/lume make dev for a different build.
#
# Common targets:
#   make dev      THE dev loop: kill any server on the port, rebuild UI,
#                 esbuild watch + foreground Lume server (default :8091)
#   make check    type-check all .lume files (no server)
#   make fetch    snapshot the default owner's repos into data/github/<owner>/
#   make fetch OWNER=foo   snapshot a specific owner (adds it to the UI cache)
#   make ui       bundle the React dashboard (esbuild -> www/github/app.js)
#   make llm-check  diagnose the LLM gateway key + trending 机翻 (no server needed
#                 for the gateway check; PORT=18091 to also probe the container)
#   make docker-up  build + start the container (http://127.0.0.1:18091); also
#                 recreates it after a .env change. See docker-build/-down/-logs
#
# There is deliberately no `make run`: the server always runs in the
# foreground (Ctrl-C stops server + watcher). `make dev` also kills whatever
# already holds the port, so it is safe to re-run at any time.

LUME    ?= $(HOME)/.local/bin/lume
APP     := app/github.lume
PORT    ?= 8091

# Local config (OWNER / GH_TOKEN / LLM_* / AGENTHTTPD_CSP_IMG_SRC) comes
# from .env — but NEVER via `-include .env`: make would turn every key into
# a make variable and `make -pn` / debug output would print GH_TOKEN and
# LLM_API_KEY verbatim. Each script sources .env itself through
# scripts/env.sh (shell-side, "already-set wins", last_owner fallback).
# OWNER / PORT below are only command-line overrides (make fetch OWNER=foo).
OWNER ?=
PORT ?= 8091

# Schedule knobs for the launchd agent (see `make schedule-install`).
HOUR ?= 9
MIN  ?= 0

.PHONY: dev check fetch ui clean people-scan suspects unfollow score follow-worthy radar archive smoke test classify daily trending-push llm-check docker-build docker-up docker-down docker-logs docker-ps schedule-install schedule-uninstall schedule-status schedule-print purge purge-owner release

# Boot the app on an isolated port and assert every public contract the
# frontend/agent relies on (tears its own server down; never touches :8091).
#   make smoke            # includes the real live GitHub call
#   SKIP_LIVE=1 make smoke  # skip the network-dependent live check
smoke:
	@echo "== smoke: boot isolated server + assert contracts =="
	bash scripts/smoke.sh

dev:
	@echo "== dev loop: kill :$(PORT) + rebuild + watch + run =="
	@PORT="$(PORT)" bash scripts/dev.sh

# --check takes a single script; the entry transitively parse+type-checks every
# module it imports (lib/*), so checking $(APP) covers the whole app.
check:
	@echo "== type-checking .lume =="
	$(LUME) --check $(APP)
	@echo "== runtime sanity (constructs the app relies on) =="
	$(LUME) app/sanity.lume

fetch:
	@echo "== fetching GitHub snapshot (owner: $(or $(OWNER),from .env / last_owner)) =="
	OWNER="$(OWNER)" bash scripts/fetch-github.sh

ui:
	@echo "== building React UI =="
	bash scripts/build-ui.sh

# Rank an owner's followers by reach/prolificacy to surface expert suspects
# (people.json only lists them; this adds per-user profile fields).
#   make people-scan                # default owner's followers
#   OWNER=foo make people-scan
# For --limit / --kind, call the script directly (macOS make can't forward
# dash-args):  OWNER=foo bash scripts/people-scan.sh --limit 20
people-scan:
	@OWNER="$(OWNER)" bash scripts/people-scan.sh

# Flag water accounts / recruiters among an owner's followers AND following.
# Local-only (avatar-uid age + login patterns), no GitHub API cost. Writes
# data/github/<owner>/suspects.json, which the server merges into /api/people
# and unfollow.sh consumes (kind=following).
#   make suspects                  # default owner, both lists
#   KIND=following make suspects   # one list only
# The heuristics are configurable via .env (TODO #8): SUSPECT_MODE=standard|
# strict|lenient (default standard = historic behavior) plus per-knob
# overrides; see .env.example and scripts/suspects-selftest.py.
suspects:
	@OWNER="$(OWNER)" KIND="$(or $(KIND),all)" python3 scripts/people-suspects.py

# Dry-run the following-suspect unfollow list (actually unfollowing needs
# GH_TOKEN with 'user:follow' — see scripts/unfollow.sh --help).
unfollow:
	@bash scripts/unfollow.sh --dry-run

# Rank followers AND following by technical influence ("talent radar": the
# positive counterpart to the water-account pre-screen). One GitHub API call
# per person — set GH_TOKEN (5000 req/h) for a real run. Writes
# data/github/<owner>/scores.json, which the server merges into /api/people.
#   make score                  # both lists
#   KIND=followers make score   # one list only
score:
	@OWNER="$(OWNER)" bash scripts/people-score.sh

# Follow back the high-influence followers you haven't followed yet
# ("worth following": score >= 120). Needs GH_TOKEN with 'user:follow'.
#   make follow-worthy           # follow them
#   DRY_RUN=1 make follow-worthy # list only
follow-worthy:
	@OWNER="$(OWNER)" bash scripts/follow-worthy.sh

# Talent-radar profit-pattern scan: classify mutual high scorers by money
# pattern (startup/crypto/company/content/tools/hunting) into radar.json,
# served by /api/radar and shown in the dashboard's "高手洞察" panel.
#   make radar                     # re-scan (fresh profiles, ~2 API calls × N)
radar:
	@OWNER="$(OWNER)" bash scripts/radar-scan.sh

# 高手档案知识库 (TODO #11) — export the radar pool (profit signals: sponsor /
# site / product + best-effort tags) as a structured markdown knowledge base
# for HR / learning. Offline; needs the radar pool (make score && make radar,
# or make daily). Writes data/github/<owner>/archive.md (gitignored).
#   make archive                    # default owner
#   OUT=docs/pool.md make archive   # custom path
archive:
	@OWNER="$(OWNER)" python3 scripts/archive.py

# "归类总览" — curl the running server's /api/classify and print a compact
# summary. Expects a server on :$(PORT) (e.g. `make dev` in another terminal).
#   make classify                # quarterly for default owner
#   SINCE=monthly make classify  # 3m also maps to quarterly in the script above
#   OWNER=foo make classify
classify:
	@OWNER="$(OWNER)" PORT="$(PORT)" bash scripts/classify.sh

# Diagnose the trending-description machine-translation (机翻) path. Reads the
# LLM_* config from .env, POSTs one minimal request straight to the gateway
# (so a bad key — e.g. "invalid key format; expected prefix sk-tr-" — shows up
# immediately instead of being swallowed as a silent English fallback), then,
# if a server answers on :$(PORT), prints /api/trending's translation hit rate.
# Stage 1 needs no server; stage 2 skips cleanly when none is running.
#   make llm-check                # gateway + :8091 dev server
#   make llm-check PORT=18091     # also probe the Docker container
llm-check:
	@echo "== llm-check: gateway key + trending translation =="
	@PORT="$(PORT)" bash scripts/llm-check.sh

# -- container lifecycle (docker compose; image lume-talentlens:latest) --------
# The container serves http://127.0.0.1:18091 and reads its config from .env at
# START time. So after editing .env you must recreate the container for the new
# values to take effect — `make docker-up` does exactly that (compose sees the
# changed environment and recreates it).
docker-build:
	@echo "== docker: build image =="
	docker compose build

docker-up:
	@echo "== docker: up -d --build (recreates on .env change) =="
	docker compose up -d --build
	@echo "   -> http://127.0.0.1:18091  (docker compose logs -f to follow)"

docker-down:
	@echo "== docker: down =="
	docker compose down

docker-logs:
	docker compose logs -f

docker-ps:
	@docker compose ps

# Stargazer scan: aggregate everyone who starred the owner's repos, score
# each with the people-score influence formula, write data/github/<owner>/
# stargazers.json and print a ranked table (★ EXPERT >= RADAR_SCORE, SELF /
# water flagged). ~1 API call per starred repo + 1 per person.
#   make stargazers                # default owner, all starred repos
stargazers:
	@OWNER="$(OWNER)" bash scripts/stargazers-scan.sh

# "每日自动雷达 + 变更提醒" (TODO #5) — run the whole offline pipeline once
# (snapshot + people + suspects + scores + radar) and write a day-over-day
# change summary to logs/daily/<date>.md: new followers / unfollowers, new
# mutual high scorers ("新增高手"), unfollowed water accounts ("取关水号").
# Safe to hook to launchd/cron — it never pushes notifications. Failures are
# recorded in the summary (exit non-zero), never destroying the old data.
#   make daily                     # full pipeline
#   RADAR=0 make daily             # snapshot + people diff only (no score/radar)
#   DRY_RUN=1 make daily           # compose summary from existing data (read-only)
#   NOTIFY=1 make daily            # also push the summary to the webhook
#   NOTIFY_YES=1 make daily        # push without the PII warning
#   REDACT_LOGINS=1 make daily     # push masked logins (`er***en`) only
daily:
	@OWNER="$(OWNER)" NOTIFY="$(NOTIFY)" NOTIFY_YES="$(NOTIFY_YES)" REDACT_LOGINS="$(REDACT_LOGINS)" bash scripts/daily-scan.sh

# Shrink the local PII footprint: expire agent chat transcripts in .data/sessions
# older than SESSIONS_TTL_DAYS (default 30; 0 disables). Owner snapshots are only
# removed explicitly — never by the default run.
#   make purge                          # expire old sessions
#   SESSIONS_TTL_DAYS=7 make purge      # custom retention
#   DRY_RUN=1 make purge                # preview
#   make purge-owner OWNER=acme         # delete data/github/acme/*
purge:
	@DRY_RUN="$(DRY_RUN)" SESSIONS_TTL_DAYS="$(SESSIONS_TTL_DAYS)" bash scripts/purge.sh

purge-owner:
	@test -n "$(OWNER)" || { echo "usage: make purge-owner OWNER=<login>" >&2; exit 2; }
	@DRY_RUN="$(DRY_RUN)" bash scripts/purge.sh --owner "$(OWNER)"

# Push the GitHub trending board to a group webhook (钉钉自定义机器人 / 企微 /
# Server酱). Reads TREND_WEBHOOK_URL (+ optional TREND_WEBHOOK_SECRET 加签) from
# .env. Prefers the running server's /api/trending (translated, cached); falls
# back to the GitHub Search API directly when no server is up.
#   make trending-push                 # daily window, top 10, Chinese
#   make trending-push SINCE=weekly TOP=15 LANG_FILTER=Python
#   DRY_RUN=1 make trending-push       # print the message, don't push
trending-push:
	@ROOT="$$(pwd)" SINCE="$(SINCE)" TOP="$(TOP)" LANG_FILTER="$(LANG_FILTER)" DRY_RUN="$(DRY_RUN)" \
	  bash -c '. "$$ROOT/scripts/env.sh"; \
	    set -- --since "$${SINCE:-daily}" --top "$${TOP:-10}"; \
	    [ -n "$$LANG_FILTER" ] && set -- "$$@" --lang "$$LANG_FILTER"; \
	    [ -n "$$DRY_RUN" ] && set -- "$$@" --dry-run; \
	    exec python3 scripts/trending-push.py "$$@"'

# macOS launchd agent: push the GitHub trending board to the group webhook once
# a day (the scheduled counterpart of `make trending-push`; opt-in, never
# auto-sends without TREND_WEBHOOK_URL in .env). Runs at HOUR:MIN local time;
# a slot missed while the Mac sleeps runs once on next wake.
#   make schedule-install             # install + load, daily at 09:00
#   make schedule-install HOUR=8 MIN=30
#   make schedule-status              # loaded? schedule? tail the log
#   make schedule-uninstall
#   make schedule-print               # render the plist without installing
schedule-install:
	@HOUR="$(HOUR)" MIN="$(MIN)" bash scripts/schedule.sh install

schedule-uninstall:
	@bash scripts/schedule.sh uninstall

schedule-status:
	@bash scripts/schedule.sh status

schedule-print:
	@HOUR="$(HOUR)" MIN="$(MIN)" bash scripts/schedule.sh print

# ---- daily-scan launchd (每日雷达摘要 logs/daily/, 看板 lume-talentlens.daily 看护项) ----
# 与 schedule-install(trending) 同机制; 默认 14:00。安装: make daily-schedule-install
daily-schedule-install:
	@TASK=daily HOUR="$(HOUR)" MIN="$(MIN)" bash scripts/schedule.sh install

daily-schedule-uninstall:
	@TASK=daily bash scripts/schedule.sh uninstall

daily-schedule-status:
	@TASK=daily bash scripts/schedule.sh status

# Remove build artifacts + runtime logs (all regenerable). Never touches
# data/github/ (your snapshots) or .env (your credentials).
clean:
	rm -f www/github/app.js ./.run ./.api-ov.json .lume-*.log
	rm -rf logs

# Frontend unit tests (vitest — pure logic: talent derivation, i18n parity)
# plus the .lume unit tests (pure functions, no server needed): SSRF guard
# (tests/live_guard.lume), the trending is:public privacy boundary
# (tests/trending_guard.lume), the github.com/trending HTML scraper
# (tests/trending_html_guard.lume), and the timeline history store + health
# mirror (tests/history_guard.lume).
test:
	@echo "== lume guard unit tests =="
	@out=$$($(LUME) tests/shared_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/live_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/trending_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/trending_html_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/classify_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/history_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/radar_insights_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@echo "== water-account heuristics selftest =="
	@python3 scripts/suspects-selftest.py
	@echo "== webhook push (notify/trending-push) selftest =="
	@python3 scripts/notify-selftest.py
	@echo "== frontend unit tests =="
	cd frontend && pnpm test

# Release: tag the commit, push the tag, print a release-notes skeleton.
# Source-only — no secrets, no binaries. Fill in the notes from the git log
# before pushing (or edit the tag message after).
release:
	@echo "== release: tag + push =="
	@TAG="$${TAG:-$$(date +%Y.%m.%d)-$$(git rev-parse --short HEAD)}"; \
	  echo "   tag: $$TAG"; \
	  git tag -a "$$TAG" -m "release $$TAG" && git push origin "$$TAG" && \
	  echo "   pushed tag $$TAG"; \
	  echo; echo "== release notes (fill in before publishing) =="; \
	  git log --oneline -15 --no-decorate | sed 's/^/   /'; \
	  echo; echo "   Full changelog: git log --oneline main..$$TAG"
