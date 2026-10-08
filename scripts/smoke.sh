#!/usr/bin/env bash
# smoke.sh — boot the app on an ISOLATED port and assert every public
# contract the frontend / agent relies on. Exits non-zero on any failure.
#
# Usage:
#   bash scripts/smoke.sh              # isolated port 8092 (never touches :8091 dev)
#   SKIP_LIVE=1 bash scripts/smoke.sh  # skip the real GitHub live call (no network)
#   LUME=/path/to/lume bash scripts/smoke.sh
#
# The script starts its own server, probes readiness, runs the checks, then
# tears the server down — the caller's `make dev` (if any) is left alone.
set -u
cd "$(dirname "$0")/.."

LUME_BIN="${LUME:-../lume/bin/lume}"
PORT="${SMOKE_PORT:-8092}"
LOG="/tmp/lume-smoke-$$.log"
OWNER="${OWNER:-$(cat data/github/last_owner 2>/dev/null | tr -d '[:space:]')}"
[ -z "$OWNER" ] && OWNER="${OWNER:-erishen}"

# clean a stale smoke server on OUR port only
lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true
sleep 1

LUME_GITHUB_PORT="$PORT" "$LUME_BIN" app/github.lume >"$LOG" 2>&1 &
SRV=$!
cleanup() {
  kill -9 "$SRV" 2>/dev/null
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null
  rm -f "$LOG"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
# assert_code <desc> <expected_code> <url> [method=GET]
assert_code() {
  local desc="$1" want="$2" url="$3" method="${4:-GET}"
  local got; got=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X "$method" "http://127.0.0.1:$PORT$url")
  if [ "$got" = "$want" ]; then ok "$desc ($got)"; else bad "$desc (want $want, got $got)"; fi
}
# assert_contains <desc> <url> <grep-pattern>
assert_contains() {
  local desc="$1" url="$2" pat="$3"
  local body; body=$(curl -s -m 30 "http://127.0.0.1:$PORT$url")
  if printf '%s' "$body" | grep -qE "$pat"; then ok "$desc"; else bad "$desc (missing: $pat)"; fi
}

echo "== smoke on :$PORT (owner=$OWNER) =="
code=""
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$PORT/api/owners" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then
  echo "FAIL: server never became ready (last code=$code)"
  tail -20 "$LOG"
  exit 1
fi
ok "server ready"

echo "-- data endpoints --"
assert_code  "GET /api/owners"        200 "/api/owners"
assert_code  "GET /api/overview"      200 "/api/overview?owner=$OWNER"
assert_code  "GET /api/repos paged"   200 "/api/repos?owner=$OWNER&offset=0&limit=50"
assert_code  "GET /api/top"           200 "/api/top?owner=$OWNER"
assert_code  "GET /api/langs"         200 "/api/langs?owner=$OWNER"
assert_code  "GET /api/recency"       200 "/api/recency?owner=$OWNER"
assert_code  "GET /api/year"          200 "/api/year?owner=$OWNER"
assert_code  "GET /api/search"        200 "/api/search?owner=$OWNER&q="
assert_code  "GET /api/people"        200 "/api/people?owner=$OWNER"
assert_code  "GET /api/people_diff"   200 "/api/people_diff?owner=$OWNER"
assert_code  "GET /api/radar"         200 "/api/radar?owner=$OWNER"
assert_code  "GET /discovery"         200 "/discovery"
assert_code  "GET /api/github_auth"   200 "/api/github_auth"

echo "-- SSR + SPA --"
assert_code  "GET /"                  200 "/"
assert_code  "GET /overview"          200 "/overview?owner=$OWNER"
assert_code  "GET /repos"             200 "/repos?owner=$OWNER"
assert_code  "GET /api reference"     200 "/api"
assert_code  "GET /chat"              200 "/chat"

echo "-- write-action registration (empty body -> rejected, proves route exists) --"
# the app's API style: errors are HTTP 200 with {"ok":false,...} (same as the
# no_snapshot contract), so assert the envelope, not the HTTP code
assert_reject() {
  local desc="$1" method="$2" url="$3"
  local code body
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X "$method" "http://127.0.0.1:$PORT$url")
  body=$(curl -s -m 30 -X "$method" "http://127.0.0.1:$PORT$url")
  if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"ok":false'; then
    ok "$desc (rejected)"
  else
    bad "$desc (code=$code body=$body)"
  fi
}
assert_reject "POST /api/follow"   POST   "/api/follow"
assert_reject "DELETE /api/unfollow" DELETE "/api/unfollow"
# CSRF guard: a write action with a non-JSON Content-Type (HTML form /
# text-plain fetch carrier) must be rejected with status 403 before the
# body is touched — never executed.
csrf_code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST -H "Content-Type: application/x-www-form-urlencoded" -d 'login=attacker' "http://127.0.0.1:$PORT/api/follow")
csrf_body=$(curl -s -m 30 -X POST -H "Content-Type: application/x-www-form-urlencoded" -d 'login=attacker' "http://127.0.0.1:$PORT/api/follow")
if [ "$csrf_code" = "200" ] && printf '%s' "$csrf_body" | grep -q '"status":403'; then
  ok "CSRF guard (non-JSON write -> 403)"
else
  bad "CSRF guard (code=$csrf_code body=$csrf_body)"
fi

echo "-- payload shape --"
assert_contains "overview has repo count" "/api/overview?owner=$OWNER" '"count"'
assert_contains "people has totals"      "/api/people?owner=$OWNER" '"totals"'
assert_contains "discovery has app catalog" "/discovery" '"app"'

if [ "${SKIP_LIVE:-0}" != "1" ]; then
  echo "-- live proxy (real GitHub call) --"
  assert_code   "GET /api/live/github profile" 200 "/api/live/github?path=/users/$OWNER"
  assert_contains "live body is slim JSON"     "/api/live/github?path=/users/$OWNER" '"ok":true'
  echo "-- live cache (2nd hit must be served from cache) --"
  first=$(curl -s -m 30 "http://127.0.0.1:$PORT/api/live/github?path=/users/$OWNER")
  second=$(curl -s -m 30 "http://127.0.0.1:$PORT/api/live/github?path=/users/$OWNER")
  if printf '%s' "$second" | grep -q '"cached":true'; then ok "live cached on 2nd hit"; else bad "live NOT cached on 2nd hit"; fi
else
  echo "-- live proxy SKIPPED (SKIP_LIVE=1) --"
fi

echo
echo "== smoke result: $PASS passed, $FAIL failed =="
[ "$FAIL" = "0" ] || exit 1
