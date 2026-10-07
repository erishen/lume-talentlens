#!/usr/bin/env bash
# env.sh — shared .env loader for lume-talentlens shell scripts.
#
# Why this exists: the Makefile deliberately does NOT `-include .env`, because
# make would turn every key into a make variable and `make -pn` / debug output
# would print GH_TOKEN / LLM_API_KEY verbatim. Instead each script sources this
# file with the shell (variables live in the process env, never in make's
# database).
#
# Semantics:
#   - .env keys load into the environment ONLY if not already set (explicit
#     CLI/env values win over .env — `OWNER=foo make fetch` must fetch foo).
#   - If OWNER is still empty afterwards, fall back to data/github/last_owner
#     (written by `make fetch`), matching the old Makefile $(shell cat ...).
#   - Callers define ROOT before sourcing (all scripts do; dev.sh too).

# shellcheck disable=SC1090,SC2155
load_env() {
  local f="$1"
  [ -f "$f" ] || return 0
  local line k xtrace_on=0
  # suppress `bash -x` tracing while exporting, or the debug output would
  # echo the credential values (GH_TOKEN=...) verbatim; restore after.
  case "$-" in *x*) xtrace_on=1; set +x ;; esac
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    k="${line%%=*}"
    case "$k" in
      ''|*[!a-zA-Z0-9_]*) continue ;;
    esac
    if [ -z "${!k:-}" ]; then
      export "$line"
    fi
  done < "$f"
  # NOTE: `[ ... ] && cmd` would leak a nonzero exit when the test fails,
  # which under `set -e` makes the whole source fail — use an if.
  if [ "$xtrace_on" = 1 ]; then set -x; fi
}

load_env "$ROOT/.env"

if [ -z "${OWNER:-}" ] && [ -f "$ROOT/data/github/last_owner" ]; then
  OWNER="$(cat "$ROOT/data/github/last_owner")"
  export OWNER
fi
