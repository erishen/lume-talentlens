#!/usr/bin/env bash
# stop.sh — stop everything `make run` / `make dev` started for this app:
#   - the Lume server: kill by PORT first (reliable in sandboxed envs where
#     `pkill -f` can't see the full argv), pkill as a fallback
#   - the esbuild watcher (dev loop)
#
# Usage:  bash scripts/stop.sh [port]     (default 8091)
#         make stop                      (passes the Makefile PORT)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-${PORT:-8091}}"

# shared kill/port-release helpers (kill_matching, wait_port_free, port_busy)
source "$ROOT/scripts/cleanup.sh"

stopped=""
# 1) Lume server on the port + every other instance of this app (github.lume
#    entry + workers); kills are retried and verified via pgrep
if pgrep -f 'app/github.lume' >/dev/null 2>&1; then
  kill_matching 'app/github.lume'
  stopped="lume-server"
fi
wait_port_free "$PORT" || stopped="${stopped:+$stopped }(port:$PORT zombie)"
# 2) esbuild watcher (dev loop)
if pgrep -f 'esbuild src/main.tsx' >/dev/null 2>&1; then
  kill_matching 'esbuild src/main.tsx'
  stopped="${stopped:+$stopped }esbuild-watcher"
fi

sleep 1
if [ -n "$stopped" ]; then
  echo "stop: stopped -> $stopped"
else
  echo "stop: nothing running"
fi
exit 0
