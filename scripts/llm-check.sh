#!/usr/bin/env bash
# llm-check.sh — diagnose the trending-description machine-translation (机翻).
#
# Two stages:
#   1) gateway: POST one minimal chat/completions to LLM_API_URL using the exact
#      key the app uses (LLM_ANALYZER_KEY, aliased from LLM_API_KEY by env.sh),
#      and print the HTTP status + body. A bad key surfaces here verbatim, e.g.
#      {"error":{"code":"invalid_key","message":"invalid key format; expected
#       prefix sk-tr-"}} — the app itself swallows it (best-effort translation
#      silently degrades to English), which is why "descriptions aren't
#      translated" is otherwise hard to pin down.
#   2) trending: if a server answers on :$PORT, GET /api/trending?tr=zh and
#      report the translation hit rate (items carrying a desc_zh).
#
# Exit status: 0 = the gateway accepted the key; 1 = rejected / unreachable /
# misconfigured. (Stage 2 is informational and never changes the exit status.)
#
# Usage:  PORT=18091 bash scripts/llm-check.sh   # probe the Docker container
#         make llm-check                          # gateway + :8091 dev server

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/env.sh"

URL="${LLM_API_URL:-}"
KEY="${LLM_ANALYZER_KEY:-}"
MODEL="${LLM_MODEL:-auto}"
PORT="${PORT:-8091}"

reqf="$(mktemp)"
bodyf="$(mktemp)"
errf="$(mktemp)"
trf="$(mktemp)"
trap 'rm -f "$reqf" "$bodyf" "$errf" "$trf"' EXIT

mask() {
  if [ -n "$1" ]; then printf '%s…(%d chars)' "${1:0:6}" "${#1}"; else printf '(empty)'; fi
}

echo "== llm-check: machine-translation pipeline =="
echo "   LLM_API_URL = ${URL:-<unset>}"
echo "   LLM_MODEL   = ${MODEL}"
echo "   key         = $(mask "$KEY")"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo
  echo "   FAIL: LLM_API_URL and/or the key are empty — translation is disabled."
  echo "         Set LLM_API_URL + LLM_API_KEY in .env (see the .env comments)."
  exit 1
fi

echo
echo "-> stage 1: gateway  POST $URL"
printf '%s' "{\"model\":\"${MODEL}\",\"stream\":false,\"temperature\":0,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}" > "$reqf"

code="$(curl -sS --max-time 30 -o "$bodyf" -w '%{http_code}' -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  --data @"$reqf" 2>"$errf")" || true
body="$(cat "$bodyf" 2>/dev/null)"
err="$(cat "$errf" 2>/dev/null)"

gw_ok=0
case "${code:-000}" in
  000|"")
    echo "   FAIL: could not reach the gateway."
    [ -n "$err" ] && echo "         $err"
    ;;
  2??)
    echo "   OK: gateway accepted the key (HTTP $code)."
    gw_ok=1
    ;;
  *)
    echo "   FAIL: gateway rejected the request (HTTP $code)."
    [ -n "$body" ] && echo "         ${body:0:400}"
    case "$body" in
      *sk-tr*) echo "         hint: this gateway wants keys with the 'sk-tr-' prefix." ;;
    esac
    ;;
esac

echo
echo "-> stage 2: trending  http://127.0.0.1:$PORT/api/trending?since=weekly&tr=zh"
if curl -sS --max-time 5 -o /dev/null "http://127.0.0.1:$PORT/api/owners" 2>/dev/null; then
  curl -sS --max-time 60 "http://127.0.0.1:$PORT/api/trending?since=weekly&tr=zh" -o "$trf" 2>/dev/null || true
  python3 - "$trf" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("   could not parse the trending response:", e)
    sys.exit(0)
if not d.get("ok"):
    print("   trending error:", d.get("err") or d)
    sys.exit(0)
items = d.get("items", [])
n = sum(1 for it in items if (it.get("desc_zh") or "").strip())
print("   items: %d   translated(desc_zh): %d" % (len(items), n))
print("   " + ("OK: descriptions are being translated." if n
               else "WARN: no desc_zh came back — translation is not effective."))
PY
else
  echo "   (no server answering on :$PORT — skipped; start one, or pass PORT=18091)"
fi

exit $(( gw_ok ? 0 : 1 ))
