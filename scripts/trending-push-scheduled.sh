#!/usr/bin/env bash
# trending-push-scheduled.sh — launchd entrypoint for the daily GitHub-trending
# push (installed by scripts/schedule.sh / `make schedule-install`).
#
# launchd starts jobs with a bare environment, so this wrapper:
#   1) pins a sane PATH (python3 / curl / git live in Homebrew or /usr/bin),
#   2) cd's to the repo root (launchd's WorkingDirectory is a hint, not a given),
#   3) loads .env via scripts/env.sh — same loader as make and every script, so
#      TREND_WEBHOOK_URL / GH_TOKEN / the proxy bridge all apply,
#   4) runs the exact push `make trending-push` runs.
#
# The dev server may be down at push time: trending-push.py then tries the
# running server's /api/trending first and FALLS BACK to the GitHub Search API
# directly (descriptions stay English — no Chinese machine-translation).
#
# Output goes to stdout/stderr; the launchd plist captures it to
# logs/trending-push/scheduled.log. Run it by hand to test:
#   bash scripts/trending-push-scheduled.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# launchd's PATH omits Homebrew; prepend the usual install dirs.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# .env + credential aliases + proxy bridging (identical to make / daily-scan.sh).
. "$ROOT/scripts/env.sh"

echo "=== trending-push scheduled @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
set -- --since daily --top 10
[ -n "${DRY_RUN:-}" ] && set -- "$@" --dry-run
python3 "$ROOT/scripts/trending-push.py" "$@"
rc=$?
echo "=== exit $rc @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
exit $rc
