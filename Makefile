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

.PHONY: dev check fetch ui clean people-scan suspects unfollow score follow-worthy radar smoke test classify

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

# "归类总览" — curl the running server's /api/classify and print a compact
# summary. Expects a server on :$(PORT) (e.g. `make dev` in another terminal).
#   make classify                # quarterly for default owner
#   SINCE=monthly make classify  # 3m also maps to quarterly in the script above
#   OWNER=foo make classify
classify:
	@OWNER="$(OWNER)" PORT="$(PORT)" bash scripts/classify.sh

# Stargazer scan: aggregate everyone who starred the owner's repos, score
# each with the people-score influence formula, write data/github/<owner>/
# stargazers.json and print a ranked table (★ EXPERT >= RADAR_SCORE, SELF /
# water flagged). ~1 API call per starred repo + 1 per person.
#   make stargazers                # default owner, all starred repos
stargazers:
	@OWNER="$(OWNER)" bash scripts/stargazers-scan.sh

# Remove build artifacts + runtime logs (all regenerable). Never touches
# data/github/ (your snapshots) or .env (your credentials).
clean:
	rm -f www/github/app.js ./.run ./.api-ov.json .lume-*.log
	rm -rf logs

# Frontend unit tests (vitest — pure logic: talent derivation, i18n parity)
# plus the .lume unit tests (pure functions, no server needed): SSRF guard
# (tests/live_guard.lume) and the trending is:public privacy boundary
# (tests/trending_guard.lume).
test:
	@echo "== lume guard unit tests =="
	@out=$$($(LUME) tests/live_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/trending_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@out=$$($(LUME) tests/classify_guard.lume 2>&1); echo "$$out"; echo "$$out" | grep -q '^PASS ' || exit 1; echo "$$out" | grep -q 'GUARD TESTS FAILED' && exit 1 || true
	@echo "== frontend unit tests =="
	cd frontend && pnpm test
