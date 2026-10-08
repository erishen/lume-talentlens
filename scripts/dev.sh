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

# Default to the full Lume build checked out under work/lume/lume (built
# via `make` there); the public release binary on PATH ships WITHOUT the
# outbound-HTTP builtins (http_get/http_put/http_delete) that this app's
# live / refresh / follow endpoints need, so a release binary is rejected by
# the capability probe below. LUME=/path/to/lume overrides; a missing binary
# or an incapable one fails fast with a clear message.
DEFAULT_LUME="$(cd "$ROOT/.." && pwd)/lume/bin/lume"
LUME="${LUME:-$DEFAULT_LUME}"
if [ -z "$LUME" ] || [ ! -x "$LUME" ]; then
  echo "dev: no Lume binary found at $LUME — build it (make in work/lume/lume) or set LUME=/path/to/lume" >&2
  exit 1
fi

# capability probe: a release build (agent-httpd 1.0) has no http_get and the
# app would crash at server boot with "undefined variable 'http_get'". Detect
# it up front so make dev fails with a usable message instead.
PROBE="$(mktemp -t lume-probe.XXXXXX.lume)"
printf 'print(http_get);\n' > "$PROBE"
if ! "$LUME" "$PROBE" >/dev/null 2>&1; then
  rm -f "$PROBE"
  echo "dev: $LUME lacks the outbound-HTTP builtins — this app needs a FULL lume build (release builds ship without http_get/http_put/http_delete). Default full build: $DEFAULT_LUME; override with LUME=/path/to/lume" >&2
  exit 1
fi
rm -f "$PROBE"
WANT_PORT="${PORT:-${LUME_GITHUB_PORT:-8091}}"

# Outbound HTTP goes direct (no proxy): api.github.com responds fast on this
# machine, and the flaky proxy TLS tunnel used to stall follow/live for 30s.
# The LLM endpoint is localhost so it is unaffected. Set LUME_HTTP_PROXY in
# .env to force a proxy (lume's http_put reads it as an override).
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY 2>/dev/null || true

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

# 1b2) prune expired live disk-cache entries: /api/live/github persists every
#      successful response under data/github/live/ (LIVE_DISK_TTL_SEC, default
#      24h). Old entries are stale-but-harmless; drop files older than 3 days
#      so the dir can't grow without bound.
if [ -d "$ROOT/data/github/live" ]; then
  n="$(find "$ROOT/data/github/live" -name '*.json' -mtime +3 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n" -gt 0 ]; then
    find "$ROOT/data/github/live" -name '*.json' -mtime +3 -delete 2>/dev/null
    echo "dev: live disk-cache pruned ($n stale entries older than 3d)"
  fi
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
