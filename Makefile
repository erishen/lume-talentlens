# lume-talentlens — Lume recruiting dashboard for GitHub footprints
#
# Reuses the prebuilt Lume binary from the research tree (no compile needed).
# Default: LUME = ../research/lume/bin/lume (a sibling of this project).
#
# Common targets:
#   make dev      kill any server on the port, rebuild UI, esbuild watch +
#                 foreground Lume server (the dev loop; default :8091)
#   make check    type-check all .lume files (no server)
#   make fetch    snapshot the default owner's repos into data/github/<owner>/
#   make fetch OWNER=foo   snapshot a specific owner (adds it to the UI cache)
#   make ui       bundle the React dashboard (esbuild -> www/github/app.js)
#   make run      fetch (if missing) + ui + start server on :8091
#   make run PORT=9000
#   make logs     tail the server log
#
# `make dev` stops the watcher automatically when the foreground server exits.

LUME    ?= ../research/lume/bin/lume
APP     := app/github.lume
PORT    ?= 8091
LOG     := ./.lume-github.log

.PHONY: dev check fetch ui run stop logs clean people-scan

dev:
	@echo "== dev loop: kill :$(PORT) + rebuild + watch + run =="
	@PORT="$(PORT)" bash scripts/dev.sh

check:
	@echo "== type-checking .lume =="
	$(LUME) --check app/lib/github.lume app/lib/ui.lume $(APP)

fetch:
	@echo "== fetching GitHub snapshot (owner: $(or $(OWNER),default)) =="
	OWNER="$(or $(OWNER),$(shell cat data/github/last_owner 2>/dev/null || echo erishen))" \
	  bash scripts/fetch-github.sh

ui:
	@echo "== building React UI =="
	bash scripts/build-ui.sh

run: fetch-if-missing ui
	@echo "== stopping previous lume-talentlens instances (port :$(PORT)) =="
	@bash scripts/stop.sh $(PORT) >/dev/null 2>&1 || true
	@echo "== starting Lume server on :$(PORT) =="
	LUME_GITHUB_PORT=$(PORT) $(LUME) $(APP) > $(LOG) 2>&1 &
	@echo "  log -> $(LOG)"; echo "  stop: make stop"
	@sleep 3
	@echo "== routes =="
	@for p in / /api/overview /api/repos /api/people /overview /repos /api /chat /discovery; do \
	  printf '  %s -> %s\n' "$$p" "$$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$(PORT)$$p 2>/dev/null)"; \
	done

# Stop the Lume server and the esbuild watcher started by `make run`/`make dev`.
stop:
	@bash scripts/stop.sh $(PORT)

fetch-if-missing:
	@if [ ! -f data/github/last_owner ] && [ -z "$$(ls -d data/github/*/ 2>/dev/null)" ]; then \
	  echo "== no cached owner snapshots — fetching default owner =="; \
	  bash scripts/fetch-github.sh; \
	else \
	  echo "== owner snapshots present under data/github/ =="; \
	fi

logs:
	@tail -n 200 -f $(LOG)

# Rank an owner's followers by reach/prolificacy to surface expert suspects
# (people.json only lists them; this adds per-user profile fields).
#   make people-scan                # default owner's followers
#   OWNER=foo make people-scan
# For --limit / --kind, call the script directly (macOS make can't forward
# dash-args):  OWNER=foo bash scripts/people-scan.sh --limit 20
people-scan:
	@OWNER="$(or $(OWNER),$(shell cat data/github/last_owner 2>/dev/null || echo erishen))" \
	  bash scripts/people-scan.sh

clean:
	rm -f $(LOG) ./.run ./.api-ov.json
