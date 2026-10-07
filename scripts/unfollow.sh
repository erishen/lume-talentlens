#!/usr/bin/env bash
# Unfollow water-account candidates flagged by people-suspects.py.
# Requires a GitHub PAT with the 'user:follow' scope — the token is read from
# GH_TOKEN (env or .env) and is NEVER printed or written to disk.
#
# The candidate list is data-driven: data/github/<OWNER>/suspects.json
# (kind=following) is the live source of truth, produced by
#   python3 scripts/people-suspects.py   # scans followers + following, no API cost
# A --also list lets you append explicit logins without touching the JSON.
#
# Usage:
#   GH_TOKEN=ghp_xxx bash scripts/unfollow.sh                 # level=high
#   GH_TOKEN=ghp_xxx bash scripts/unfollow.sh --level medium  # high + medium
#   bash scripts/unfollow.sh --dry-run                        # print list only
#   bash scripts/unfollow.sh --also "foo bar"                 # append logins
#
# Exit 0 only when every account was either unfollowed (204) or not followed
# (404); any 401/403/other failure exits non-zero so you can inspect the output.
set -u

API="https://api.github.com/user/following"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LEVEL=high
ALSO=""
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --level) LEVEL="${2:-high}"; shift 2;;
    --also)  ALSO="${2:-}"; shift 2;;
    --dry-run) DRY=1; shift;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//' | tail -n +2 | head -24; exit 0;;
    *) echo "unknown arg: $1 (try --help)" >&2; exit 1;;
  esac
done

# OWNER / GH_TOKEN from .env when not already in the environment
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
OWNER="${OWNER:-}"

# Historical API-verified water accounts (all unfollowed 2026-10-06 — kept as
# reference; the hardcoded list has been retired in favor of suspects.json):
#   pipiwork0007-ai  -> followers=1 repos=0, created 2026-05 (hard water account)
#   shinobi-coder701 / takumi-sato0209 / MaxCode917 -> 2600-4000 followers in 3-4 months
#   Lxcardoza993 / raviwijerathna1 -> borderline, kept per user choice
#   abdulwasio2521 -> 797 followers / 10 repos, looks like a real dev — consider removing
#   HEJustinSun (3367 fol / 1 repo in 6 weeks), irisdomain23 (705 fol in 1 month),
#   xcontcom (12772 fol), pwnedroot (7992 fol / 7 repos), jkdevcode (6541 fol),
#   webbrain-one (24555 repos — auto-commit farm)

# Read kind=following suspects from suspects.json (login list, space-separated)
LOGINS=""
if [ -n "$OWNER" ] && [ -f "$ROOT/data/github/$OWNER/suspects.json" ]; then
  LOGINS=$(python3 - "$ROOT" "$OWNER" "$LEVEL" <<'PY'
import json, sys
root, owner, level = sys.argv[1], sys.argv[2], sys.argv[3]
want = {"high": {"high"}, "medium": {"high", "medium"}, "all": {"high", "medium"}}.get(level, {"high"})
d = json.load(open(f"{root}/data/github/{owner}/suspects.json"))
seen, out = set(), []
for s in d.get("suspects", []):
    if s.get("kind", "") in ("following", "both") and s.get("level") in want and s["login"] not in seen:
        seen.add(s["login"]); out.append(s["login"])
print(" ".join(out))
PY
)
fi
if [ -n "$ALSO" ]; then LOGINS="${LOGINS} ${ALSO}"; fi
LOGINS=($LOGINS)

if [ "${#LOGINS[@]}" -eq 0 ]; then
  echo "no following suspects at level=$LEVEL in suspects.json (owner=${OWNER:-unset}) — nothing to do"
  echo "hint: run 'make suspects' to re-scan followers+following (no API cost)"
  exit 0
fi
echo "candidates (${#LOGINS[@]}): @${LOGINS[*]}"
if [ "$DRY" -eq 1 ]; then
  echo "dry-run: nothing was changed"
  exit 0
fi

if [ -z "${GH_TOKEN:-}" ]; then
  echo "error: GH_TOKEN is not set. Create a classic PAT with the 'user:follow' scope, then:" >&2
  echo "  GH_TOKEN=ghp_xxx bash scripts/unfollow.sh" >&2
  exit 1
fi

ok=0; skip=0; fail=0
for login in "${LOGINS[@]}"; do
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    -X DELETE \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$API/$login") || true
  case "$code" in
    204) echo "  unfollowed       @$login";            ok=$((ok+1));;
    404) echo "  not following    @$login (skipped)";  skip=$((skip+1));;
    403) echo "  FAILED 403       @$login (rate limit or token lacks 'user:follow')"; fail=$((fail+1));;
    401) echo "  FAILED 401       @$login (token invalid or revoked)";                 fail=$((fail+1));;
    *)   echo "  FAILED $code     @$login";            fail=$((fail+1));;
  esac
  sleep 0.6
done

echo "done: $ok unfollowed, $skip already-not-following, $fail failed"
[ "$fail" -eq 0 ]
