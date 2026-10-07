#!/usr/bin/env bash
# radar-scan.sh — talent-radar profit-pattern scan. For the mutual-follow
# high scorers (score >= 120, followers who are also followed back) it
# fetches each profile + top starred repos and classifies a primary
# "money pattern" (startup / crypto / content / company / tools / hunting /
# other) into data/github/<owner>/radar.json, which /api/radar serves.
#
# One GitHub API call per profile + one per repo list (~2 × N people).
# With GH_TOKEN this is fine; the endpoint caches, so re-run only when you
# want fresh profiles (make radar).
#
# Usage:
#   bash scripts/radar-scan.sh            # default owner
#   OWNER=alice bash scripts/radar-scan.sh
#   MIN_SCORE=110 bash scripts/radar-scan.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/env.sh"

OWNER="${OWNER:-}"
if [ -z "$OWNER" ]; then
  echo "radar-scan: no owner. Set OWNER or add OWNER= to .env" >&2
  exit 1
fi
MIN_SCORE="${MIN_SCORE:-120}"
TOK="${GH_TOKEN:-}"
GAP="${GAP:-0.25}"

PEOPLE="$ROOT/data/github/$OWNER/people.json"
SCORES="$ROOT/data/github/$OWNER/scores.json"
[ -f "$PEOPLE" ] || { echo "radar-scan: $PEOPLE missing — run OWNER=$OWNER make fetch first" >&2; exit 1; }
[ -f "$SCORES" ] || { echo "radar-scan: $SCORES missing — run make score first" >&2; exit 1; }

# mutual high scorers: followers ∩ following, score >= MIN_SCORE
python3 - "$PEOPLE" "$SCORES" "$MIN_SCORE" > /tmp/radar-scan.logins.txt << 'EOF'
import json, sys
people = json.load(open(sys.argv[1]))
scores = json.load(open(sys.argv[2]))
min_score = int(sys.argv[3])
following = {u.get("login") for u in people.get("following", []) if u.get("login")}
out = []
for u in people.get("followers", []):
    login = u.get("login")
    if not login or login not in following:
        continue
    if int(scores.get(login, {}).get("score", 0)) >= min_score:
        out.append((login, int(scores.get(login, {}).get("score", 0))))
for login, sc in sorted(out, key=lambda kv: -kv[1]):
    print(login)
EOF
LOGINS=()
while IFS= read -r l; do [ -n "$l" ] && LOGINS+=("$l"); done < /tmp/radar-scan.logins.txt
rm -f /tmp/radar-scan.logins.txt
[ "${#LOGINS[@]}" -eq 0 ] && { echo "radar-scan: no mutual high scorers for @$OWNER (score >= $MIN_SCORE)" >&2; exit 0; }
echo "radar-scan: scanning ${#LOGINS[@]} mutual high scorers of @$OWNER (token: $([ -n "$TOK" ] && echo yes || echo no))" >&2

AUTH=()
[ -n "$TOK" ] && AUTH=(-H "Authorization: Bearer $TOK")
: > /tmp/radar-scan.raw.ndjson
for login in "${LOGINS[@]}"; do
  UP="$(curl -sS -m 20 "${AUTH[@]+"${AUTH[@]}"}" -H "Accept: application/vnd.github+json" -H "User-Agent: lume-talentlens" "https://api.github.com/users/$login" || true)"
  RE="$(curl -sS -m 20 "${AUTH[@]+"${AUTH[@]}"}" -H "Accept: application/vnd.github+json" -H "User-Agent: lume-talentlens" "https://api.github.com/users/$login/repos?sort=stars&per_page=3" || true)"
  python3 - "$login" "$UP" "$RE" >> /tmp/radar-scan.raw.ndjson << 'EOF'
import json, sys, re, time
login, up, re_ = sys.argv[1], sys.argv[2], sys.argv[3]
def J(s):
    try: return json.loads(s)
    except Exception: return {}
u = J(up); repos = J(re_)
if not u or "login" not in u:
    print(json.dumps({"login": login, "error": "fetch_failed", "mode": "other", "note": "profile fetch failed"})); sys.exit(0)
bio = (u.get("bio") or "").strip()[:200]
company = (u.get("company") or "").strip()[:80]
blog = (u.get("blog") or "").strip()[:80]
loc = (u.get("location") or "").strip()[:40]
hireable = bool(u.get("hireable"))
followers = int(u.get("followers", 0) or 0)
repos_top = []
if isinstance(repos, list):
    for r in repos[:3]:
        repos_top.append({"name": (r.get("name") or ""), "stars": int(r.get("stargazers_count", 0) or 0),
                          "desc": ((r.get("description") or "") or "")[:120]})
text = " ".join([bio, company, blog] + [r["name"] + " " + r["desc"] for r in repos_top]).lower()

def has(*pats):
    return any(re.search(p, text) for p in pats)

# classify by strength of evidence, highest first
if re.search(r"founder|ceo|co-founder", bio[:80].lower()):
    mode = "startup"; note = "创业/创始人信号：" + (bio[:90] if bio else company[:40])
elif has(r"crypto", r"blockchain", r"binance", r"glassnode", r"ethereum", r"erc-", r"smart contract", r"defi", r"on/off-chain"):
    mode = "crypto"; note = "加密/链上信号：" + (bio[:70] if bio else "top repo: " + (repos_top[0]["name"] if repos_top else ""))
elif company and company.lower() not in ("none", "null", "self", "@self", "freelance", "nda", "@myw3schools.com") and not re.search(r"nda", company.lower()):
    mode = "company"; note = "公司任职：" + company
elif has(r"book", r"awesome", r"study material", r"lecture", r"999-", r"resources") and followers >= 400:
    mode = "content"; note = "内容/资源聚合：" + (repos_top[0]["name"] + " " + str(repos_top[0]["stars"]) + "★" if repos_top else bio[:50])
elif has(r"game", r"bot", r"automation", r"tool"):
    mode = "tools"; note = "工具/游戏/趣味：" + (repos_top[0]["name"] if repos_top else bio[:50])
elif hireable:
    mode = "hunting"; note = "开放求职/接活（hireable）"
else:
    mode = "other"; note = "未归类" + ("：" + bio[:60] if bio else "")

print(json.dumps({"login": login, "mode": mode, "note": note[:140],
                  "score": 0, "followers": followers, "hireable": hireable,
                  "loc": loc, "blog": blog, "company": company, "top_repos": repos_top[:2]}))
EOF
  sleep "$GAP"
done

# merge with scores + write radar.json
python3 - "$ROOT/data/github/$OWNER" /tmp/radar-scan.raw.ndjson << 'EOF'
import json, os, sys, time
owner_dir, raw = sys.argv[1], sys.argv[2]
scores = {}
try:
    scores = json.load(open(os.path.join(owner_dir, "scores.json")))
except Exception:
    pass
radar = []
for line in open(raw):
    line = line.strip()
    if not line: continue
    e = json.loads(line)
    sc = scores.get(e["login"], {})
    e["score"] = int(sc.get("score", 0) or 0)
    e["repos"] = int(sc.get("repos", 0) or 0)
    radar.append(e)
radar.sort(key=lambda r: -r["score"])
out = {"owner": os.path.basename(owner_dir), "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
       "min_score": 120, "people": radar}
json.dump(out, open(os.path.join(owner_dir, "radar.json"), "w"), ensure_ascii=False, indent=1)
print("radar-scan: %d people classified -> radar.json" % len(radar))
EOF
