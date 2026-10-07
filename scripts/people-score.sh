#!/usr/bin/env bash
# people-score.sh — rank an owner's followers AND following by technical
# influence (the "talent radar": the positive counterpart to the water-account
# pre-screen). Per-user profile fields are scored into data/github/<owner>/
# scores.json, which the server merges into /api/people so the dashboard can
# sort by influence and badge high-scorers.
#
# Cost: one GitHub API call per person (followers + following). Anonymous is
# limited to ~60 req/h — set GH_TOKEN for a real run (5000 req/h).
#
# Usage:
#   bash scripts/people-score.sh                 # default owner, both lists
#   OWNER=alice bash scripts/people-score.sh
#   KIND=followers bash scripts/people-score.sh  # one list only
#   LIMIT=50 bash scripts/people-score.sh        # first 50 only (dry sizing)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# load .env (OWNER / GH_TOKEN) — already-set env vars win, then last_owner
. "$ROOT/scripts/env.sh"

OWNER="${OWNER:-}"
if [ -z "$OWNER" ]; then
  echo "people-score: no owner. Set OWNER (e.g. OWNER=alice) or add OWNER= to .env" >&2
  exit 1
fi
KIND="${KIND:-all}"   # all | followers | following
LIMIT="${LIMIT:-0}"
TOK="${GH_TOKEN:-}"
GAP="${GAP:-0.15}"    # seconds between requests (token runs can be snappier)

PEOPLE="$ROOT/data/github/$OWNER/people.json"
[ -f "$PEOPLE" ] || { echo "people-score: $PEOPLE missing — run OWNER=$OWNER make fetch first" >&2; exit 1; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# 1) pull login lists out of people.json
python3 - "$PEOPLE" "$KIND" > "$TMPDIR/logins.txt" << 'EOF'
import json, sys
people = json.load(open(sys.argv[1]))
kind = sys.argv[2]
lists = []
if kind in ("all", "followers"):
    lists += [u.get("login") for u in people.get("followers", []) if u.get("login")]
if kind in ("all", "following"):
    lists += [u.get("login") for u in people.get("following", []) if u.get("login")]
print("\n".join(lists))
EOF
[ -s "$TMPDIR/logins.txt" ] || { echo "people-score: no entries for $OWNER" >&2; exit 1; }
TOTAL="$(wc -l < "$TMPDIR/logins.txt" | tr -d ' ')"
[ "$LIMIT" -gt 0 ] && [ "$LIMIT" -lt "$TOTAL" ] && TOTAL="$LIMIT"

echo "people-score: scoring up to $TOTAL people of @$OWNER (token: $([ -n "$TOK" ] && echo yes || echo no))" >&2

# 2) per-user profile fetch + scoring (the only thing that costs API requests)
AUTH=()
[ -n "$TOK" ] && AUTH=(-H "Authorization: Bearer $TOK")
N=0
: > "$TMPDIR/scores.ndjson"
while IFS= read -r u && { [ "$LIMIT" -eq 0 ] || [ "$N" -lt "$LIMIT" ]; }; do
  [ -z "$u" ] && continue
  N=$((N + 1))
  BODY="$(curl -sS -m 20 "${AUTH[@]+"${AUTH[@]}"}" \
    -H "Accept: application/vnd.github+json" -H "User-Agent: lume-talentlens" \
    "https://api.github.com/users/$u" || true)"
  # derive the same fields the dashboard uses
  python3 - "$u" "$BODY" >> "$TMPDIR/scores.ndjson" << 'EOF'
import json, sys, time
login, body = sys.argv[1], sys.argv[2]
try:
    d = json.loads(body)
except Exception:
    d = {}
if not d or "login" not in d:
    # failed / rate-limited / deleted — keep the login so the merge still
    # shows it (score 0), rather than silently dropping the person
    print(json.dumps({"login": login, "score": 0, "repos": 0, "followers": 0,
                      "age_years": 0, "hireable": False, "bio": ""}))
    sys.exit(0)
repos = int(d.get("public_repos", 0) or 0)
followers = int(d.get("followers", 0) or 0)
hireable = bool(d.get("hireable"))
bio = (d.get("bio") or "").strip()
created = d.get("created_at") or ""
age_years = 0
if created:
    try:
        age_years = max(0, int(time.strftime("%Y")) - int(created[:4]))
    except Exception:
        age_years = 0
# influence score: repos (breadth) + followers (reach) + age (seniority) +
# hireable + bio presence — each capped so no single factor dominates
score = min(50, repos * 2) + min(50, int(followers / 20)) + min(30, age_years * 3) \
      + (5 if hireable else 0) + (3 if bio else 0)
print(json.dumps({"login": login, "score": score, "repos": repos,
                  "followers": followers, "age_years": age_years,
                  "hireable": hireable, "bio": bio[:80]}))
EOF
  sleep "$GAP"
done < "$TMPDIR/logins.txt"

# 3) merge into scores.json (login -> entry), keep both lists' people visible
python3 - "$ROOT/data/github/$OWNER" "$TMPDIR/scores.ndjson" << 'EOF'
import json, os, sys
owner_dir, ndjson = sys.argv[1], sys.argv[2]
merged = {}
for line in open(ndjson):
    line = line.strip()
    if not line:
        continue
    e = json.loads(line)
    merged[e["login"]] = e
out = os.path.join(owner_dir, "scores.json")
json.dump(merged, open(out, "w"), ensure_ascii=False, indent=1)
print("people-score: %d people scored -> %s" % (len(merged), out))
EOF
