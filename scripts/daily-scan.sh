#!/usr/bin/env bash
# daily-scan.sh — 每日自动雷达 + 变更提醒 (TODO #5).
#
# Runs the offline pipeline once (snapshot + people + suspects + scores +
# radar) and writes a readable day-over-day change summary to
# logs/daily/<date>.md: new followers / unfollowers, new mutual high scorers
# ("新增高手"), and unfollowed water accounts ("取关水号"). Safe to hook to
# launchd / cron — by default it never pushes notifications (publication
# requires an explicit instruction). Set NOTIFY=1 to push the day's summary to
# the configured webhook (scripts/notify.py; DingTalk/企微/Server酱 via
# TREND_WEBHOOK_URL).
#
# Failure safety: every overwriting step first snapshots the current file to
# a *.prev.json copy, and the summary is ALWAYS written — a failed step is
# noted in the summary (with a non-zero exit) instead of aborting and losing
# the day's data.
#
# Usage:
#   bash scripts/daily-scan.sh            # default owner (from .env / last_owner)
#   OWNER=acme bash scripts/daily-scan.sh
#   RADAR=0   bash scripts/daily-scan.sh  # skip score+radar (rate limit /
#                                         #  no token): snapshot + people diff only
#   DRY_RUN=1 bash scripts/daily-scan.sh  # compose the summary from existing
#                                         #  data — no network, no re-fetch
#   NOTIFY=1  bash scripts/daily-scan.sh  # also push the summary to the webhook

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/env.sh"

OWNER="${OWNER:-}"
if [ -z "$OWNER" ]; then
  echo "daily-scan: no owner. Set OWNER (e.g. OWNER=acme) or add OWNER= to .env" >&2
  exit 1
fi
case "$OWNER" in
  *[!a-zA-Z0-9_-]*) echo "daily-scan: owner '$OWNER' contains unsafe characters" >&2; exit 1 ;;
esac

DIR="$ROOT/data/github/$OWNER"
LOG="$ROOT/logs/daily"
[ -d "$DIR" ] || { echo "daily-scan: $DIR missing — run OWNER=$OWNER make fetch once first" >&2; exit 1; }
mkdir -p "$LOG"
DATE="$(date +%Y-%m-%d)"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$LOG/$DATE.md"

FAILED="$(mktemp)"
trap 'rm -f "$FAILED"' EXIT
fail_step() { echo "$1" >> "$FAILED"; }

echo "daily-scan: @$OWNER · $TS"

# --- backups: old data preserved for diffing + failure safety -------------
# (people.prev.json is the SAME archive /api/refresh writes and /api/people_diff
#  reads, so a daily run also updates the refresh diff base; suspects/scores/
#  radar keep their own .prev so a later failure never loses yesterday's
#  comparison base. DRY_RUN is read-only — never touch the .prev baselines it
#  relies on.)
if [ "${DRY_RUN:-0}" != "1" ]; then
  for f in people suspects scores radar; do
    case "$f" in
      people) p="people.prev.json" ;;
      *)      p="$f.json.prev" ;;
    esac
    [ -f "$DIR/$f.json" ] && cp -p "$DIR/$f.json" "$DIR/$p" 2>/dev/null || true
  done
fi

# --- pipeline (each step keeps running on failure, recorded in the summary) -
run() {
  local name="$1"; shift
  echo "daily-scan:   [$name] $*"
  if ! "$@"; then
    echo "daily-scan:   [$name] FAILED" >&2
    fail_step "$name"
  fi
}

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "daily-scan:   DRY_RUN=1 — composing summary from existing data (no fetch)"
else
  run fetch     bash "$ROOT/scripts/fetch-github.sh" || true
  run suspects  python3 "$ROOT/scripts/people-suspects.py" || true
  if [ "${RADAR:-1}" != "0" ]; then
    if [ -z "${GH_TOKEN:-}" ]; then
      echo "daily-scan:   warning: no GH_TOKEN — score/radar are rate-limited to ~60 req/h and may come back empty; use RADAR=0 make daily to skip them" >&2
    fi
    run score   bash "$ROOT/scripts/people-score.sh" || true
    run radar   bash "$ROOT/scripts/radar-scan.sh" || true
  fi
fi

# --- compose the markdown summary (pure read; robust to missing files) -----
python3 - "$DIR" "$OUT" "$DATE" "$FAILED" << 'PY'
import json, os, sys
owner_dir, out, today, failed = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

def jload(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default

def jlines(path):
    rows = []
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows

# --- baseline = last calendar-day record strictly before today -------------
hist = sorted([h for h in jlines(os.path.join(owner_dir, "people_history.jsonl"))
               if isinstance(h, dict) and h.get("date")], key=lambda h: h["date"])
baseline = None
for h in hist:
    if h["date"] < today:
        baseline = h

people = jload(os.path.join(owner_dir, "people.json"), {})
cur_followers = {u.get("login") for u in people.get("followers", []) if u.get("login")}
cur_following = {u.get("login") for u in people.get("following", []) if u.get("login")}
snap = jload(os.path.join(owner_dir, "snapshot.json"), {})
n_repos = snap.get("non_fork_count", snap.get("count", 0))
totals = people.get("totals", {}) or {}
n_followers = totals.get("followers") or len(cur_followers)
n_following = totals.get("following") or len(cur_following)

radar_now = jload(os.path.join(owner_dir, "radar.json"), {"people": []})
radar_prev = jload(os.path.join(owner_dir, "radar.json.prev"), {"people": []})
now_people = radar_now.get("people", []) if isinstance(radar_now, dict) else radar_now
prev_radar_logins = {p.get("login") for p in radar_prev.get("people", []) if isinstance(p, dict)}
new_radar = [p for p in now_people if isinstance(p, dict) and p.get("login") and p["login"] not in prev_radar_logins]
new_radar.sort(key=lambda p: -int(p.get("score", 0) or 0))

def sus_index(s):
    items = s.get("suspects", []) if isinstance(s, dict) else s
    return {x.get("login"): x.get("level", "high") for x in items if isinstance(x, dict) and x.get("login")}
sus_now = jload(os.path.join(owner_dir, "suspects.json"), {})
sus_prev = jload(os.path.join(owner_dir, "suspects.json.prev"), {})
idx_now = sus_index(sus_now)
idx_prev = sus_index(sus_prev)
new_sus = sorted([l for l in idx_now if l not in idx_prev])
sus_counts = sus_now.get("counts", {}) if isinstance(sus_now, dict) else {}

# --- diff vs baseline -------------------------------------------------------
L = []
if baseline:
    prev_followers = set(baseline.get("followers", []))
    prev_following = set(baseline.get("following", []))
    new_followers = sorted(cur_followers - prev_followers)
    gone_followers = sorted(prev_followers - cur_followers)
    new_following = sorted(cur_following - prev_following)
    unfollowed = sorted(prev_following - cur_following)
    base_date = baseline.get("date", "?")
    unfollowed_sus = sorted([u for u in unfollowed if u in idx_prev or u in idx_now])
else:
    base_date = None

def cap(xs, n=25):
    xs = list(xs)
    if len(xs) > n:
        return xs[:n] + ["…共%d 个" % len(xs)]
    return xs

def bullet(xs):
    return "、" .join("`%s`" % x for x in xs) if xs else "无"

def total_line(d, key):
    c = d.get("counts", {}) if isinstance(d, dict) else {}
    t = c.get(key)
    return ("（counts:%d）" % t) if t is not None else ""

L.append("# 每日雷达摘要 · %s" % today)
L.append("")
L.append("- owner: `%s`" % os.path.basename(owner_dir))
L.append("- 生成: %s" % today)
L.append("- 快照: %d repos（非 fork）· followers %s · following %s" % (n_repos, n_followers, n_following))
if baseline:
    L.append("- 基线: %s（people_history）" % base_date)
else:
    L.append("- 基线: 无（首次运行，尚无历史对照）")
L.append("")

L.append("## 关注变化")
if not baseline:
    L.append("首次运行，无历史基线——关注差异从明天起生效。")
else:
    L.append("- 新增关注 +%d：%s" % (len(new_following), bullet(cap(new_following))))
    L.append("- 取消关注 −%d：%s" % (len(unfollowed), bullet(cap(unfollowed))))
    L.append("- 新粉丝 +%d：%s" % (len(new_followers), bullet(cap(new_followers))))
    L.append("- 掉粉 −%d：%s" % (len(gone_followers), bullet(cap(gone_followers))))
L.append("")

L.append("## 新增高手（radar 池，score ≥ %d）" % int((radar_now.get("min_score", 60) if isinstance(radar_now, dict) else 60) or 60))
if new_radar:
    for p in new_radar[:10]:
        L.append("- `%s` · %s · score %s · %s" % (p.get("login"), p.get("mode", "?"), p.get("score"), (p.get("note") or "")))
    if len(new_radar) > 10:
        L.append("- …共 %d 人（见 data/github/%s/radar.json）" % (len(new_radar), os.path.basename(owner_dir)))
else:
    L.append("无")
L.append("")

L.append("## 取关水号")
if baseline and unfollowed_sus:
    for u in unfollowed_sus[:15]:
        lv = idx_prev.get(u) or idx_now.get(u) or "?"
        L.append("- `%s`（%s）— 已取关" % (u, lv))
else:
    L.append("无")
L.append("")

L.append("## 水号筛查")
L.append("- 今日 high：%d · medium：%d" % (sus_counts.get("high", 0), sus_counts.get("medium", 0)))
if new_sus:
    L.append("- 新发现 +%d：%s" % (len(new_sus), bullet(cap(new_sus))))
else:
    L.append("- 新发现：无")
L.append("")

failed_steps = [l.strip() for l in open(failed) if l.strip()]
if failed_steps:
    L.append("## 失败步骤（本轮未完成，旧数据未破坏）")
    for s in failed_steps:
        L.append("- `%s`" % s)
    L.append("")

open(out, "w").write("\n".join(L) + "\n")
PY

echo "daily-scan: summary -> $OUT"

# Optional webhook push — opt-in (NOTIFY=1). The pipeline is offline and never
# publishes on its own; this is the only outbound call and only when asked. The
# markdown summary is flattened to plain text so it reads cleanly as a text msg.
# Push-status trail: append one line per NOTIFY attempt so the push history is
# auditable in the log dir even when the terminal output is gone. Format:
#   <ISO ts> owner=<owner> status=<ok|fail> rc=<0|1>
push_rc=0
if [ "${NOTIFY:-0}" = "1" ]; then
  if python3 "$ROOT/scripts/notify.py" --markdown < "$OUT"; then
    echo "daily-scan: summary pushed to webhook"
    status="ok"
  else
    echo "daily-scan: webhook push failed (summary kept at $OUT)" >&2
    push_rc=1
    status="fail"
  fi
  PSTATUS="$LOG/last-push-status.log"
  printf '%s owner=%s status=%s rc=%d\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OWNER" "$status" "$push_rc" >> "$PSTATUS"
fi

if [ -s "$FAILED" ]; then
  echo "daily-scan: FAILED steps: $(tr '\n' ' ' < "$FAILED")" >&2
  exit 1
fi
exit "$push_rc"
