#!/usr/bin/env bash
# purge.sh — delete local PII that has outlived its purpose.
#
#   bash scripts/purge.sh                      # .data/sessions older than 30d
#   SESSIONS_TTL_DAYS=7 bash scripts/purge.sh  # custom retention (0 = disabled)
#   bash scripts/purge.sh --dry-run            # list what would be removed
#   bash scripts/purge.sh --owner acme         # delete data/github/acme/*
#   make purge / make purge-owner OWNER=acme
#
# Why: data/github/<owner>/ snapshots (people.json, radar.json, suspects.json …)
# and .data/sessions/ chat transcripts hold third-party GitHub logins in clear
# text on disk. They are gitignored, but nothing ever expires. This gives the
# operator a deliberate, idempotent way to shrink that footprint:
#   - default run: expire agent chat transcripts past SESSIONS_TTL_DAYS;
#   - --owner: remove one owner's snapshot directory (explicit only).
#
# Safe: dry-run first; owner is charset-validated; no wildcard expansion.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/env.sh"

usage() {
  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

DRY_RUN="${DRY_RUN:-0}"
[ "$DRY_RUN" = "1" ] || DRY_RUN=0
OWNER_ARG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    --owner)
      OWNER_ARG="${2:-}"
      shift 2 || { echo "purge: --owner needs a value" >&2; exit 2; }
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "purge: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------- explicit owner purge
if [ -n "$OWNER_ARG" ]; then
  case "$OWNER_ARG" in
    *[!a-zA-Z0-9_-]*)
      echo "purge: unsafe owner '$OWNER_ARG' (allowed: A-Z a-z 0-9 _ -)" >&2
      exit 2
      ;;
    last_owner|live|trending|classify)
      echo "purge: '$OWNER_ARG' is a cache key, not an owner — refusing" >&2
      exit 2
      ;;
  esac
  DIR="$ROOT/data/github/$OWNER_ARG"
  if [ ! -d "$DIR" ]; then
    echo "purge: no snapshot dir at data/github/$OWNER_ARG (nothing to do)"
    exit 0
  fi
  N="$(find "$DIR" -type f | wc -l | tr -d ' ')"
  if [ "$DRY_RUN" = "1" ]; then
    echo "purge: [dry-run] would remove data/github/$OWNER_ARG ($N file(s))"
  else
    rm -rf "$DIR"
    echo "purge: removed data/github/$OWNER_ARG ($N file(s))"
  fi
  exit 0
fi

# ------------------------------------------------------- session retention purge
TTL="${SESSIONS_TTL_DAYS:-30}"
case "$TTL" in
  ''|*[!0-9]*)
    echo "purge: SESSIONS_TTL_DAYS must be a non-negative integer, got '$TTL'" >&2
    exit 2
    ;;
esac
if [ "$TTL" = "0" ]; then
  echo "purge: SESSIONS_TTL_DAYS=0 — session retention disabled"
  exit 0
fi

SDIR="$ROOT/.data/sessions"
if [ ! -d "$SDIR" ]; then
  echo "purge: no .data/sessions directory (nothing to do)"
  exit 0
fi

# -mtime +N = strictly older than N*24h. Empty result is normal.
FILES="$(find "$SDIR" -type f -name '*.json' -mtime +"$TTL" 2>/dev/null || true)"
N="$(printf '%s\n' "$FILES" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "$N" = "0" ]; then
  echo "purge: no session files older than ${TTL}d"
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "purge: [dry-run] would remove $N session file(s) older than ${TTL}d from .data/sessions"
  printf '%s\n' "$FILES" | sed '/^$/d' | head -20
  exit 0
fi

BEFORE="$(du -sk "$SDIR" 2>/dev/null | awk '{print $1}' || true)"
printf '%s\n' "$FILES" | sed '/^$/d' | while IFS= read -r f; do rm -f "$f"; done
AFTER="$(du -sk "$SDIR" 2>/dev/null | awk '{print $1}' || true)"
echo "purge: removed $N session file(s) older than ${TTL}d (${BEFORE:-0}KB -> ${AFTER:-0}KB)"
