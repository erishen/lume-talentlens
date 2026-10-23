#!/usr/bin/env bash
# daily-scan-scheduled.sh — launchd entrypoint for the daily talent-radar scan
# (installed by `scripts/schedule.sh install-daily` / `make daily-schedule-install`).
#
# This is the scheduled counterpart of `make daily`: same offline pipeline,
# same .env, just triggered by launchd instead of your shell. It writes the
# readable day-over-day summary to logs/daily/<date>.md (new/lost followers,
# new mutual high scorers, unfollowed water accounts) and updates the .prev
# baselines. Publication is OFF by default — set NOTIFY=1 (and NOTIFY_YES=1 for
# unattended runs) in .env to also push the day's summary to the configured
# webhook.
#
# launchd starts jobs with a bare environment, so this wrapper:
#   1) pins a sane PATH (python3 / git / curl live in Homebrew or /usr/bin),
#   2) cd's to the repo root,
#   3) loads .env via scripts/env.sh — same loader as make and every script,
#      so OWNER / GH_TOKEN / the proxy bridge all apply,
#   4) runs the exact pipeline `make daily` runs.
#
# Output goes to stdout/stderr; the launchd plist captures it to
# logs/daily/scheduled.log. Run it by hand to test:
#   bash scripts/daily-scan-scheduled.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# launchd's PATH omits Homebrew; prepend the usual install dirs.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# .env + credential aliases + proxy bridging (identical to make / trending-push).
. "$ROOT/scripts/env.sh"

echo "=== daily-scan scheduled @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
bash "$ROOT/scripts/daily-scan.sh"
rc=$?
echo "=== exit $rc @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
exit $rc
