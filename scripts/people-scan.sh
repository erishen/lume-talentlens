#!/usr/bin/env bash
# people-scan.sh — find high-signal developers in an owner's follower graph.
#
# The /api/people endpoint only stores the follower/following lists (login,
# name, avatar, url) — enough to list people, not to judge them. This script
# walks each entry and pulls the public profile fields that actually carry
# signal (followers_count, public_repos, account age, hireable, bio), then
# ranks the owner's followers and flags "expert suspects".
#
# Usage:
#   OWNER=alice bash scripts/people-scan.sh             # scan all followers
#   OWNER=alice bash scripts/people-scan.sh --limit 10  # first 10 only
#   GH_TOKEN=ghp_... OWNER=alice bash scripts/people-scan.sh
#   OWNER=alice bash scripts/people-scan.sh --kind following
#
# Output: ranked list to stdout (one line per user), plus a summary line.
# Rate-limit aware: without GH_TOKEN the 60 req/h unauth limit is hit fast
# on large graphs — use --limit or a token.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# load .env (OWNER / GH_TOKEN) — already-set env vars win, then last_owner
# fallback; never via make (see scripts/env.sh)
. "$ROOT/scripts/env.sh"

OWNER="${OWNER:-}"
if [ -z "$OWNER" ]; then
  echo "people-scan: no owner. Set OWNER (e.g. OWNER=alice) or add OWNER= to .env" >&2
  exit 1
fi
LIMIT="${LIMIT:-0}"
KIND="${KIND:-followers}"   # followers | following
TOK="${GH_TOKEN:-}"
GAP="${GAP:-0.3}"           # seconds between requests (rate-limit politeness)

# parse --limit N / --kind X
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --kind)  KIND="$2"; shift 2 ;;
    *) echo "people-scan: unknown arg $1" >&2; exit 1 ;;
  esac
done

PEOPLE="$ROOT/data/github/$OWNER/people.json"
[ -f "$PEOPLE" ] || { echo "people-scan: $PEOPLE missing — run OWNER=$OWNER make fetch first" >&2; exit 1; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# 1) pull the login list out of people.json
python3 - "$PEOPLE" "$KIND" > "$TMPDIR/logins.txt" << 'EOF'
import json, sys
people = json.load(open(sys.argv[1]))
users = [u.get("login") for u in people.get(sys.argv[2], []) if u.get("login")]
print("\n".join(users))
EOF
[ -s "$TMPDIR/logins.txt" ] || { echo "people-scan: no $KIND entries for $OWNER" >&2; exit 1; }
TOTAL="$(wc -l < "$TMPDIR/logins.txt" | tr -d ' ')"
[ "$LIMIT" -gt 0 ] && [ "$LIMIT" -lt "$TOTAL" ] && TOTAL="$LIMIT"

echo "people-scan: scanning up to $TOTAL $KIND of @$OWNER (token: $([ -n "$TOK" ] && echo yes || echo no))" >&2

# 2) per-user profile fetch (the only thing that costs API requests)
#    ${AUTH[@]+...}: safe empty-array expansion under `set -u` (macOS bash 3.2)
AUTH=()
[ -n "$TOK" ] && AUTH=(-H "Authorization: Bearer $TOK")
N=0
while IFS= read -r u && { [ "$LIMIT" -eq 0 ] || [ "$N" -lt "$LIMIT" ]; }; do
  [ -z "$u" ] && continue
  N=$((N + 1))
  out="$TMPDIR/u_$N.json"
  if ! curl -s --max-time 10 ${AUTH[@]+"${AUTH[@]}"} "https://api.github.com/users/$u" -o "$out"; then
    echo "  ! $u: fetch failed" >&2
    continue
  fi
  # stop early on rate limiting
  if grep -q 'rate limit exceeded' "$out" 2>/dev/null; then
    echo "  ! rate limit hit after $N users — rerun later or set GH_TOKEN" >&2
    break
  fi
  sleep "$GAP"
done < "$TMPDIR/logins.txt"
SCANNED="$N"

# 3) rank + flag expert suspects
python3 - "$TMPDIR" "$KIND" << 'EOF'
import json, re, sys, os, glob
d = sys.argv[1]
rows = []
for f in sorted(glob.glob(os.path.join(d, "u_*.json"))):
    try:
        u = json.load(open(f))
    except Exception:
        continue
    if "login" not in u:
        continue
    fol, repo = u.get("followers", 0), u.get("public_repos", 0)
    created = (u.get("created_at") or "")[:7]
    bio = u.get("bio") or ""
    company = u.get("company") or ""
    # hiring-side account: bio/company carries recruiter vocabulary — these
    # bulk-follow developers as a sourcing action, not spam
    rec = bool(re.search(
        r"(?i)(recruit|hiring|talent[-_ ]?(acq|acquisition|partner)?|headhunt|"
        r"\bhr\b|staffing|peopleops|human[-_ ]?capital|outsourc|career)",
        (bio + " " + company)[:200]))
    # expert suspect: big reach, or old + prolific, or old + hireable
    flag = "EXPERT?" if (fol >= 1000 or (repo >= 80 and created and created < "2021") or (fol >= 300 and repo >= 20)) else ""
    recflag = "RECRUITER?" if rec else ""
    rows.append((fol, repo, created, u.get("login"), flag, recflag, bio[:60]))
rows.sort(reverse=True)
print(f"\n{len(rows)} users scanned, ranked by followers:")
for fol, repo, created, login, flag, recflag, bio in rows:
    print(f"  @{login:24s} fol={fol:6d} repos={repo:4d} since={created} {flag:8s} {recflag:10s} {bio}")
print("\n(EXPERT? = followers>=1000, or old+prolific, or 300+ followers w/ 20+ repos;")
print(" RECRUITER? = bio/company carries hiring vocabulary)")
EOF
echo "people-scan: done ($SCANNED scanned)" >&2
