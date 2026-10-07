#!/usr/bin/env bash
# dev.sh — dev loop for lume-talentlens (the Lume recruiting app):
#   1) free the port: kill :PORT listeners + this app's lingering Lume servers
#   2) if the target port still can't be freed (unkillable zombie), pick the
#      next free port above it and use that
#   3) rebuild the React UI (esbuild)
#   4) start esbuild --watch in the background (frontend edits hot-reload into app.js)
#   5) run the Lume server in the foreground (Ctrl-C stops server + watcher)
#
# Usage:  make dev            (default port 8091)
#         make dev PORT=9000  (try 9000 first, fall back to 9001… if busy)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# load local config from .env via the shell (not make -include, which would
# put GH_TOKEN / LLM_API_KEY into make's variable database and print them in
# make -pn / debug output). GH_ANALYZER_PAT is the non-credential-shaped
# alias github.lume reads (env() masks names containing TOKEN/API_KEY/...).
. "$ROOT/scripts/env.sh"
export GH_ANALYZER_PAT="${GH_ANALYZER_PAT:-${GH_TOKEN:-}}"

LUME="${LUME:-$ROOT/../research/lume/bin/lume}"
WANT_PORT="${PORT:-${LUME_GITHUB_PORT:-8091}}"

# shared kill/port-release helpers (kill_matching, wait_port_free, port_busy)
source "$ROOT/scripts/cleanup.sh"

# 1) free the target port: kill its listeners + every lingering instance of
#    THIS app (the github.lume entry + its workers), never other Lume apps.
#    kills are retried and verified (pgrep->kill->recheck, then -9), and the
#    port is polled until it actually releases. An unkillable leftover is
#    handled by the port fallback below.
kill_matching 'app/github.lume'
kill_matching 'esbuild src/main.tsx'
if ! wait_port_free "$WANT_PORT"; then
  echo "dev: :$WANT_PORT still held (unkillable) — will fall back below"
fi

# 1b) prune agent session transcripts: every chat writes one JSON file under
#     .data/sessions/ and nothing ever deletes them (the Lume runtime has no
#     file-remove builtin). Keep only the 30 newest at dev-loop start.
if [ -d "$ROOT/.data/sessions" ]; then
  stale="$(ls -t "$ROOT"/.data/sessions/gh-*.json 2>/dev/null | tail -n +31)"
  if [ -n "$stale" ]; then
    echo "$stale" | xargs rm -f
  fi
  remain="$(ls "$ROOT"/.data/sessions/gh-*.json 2>/dev/null | wc -l | tr -d ' ')"
  echo "dev: agent sessions pruned (keeping newest 30, $remain remain)"
fi

# 1c) rotate the access log: keep the previous run's log as access.log.1,
#     then start fresh — the file grows one line per request and never
#     rotates otherwise.
if [ -f "$ROOT/logs/access.log" ]; then
  mv -f "$ROOT/logs/access.log" "$ROOT/logs/access.log.1"
fi

# 2) pick a free port: the target, else the next free one above it. If the
#    target is held by an unkillable zombie we fall through to a fresh port
#    instead of refusing to start — make dev should always get you a server.
PORT="$WANT_PORT"
if port_busy "$WANT_PORT"; then
  found=""
  for i in $(seq 1 40); do
    cand=$((WANT_PORT + i))
    if ! port_busy "$cand"; then found="$cand"; break; fi
  done
  if [ -n "$found" ]; then
    echo "dev: :$WANT_PORT still busy (couldn't kill it) — using :$found"
    PORT="$found"
  else
    echo "dev: no free port near :$WANT_PORT — try 'make dev PORT=<free>'" >&2
    exit 1
  fi
fi
export LUME_GITHUB_PORT="$PORT"

# 3) rebuild UI once (fails soft: server can still serve the last build)
if ! bash scripts/build-ui.sh; then
  echo "dev: UI build failed — starting server with the previous build" >&2
fi

# 4) esbuild watch (background) — skip silently if the binary is unavailable
WATCH_PID=""
ESB="$ROOT/frontend/node_modules/.bin/esbuild"
if [ -x "$ESB" ]; then
  ( cd "$ROOT/frontend" && "$ESB" src/main.tsx --bundle --format=esm \
      --jsx=automatic --outfile=../www/github/app.js --watch=forever ) &
  WATCH_PID=$!
  echo "dev: esbuild watching frontend (pid $WATCH_PID)"
fi

# 5) server in the foreground; stop the watcher when it exits
echo "dev: Lume server on http://127.0.0.1:$PORT  (Ctrl-C stops server + watcher)"
"$LUME" app/github.lume
rc=$?
if [ -n "$WATCH_PID" ]; then
  kill "$WATCH_PID" 2>/dev/null || true
fi
echo "dev: stopped."
exit $rc
