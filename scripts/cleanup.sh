#!/usr/bin/env bash
# cleanup.sh — shared kill/port-release helpers for lume-talentlens.
# Sourced by dev.sh / stop.sh; defines:
#   kill_matching <pattern>  kill every process whose cmdline matches
#                            (TERM retried, then -9) until verified gone
#   wait_port_free <port>    poll until the port's listener is gone
# Usage: source scripts/cleanup.sh  (from the project ROOT)
set -uo pipefail

port_busy() { [ -n "$(lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null)" ]; }

# kill every process whose command line matches the pattern: TERM, recheck,
# then -9 as a last resort. Verified via pgrep, so stale instances of this
# app (github.lume + workers) can never survive into a fresh `make dev`.
kill_matching() {
  local pat="$1" tries=0
  while [ "$(pgrep -f "$pat" 2>/dev/null | wc -l | tr -d ' ')" != "0" ] && [ "$tries" -lt 5 ]; do
    for pid in $(pgrep -f "$pat" 2>/dev/null || true); do
      kill "$pid" 2>/dev/null || true
    done
    sleep 1
    tries=$((tries + 1))
  done
  for pid in $(pgrep -f "$pat" 2>/dev/null || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
}

# poll a port until its listener is gone (kill -9 each retry). Returns 0 if
# the port is free afterwards, 1 if something unkillable still holds it.
wait_port_free() {
  local port="$1" tries=0
  while port_busy "$port" && [ "$tries" -lt 5 ]; do
    for pid in $(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 1
    tries=$((tries + 1))
  done
  if port_busy "$port"; then
    return 1
  fi
  return 0
}
