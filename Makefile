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

# Local config (OWNER / GH_TOKEN / LLM_* / AGENTHTTPD_CSP_IMG_SRC) comes
# from .env — but NEVER via `-include .env`: make would turn every key into
# a make variable and `make -pn` / debug output would print GH_TOKEN and
# LLM_API_KEY verbatim. Each script sources .env itself through
# scripts/env.sh (shell-side, "already-set wins", last_owner fallback).
# OWNER / PORT below are only command-line overrides (make fetch OWNER=foo).
OWNER ?=
PORT ?= 8091

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

clean:
	rm -f ./.run ./.api-ov.json
