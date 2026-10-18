#!/usr/bin/env bash
# schedule.sh — install / uninstall / inspect a macOS launchd agent that pushes
# the GitHub trending board to your group webhook once a day.
#
# This is the scheduled counterpart of `make trending-push`: same script, same
# .env, just triggered by launchd instead of your shell. Pushing is the one
# place data leaves the machine, so the agent is opt-in and one-per-day.
#
# The agent fires at HOUR:MIN local time. If the Mac is asleep at that moment,
# launchd runs the missed job once when it next wakes (StartCalendarInterval
# semantics) — that is why the plist does NOT set RunAtLoad.
#
# Usage:
#   bash scripts/schedule.sh install      # default 09:00 (HOUR=9 MIN=0)
#   HOUR=8 MIN=30 bash scripts/schedule.sh install
#   bash scripts/schedule.sh status
#   bash scripts/schedule.sh uninstall
#   bash scripts/schedule.sh print        # render the plist to stdout only
#
# Prefer the Makefile wrappers: make schedule-install / -status / -uninstall.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CMD="${1:-}"
[ $# -gt 0 ] && shift || true

LABEL="${LABEL:-com.lume-talentlens.trending-push}"
HOUR="${HOUR:-9}"
MIN="${MIN:-0}"
TEMPLATE="$ROOT/scripts/launchd/com.lume-talentlens.trending-push.plist.in"
WRAPPER="$ROOT/scripts/trending-push-scheduled.sh"
DEST_DIR="$HOME/Library/LaunchAgents"
DEST="$DEST_DIR/$LABEL.plist"
LOG="$ROOT/logs/trending-push/scheduled.log"
PATH_VAL="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DOMAIN="gui/$(id -u)"

die() { echo "schedule: $*" >&2; exit 1; }

need_darwin() {
  [ "$(uname -s)" = "Darwin" ] || die "launchd is macOS-only (uname=$(uname -s)); use cron on Linux — see README 'Push to a group robot'"
}

# escape a value for use as a sed replacement (delimiter is |)
esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }

render() {
  [ -f "$TEMPLATE" ] || die "template not found: $TEMPLATE"
  bake_int() { case "$1" in ''|*[!0-9]*) die "HOUR/MIN must be integers (got HOUR='$HOUR' MIN='$MIN')" ;; esac; }
  bake_int "$HOUR"; bake_int "$MIN"
  sed \
    -e "s|@@LABEL@@|$(esc "$LABEL")|g" \
    -e "s|@@WRAPPER@@|$(esc "$WRAPPER")|g" \
    -e "s|@@REPO_ROOT@@|$(esc "$ROOT")|g" \
    -e "s|@@HOUR@@|$(esc "$HOUR")|g" \
    -e "s|@@MIN@@|$(esc "$MIN")|g" \
    -e "s|@@PATH@@|$(esc "$PATH_VAL")|g" \
    -e "s|@@LOG@@|$(esc "$LOG")|g" \
    "$TEMPLATE"
}

bootout() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null && return 0
  [ -f "$DEST" ] && { launchctl unload -w "$DEST" 2>/dev/null || true; }
  return 0
}

cmd_install() {
  need_darwin
  mkdir -p "$DEST_DIR" "$(dirname "$LOG")"
  chmod +x "$WRAPPER"
  render > "$DEST"
  plutil -lint "$DEST" >/dev/null || die "generated plist failed plutil lint"
  bootout
  if launchctl bootstrap "$DOMAIN" "$DEST" 2>/dev/null; then
    :
  else
    launchctl load -w "$DEST" || die "launchctl load failed for $DEST"
  fi
  echo "schedule: installed $LABEL -> $DEST"
  printf 'schedule: runs daily at %02d:%02d (local); wake-missed slot runs once on next wake\n' "$HOUR" "$MIN"
  echo "schedule: log -> $LOG"
  echo "schedule: push now (test)  -> launchctl kickstart -k $DOMAIN/$LABEL"
  echo "schedule: needs TREND_WEBHOOK_URL in .env (see README 'Push to a group robot')"
}

cmd_uninstall() {
  need_darwin
  bootout
  rm -f "$DEST"
  echo "schedule: removed $LABEL ($DEST)"
}

cmd_status() {
  need_darwin
  echo "schedule: label   $LABEL"
  echo "schedule: plist   $DEST $([ -f "$DEST" ] && echo '(present)' || echo '(missing)')"
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    echo "schedule: loaded  yes"
    launchctl list | grep -F "$LABEL" | sed 's/^/schedule:         /' || true
  else
    echo "schedule: loaded  no"
  fi
  [ -f "$LOG" ] && { echo "schedule: last log lines:"; tail -n 12 "$LOG" | sed 's/^/schedule:   /'; } \
                 || echo "schedule: no log yet ($LOG)"
}

case "$CMD" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  print)     render ;;
  ""|-h|--help|help)
    sed -n '2,26p' "$ROOT/scripts/schedule.sh" | sed 's/^# \{0,1\}//'
    ;;
  *) die "unknown command '$CMD' (install|uninstall|status|print)" ;;
esac
