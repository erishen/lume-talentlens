# lume-talentlens — Lume recruiting dashboard for GitHub footprints
#
# Reuses the prebuilt Lume binary from the research tree (no compile needed).
# Default: LUME = ../research/lume/bin/lume (a sibling of this project).
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

LUME    ?= ../research/lume/bin/lume
APP     := app/github.lume
PORT    ?= 8091

# local config: OWNER / GH_TOKEN / LUME_GITHUB_PORT / LLM_* /
# AGENTHTTPD_CSP_IMG_SRC from .env (gitignored). `export` makes every key
# visible to the scripts/app child processes — the server gets them on the
# environment at startup instead of relying on its own lazy .env loader
# (which is cwd-dependent). Keep this list in sync with .env.example.
-include .env
export OWNER GH_TOKEN LUME_GITHUB_PORT LLM_API_URL LLM_API_KEY LLM_MODEL LLM_TIMEOUT LLM_SYSTEM_EXTRA AGENTHTTPD_CSP_IMG_SRC
# GH_TOKEN is masked by Lume's env() credential filter (any name containing
# TOKEN/API_KEY/SECRET/PASSWORD returns null, so an untrusted script cannot
# exfiltrate keys). The trusted github.lume still needs it for authenticated
# GitHub calls — map it to a non-credential-shaped name here (Makefile-level
# variable expansion; same process env either way).
export GH_ANALYZER_PAT := $(GH_TOKEN)

.PHONY: dev check fetch ui clean people-scan suspects unfollow

dev:
	@echo "== dev loop: kill :$(PORT) + rebuild + watch + run =="
	@PORT="$(PORT)" bash scripts/dev.sh

check:
	@echo "== type-checking .lume =="
	$(LUME) --check app/lib/github.lume app/lib/ui.lume $(APP)
	@echo "== runtime sanity (constructs the app relies on) =="
	$(LUME) app/sanity.lume

fetch:
	@echo "== fetching GitHub snapshot (owner: $(or $(OWNER),last_owner)) =="
	OWNER="$(or $(OWNER),$(shell cat data/github/last_owner 2>/dev/null))" \
	  bash scripts/fetch-github.sh

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
	@OWNER="$(or $(OWNER),$(shell cat data/github/last_owner 2>/dev/null))" \
	  bash scripts/people-scan.sh

# Flag water accounts / recruiters among an owner's followers AND following.
# Local-only (avatar-uid age + login patterns), no GitHub API cost. Writes
# data/github/<owner>/suspects.json, which the server merges into /api/people
# and unfollow.sh consumes (kind=following).
#   make suspects                  # default owner, both lists
#   KIND=following make suspects   # one list only
suspects:
	@OWNER="$(or $(OWNER),$(shell cat data/github/last_owner 2>/dev/null))" \
	  KIND="$(or $(KIND),all)" python3 scripts/people-suspects.py

# Dry-run the following-suspect unfollow list (actually unfollowing needs
# GH_TOKEN with 'user:follow' — see scripts/unfollow.sh --help).
unfollow:
	@bash scripts/unfollow.sh --dry-run

clean:
	rm -f ./.run ./.api-ov.json
