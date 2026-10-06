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

# local config: OWNER / GH_TOKEN / LUME_GITHUB_PORT from .env (gitignored).
# `export` makes OWNER visible to the scripts/app child processes too.
-include .env
export OWNER

.PHONY: dev check fetch ui clean people-scan

dev:
	@echo "== dev loop: kill :$(PORT) + rebuild + watch + run =="
	@PORT="$(PORT)" bash scripts/dev.sh

check:
	@echo "== type-checking .lume =="
	$(LUME) --check app/lib/github.lume app/lib/ui.lume $(APP)

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

clean:
	rm -f ./.run ./.api-ov.json
