#!/usr/bin/env bash
# classify.sh — "归类总览" CLI: curl /api/classify for a running server.
#
# Usage:
#   bash scripts/classify.sh            # quarterly for default owner
#   OWNER=erishen bash scripts/classify.sh
#   SINCE=monthly bash scripts/classify.sh
#   PORT=8091 OWNER=foo SINCE=3m bash scripts/classify.sh
# (SINCE accepts: daily/weekly/monthly/quarterly/year; 3m is short for quarterly)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/env.sh"

OWNER="${OWNER:-}"
if [ -z "$OWNER" ]; then
  OWNER="$(sh -c "cd '$ROOT' && . ./scripts/env.sh 2>/dev/null; echo \"\$OWNER\"")"
fi
OWNER="${OWNER:-}"

SINCE="${SINCE:-quarterly}"
case "$SINCE" in
  3m|3M) SINCE="quarterly" ;;
  1y|1Y) SINCE="year" ;;
esac

PORT="${PORT:-8091}"
HOST="127.0.0.1"
URL="http://$HOST:$PORT/api/classify?owner=${OWNER}&since=${SINCE}"

if [ -z "$OWNER" ]; then
  echo "classify: no owner (set OWNER or .env)" >&2
  exit 1
fi

echo "classify: GET $URL"
res="$(curl -s -m 30 "$URL")"
# print a compact summary via python
python3 -c "
import sys, json
d = json.loads('''$res''')
if not d.get('ok'):
    print('FAIL:', d.get('err'), d.get('status'))
    sys.exit(1)
print(f\"owner={d.get('owner')} since={d.get('since')} days={d.get('days')} count={d.get('count')} total={d.get('total')} truncated={d.get('truncated')} cached={d.get('cached')}\")
print('--- languages (top) ---')
for l in d.get('languages', [])[:10]:
    print(f\"  {l['name']}: {l['count']}\")
print('--- topics (top) ---')
for t in d.get('topics', [])[:15]:
    print(f\"  {t['name']}: {t['count']}\")
"
