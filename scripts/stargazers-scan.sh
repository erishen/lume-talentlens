#!/usr/bin/env bash
# stargazers-scan.sh — who starred this owner's repos?
#
# Aggregates the stargazers of every non-fork, non-archived repo in the local
# snapshot, dedupes them, and scores each with the same profile-influence
# formula as people-score.sh (repos/followers demoted, followers-vs-following
# ratio calibrated, water-account penalty applied from suspects.json). High
# scorers (>= RADAR_SCORE, default 60) are the people who liked your work AND
# are technically worth following — the "fan but also expert" signal.
#
# Cost: one API call per repo (stargazers, per_page=100) + one per person
# (profile). Set GH_TOKEN for a real run (5000 req/h).
#
# Usage:
#   bash scripts/stargazers-scan.sh          # default owner
#   OWNER=alice bash scripts/stargazers-scan.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# load .env (OWNER / GH_TOKEN) — already-set env vars win, then last_owner
. "$ROOT/scripts/env.sh"

OWNER="${OWNER:-}"
if [ -z "$OWNER" ]; then
  echo "stargazers-scan: no owner. Set OWNER or add OWNER= to .env" >&2
  exit 1
fi
TOK="${GH_TOKEN:-}"
GAP="${GAP:-0.1}"     # seconds between requests
RADAR_SCORE="${RADAR_SCORE:-60}"

SNAP="$ROOT/data/github/$OWNER/snapshot.json"
[ -f "$SNAP" ] || { echo "stargazers-scan: $SNAP missing — run OWNER=$OWNER make fetch first" >&2; exit 1; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

AUTH=()
[ -n "$TOK" ] && AUTH=(-H "Authorization: Bearer $TOK")

# 1) the owner's own repos (non-fork, non-archived — same as active_repos).
#    Skip zero-star repos: they can have no stargazers, so no API call needed.
python3 - "$SNAP" > "$TMPDIR/repos.txt" << 'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
for r in d.get("repos", []):
    if r.get("fork") or r.get("archived"):
        continue
    n = r.get("name")
    if n and int(r.get("stargazers_count", 0) or 0) > 0:
        print(n)
EOF
NREPOS="$(wc -l < "$TMPDIR/repos.txt" | tr -d ' ')"
[ "$NREPOS" -gt 0 ] || { echo "stargazers-scan: no active repos for @$OWNER" >&2; exit 1; }

# 2) stargazers of each repo -> login -> repo-count (aggregate)
: > "$TMPDIR/star.ndjson"
while IFS= read -r repo; do
  [ -z "$repo" ] && continue
  BODY="$(curl -sS --noproxy '*' --retry 3 --retry-delay 2 -m 40 "${AUTH[@]+"${AUTH[@]}"}" \
    -H "Accept: application/vnd.github+json" -H "User-Agent: lume-talentlens" \
    "https://api.github.com/repos/$OWNER/$repo/stargazers?per_page=100" || true)"
  python3 - "$repo" "$BODY" >> "$TMPDIR/star.ndjson" << 'EOF'
import json, sys
repo, body = sys.argv[1], sys.argv[2]
try:
    d = json.loads(body)
except Exception:
    d = []
if isinstance(d, list):
    for u in d:
        login = u.get("login")
        if login:
            print(json.dumps({"repo": repo, "login": login}))
EOF
  sleep "$GAP"
done < "$TMPDIR/repos.txt"

python3 - "$TMPDIR/star.ndjson" > "$TMPDIR/logins.txt" << 'EOF'
import json, sys
from collections import Counter
c = Counter()
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    e = json.loads(line)
    c[e["login"]] += 1
for login, n in c.most_common():
    print("%s\t%d" % (login, n))
EOF
TOTAL="$(wc -l < "$TMPDIR/logins.txt" | tr -d ' ')"
echo "stargazers-scan: $NREPOS repos -> $TOTAL unique stargazers of @$OWNER (token: $([ -n "$TOK" ] && echo yes || echo no))" >&2

# 3) per-user profile + the same influence score as people-score.sh
: > "$TMPDIR/scores.ndjson"
while IFS=$'\t' read -r u n; do
  [ -z "$u" ] && continue
  BODY="$(curl -sS --noproxy '*' --retry 3 --retry-delay 2 -m 40 "${AUTH[@]+"${AUTH[@]}"}" \
    -H "Accept: application/vnd.github+json" -H "User-Agent: lume-talentlens" \
    "https://api.github.com/users/$u" || true)"
  python3 - "$u" "$n" "$BODY" >> "$TMPDIR/scores.ndjson" << 'EOF'
import json, sys, time
login, starred_repos, body = sys.argv[1], int(sys.argv[2] or 0), sys.argv[3]
try:
    d = json.loads(body)
except Exception:
    d = {}
if not d or "login" not in d:
    print(json.dumps({"login": login, "score": 0, "repos": 0, "followers": 0,
                      "following": 0, "age_years": 0, "hireable": False,
                      "bio": "", "starred_repos": starred_repos}))
    sys.exit(0)
repos = int(d.get("public_repos", 0) or 0)
followers = int(d.get("followers", 0) or 0)
following = int(d.get("following", 0) or 0)
hireable = bool(d.get("hireable"))
bio = (d.get("bio") or "").strip()
created = d.get("created_at") or ""
age_years = 0
if created:
    try:
        age_years = max(0, int(time.strftime("%Y")) - int(created[:4]))
    except Exception:
        age_years = 0
score = min(40, repos // 2) + min(20, int(followers / 50)) \
      + min(15, int((followers / max(1, following)) * 5)) \
      + min(10, age_years) + (5 if hireable else 0) + (3 if bio else 0)
print(json.dumps({"login": login, "score": score, "repos": repos,
                  "followers": followers, "following": following,
                  "age_years": age_years, "hireable": hireable,
                  "bio": bio[:80], "starred_repos": starred_repos}))
EOF
  sleep "$GAP"
done < "$TMPDIR/logins.txt"

# 4) merge into stargazers.json + water-account penalty
python3 - "$ROOT/data/github/$OWNER" "$TMPDIR/scores.ndjson" "$RADAR_SCORE" "$OWNER" << 'EOF'
import json, os, sys
owner_dir, ndjson, radar, self_login = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
merged = {}
for line in open(ndjson):
    line = line.strip()
    if not line:
        continue
    e = json.loads(line)
    merged[e["login"]] = e
try:
    ss = json.load(open(os.path.join(owner_dir, "suspects.json")))
    items = ss.get("suspects", []) if isinstance(ss, dict) else ss
    for x in items:
        if not isinstance(x, dict) or not x.get("login"):
            continue
        pen = 20 if x.get("level", "high") == "high" else 10
        e = merged.get(x["login"])
        if e:
            e["score"] = max(0, int(e.get("score", 0) or 0) - pen)
            e["sus_penalty"] = pen
except Exception:
    pass
out = os.path.join(owner_dir, "stargazers.json")
json.dump(merged, open(out, "w"), ensure_ascii=False, indent=1)

rows = sorted(merged.values(), key=lambda e: -e.get("score", 0))
print("stargazers-scan: %d scored -> %s" % (len(rows), out))
print("=" * 78)
print("%-22s %5s %5s %5s %5s %5s %4s  %s" % (
    "login", "score", "repos", "fol", "folw", "age", "star", "flag"))
print("-" * 78)
for e in rows:
    s = e.get("score", 0)
    if e.get("login") == self_login:
        flag = "★ SELF (own star)"
    elif s >= radar:
        flag = "★ EXPERT"
    elif e.get("sus_penalty"):
        flag = "water"
    else:
        flag = ""
    print("%-22s %5d %5d %5d %5d %5d %4d  %s" % (
        e.get("login", "?"), s, e.get("repos", 0), e.get("followers", 0),
        e.get("following", 0), e.get("age_years", 0),
        e.get("starred_repos", 0), flag))
EOF
