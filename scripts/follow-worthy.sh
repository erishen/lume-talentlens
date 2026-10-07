#!/usr/bin/env bash
# follow-worthy.sh — follow back the high-influence followers you haven't
# followed yet (the "worth following" list: score >= 120, not in following).
# Recomputes the list from data every run, so re-running after a refresh is
# safe and idempotent (already-followed people return 204 and are skipped).
#
# Needs GH_TOKEN with the 'user:follow' scope. Never prints the token.
#
# Usage:
#   bash scripts/follow-worthy.sh            # default owner, both from .env
#   OWNER=alice bash scripts/follow-worthy.sh
#   MIN_SCORE=110 bash scripts/follow-worthy.sh   # lower the bar
#   DRY_RUN=1 bash scripts/follow-worthy.sh  # list only, no API calls

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/env.sh"

OWNER="${OWNER:-}"
if [ -z "$OWNER" ]; then
  echo "follow-worthy: no owner. Set OWNER or add OWNER= to .env" >&2
  exit 1
fi
MIN_SCORE="${MIN_SCORE:-120}"
DRY_RUN="${DRY_RUN:-0}"
TOK="${GH_TOKEN:-}"
if [ -z "$TOK" ]; then
  echo "error: GH_TOKEN is not set. Create a classic PAT with the 'user:follow' scope, then:" >&2
  echo "  GH_TOKEN=ghp_xxx bash scripts/follow-worthy.sh" >&2
  exit 1
fi

PEOPLE="$ROOT/data/github/$OWNER/people.json"
SCORES="$ROOT/data/github/$OWNER/scores.json"
[ -f "$PEOPLE" ] || { echo "follow-worthy: $PEOPLE missing — run OWNER=$OWNER make fetch first" >&2; exit 1; }
[ -f "$SCORES" ] || { echo "follow-worthy: $SCORES missing — run make score first" >&2; exit 1; }

# worth = followers with score >= MIN_SCORE, not already in following
python3 - "$PEOPLE" "$SCORES" "$MIN_SCORE" > /tmp/follow-worthy.logins.txt << 'EOF'
import json, sys
people = json.load(open(sys.argv[1]))
scores = json.load(open(sys.argv[2]))
min_score = int(sys.argv[3])
following = {u.get("login") for u in people.get("following", []) if u.get("login")}
worth = []
for u in people.get("followers", []):
    login = u.get("login")
    if not login or login in following:
        continue
    if int(scores.get(login, {}).get("score", 0)) >= min_score:
        worth.append(login)
print("\n".join(worth))
EOF
LOGINS=()
while IFS= read -r l; do [ -n "$l" ] && LOGINS+=("$l"); done < /tmp/follow-worthy.logins.txt
rm -f /tmp/follow-worthy.logins.txt
TOTAL="${#LOGINS[@]}"
echo "follow-worthy: $TOTAL high-score followers to follow (@$OWNER, score >= $MIN_SCORE, dry-run=$DRY_RUN)" >&2
[ "$TOTAL" -eq 0 ] && { echo "nothing to do — all high-score followers already followed" >&2; exit 0; }

if [ "$DRY_RUN" = "1" ]; then
  for l in "${LOGINS[@]}"; do echo "  would follow  @$l"; done
  exit 0
fi

API="https://api.github.com/user/following"
ok=0; skip=0; fail=0
for login in "${LOGINS[@]}"; do
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    -X PUT \
    -H "Authorization: Bearer $TOK" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Length: 0" \
    "$API/$login") || true
  case "$code" in
    204) echo "  followed        @$login";   ok=$((ok+1));;
    404) echo "  FAILED 404      @$login (account not found)";            fail=$((fail+1));;
    403) echo "  FAILED 403      @$login (rate limit or token lacks 'user:follow')"; fail=$((fail+1));;
    401) echo "  FAILED 401      @$login (token invalid or revoked)";     fail=$((fail+1));;
    *)   echo "  FAILED $code    @$login";   fail=$((fail+1));;
  esac
  sleep 0.6
done

echo "done: $ok followed, $skip already-followed, $fail failed"
[ "$fail" -eq 0 ]
