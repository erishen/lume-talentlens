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
MIN_SCORE="${MIN_SCORE:-60}"
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
  RE="$(curl -sS -m 25 "${AUTH[@]+"${AUTH[@]}"}" -H "Accept: application/vnd.github+json" -H "User-Agent: lume-talentlens" "https://api.github.com/users/$login/repos?sort=stars&per_page=100" || true)"
  # Sponsors probe via GraphQL (only with a token; login is [a-z0-9-] so
  # string interpolation into the JSON query is safe). A failed probe is
  # reported as sponsor=null ("unknown"), never as a false negative.
  SP=""
  if [ -n "$TOK" ]; then
    SP="$(curl -sS -m 15 "${AUTH[@]+"${AUTH[@]}"}" -H "Content-Type: application/json" -H "Accept: application/json" \
      -d "{\"query\":\"query { user(login: \\\"${login}\\\") { hasSponsorsListing } }\"}" \
      https://api.github.com/graphql || true)"
  fi
  python3 - "$login" "$UP" "$RE" "$SP" "$ROOT/data/github/$OWNER/suspects.json" >> /tmp/radar-scan.raw.ndjson << 'EOF'
import json, sys, re, time
from datetime import datetime, timezone
login, up, re_, sp, susp_file = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
def J(s):
    try: return json.loads(s)
    except Exception: return {}
u = J(up); repos = J(re_)
if not u or "login" not in u:
    print(json.dumps({"login": login, "error": "fetch_failed", "mode": "other", "note": "profile fetch failed",
                      "signals": [], "score": 0})); sys.exit(0)
bio = (u.get("bio") or "").strip()[:200]
company = (u.get("company") or "").strip()[:80]
blog = (u.get("blog") or "").strip()[:80]
loc = (u.get("location") or "").strip()[:40]
hireable = bool(u.get("hireable"))
followers = int(u.get("followers", 0) or 0)
age_years = max(0, (datetime.now().year or 2026) - int((u.get("created_at") or "2026")[:4]))
repos_top = []
if isinstance(repos, list):
    for r in repos[:3]:
        repos_top.append({"name": (r.get("name") or ""), "stars": int(r.get("stargazers_count", 0) or 0),
                          "desc": ((r.get("description") or "") or "")[:120],
                          "homepage": ((r.get("homepage") or "") or "")[:80]})
text = " ".join([bio, company, blog] + [r["name"] + " " + r["desc"] for r in repos_top]).lower()

# --- quality & activity from the full repo list (per_page=100) --------
# star total = how much the output is actually used; star-per-repo = how
# focused the output is (many repos with zero stars dilute it); activity =
# any push in the last 90 days (genuinely building) vs 1 year (dormant).
star_total = 0
recent = []
if isinstance(repos, list):
    star_total = sum(int(r.get("stargazers_count", 0) or 0) for r in repos if isinstance(r, dict))
    def _pts(iso):
        try: return datetime.fromisoformat((iso or "").replace("Z", "+00:00")).timestamp()
        except Exception: return None
    now = datetime.now(timezone.utc).timestamp()
    recent = [t for t in (_pts(r.get("pushed_at", "")) for r in repos if isinstance(r, dict)) if t]
star_per_repo = (star_total / max(1, len(repos))) if isinstance(repos, list) else 0
active = 20 if any(now - t < 90 * 86400 for t in recent) else (10 if any(now - t < 365 * 86400 for t in recent) else 0)

# --- water-account penalty from suspects.json (high -20 / medium -10) --
sus_penalty = 0
try:
    ss = J(open(susp_file).read())
    items = ss.get("suspects", []) if isinstance(ss, dict) else ss
    lvl = {x.get("login"): x.get("level", "high") for x in items if isinstance(x, dict) and x.get("login")}
    sus_penalty = 20 if lvl.get(login) == "high" else (10 if lvl.get(login) == "medium" else 0)
except Exception:
    pass

# --- monetization signals (TODO P0-1) -------------------------------
# site: a real personal/project URL in the profile (blog field; empty when
#       the user never set one)
site = bool(blog)
# product: at least one top repo has a homepage set (a landing page beyond
#          the repo itself is the classic SaaS/paid-product tell)
product = bool([r for r in repos_top if r.get("homepage")])
# sponsor: GitHub Sponsors listing via GraphQL (needs GH_TOKEN; null when
#          the probe failed / no token — "unknown", not "no")
sponsor = None
g = J(sp)
if isinstance(g, dict) and isinstance(g.get("data"), dict):
    uu = g["data"].get("user")
    if isinstance(uu, dict) and "hasSponsorsListing" in uu:
        sponsor = bool(uu.get("hasSponsorsListing"))
signals = []
if site: signals.append("site")
if product: signals.append("product")
if sponsor: signals.append("sponsor")

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

# --- radar quality score: output recognition (stars) + focus (stars/repo)
# + activity (recent pushes) dominate; followers/age demoted; water-account
# penalty applied. Cap ≈ 123 (40+25+20+20+10+5+3).
score = min(40, star_total // 10) + min(25, int(star_per_repo * 5)) + active \
      + min(20, followers // 50) + min(10, age_years) \
      + (5 if hireable else 0) + (3 if bio else 0) - sus_penalty

print(json.dumps({"login": login, "mode": mode, "note": note[:140],
                  "score": score, "followers": followers, "hireable": hireable,
                  "loc": loc, "blog": blog, "company": company, "top_repos": repos_top[:2],
                  "site": site, "product": product, "sponsor": sponsor, "signals": signals,
                  "age_years": age_years, "star_total": star_total,
                  "star_per_repo": round(star_per_repo, 1), "active": active,
                  "sus_penalty": sus_penalty}))
EOF
  sleep "$GAP"
done

# merge with scores + write radar.json
python3 - "$ROOT/data/github/$OWNER" /tmp/radar-scan.raw.ndjson "$MIN_SCORE" << 'EOF'
import json, os, sys, time
from datetime import datetime, timezone
owner_dir, raw, min_score = sys.argv[1], sys.argv[2], int(sys.argv[3])
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
    # radar computes its own score (star/activity quality); fall back to the
    # people-score only when the profile fetch failed
    e["score"] = int(e.get("score", 0) or 0) or int(sc.get("score", 0) or 0)
    e["repos"] = int(sc.get("repos", 0) or 0)
    radar.append(e)
radar.sort(key=lambda r: -r["score"])

# --- the owner's own radar-quality score, from the local snapshot (zero
# API cost) so the panel can show "my score vs the radar line"
self_info = None
try:
    snap = json.load(open(os.path.join(owner_dir, "snapshot.json")))
    sp = snap.get("profile", {}) or {}
    sl = snap.get("repos", []) or []
    star_total = sum(int(r.get("stargazers_count", 0) or 0) for r in sl if isinstance(r, dict))
    star_per = star_total / max(1, len(sl))
    now = datetime.now(timezone.utc).timestamp()
    def _pts(iso):
        try: return datetime.fromisoformat((iso or "").replace("Z", "+00:00")).timestamp()
        except Exception: return None
    recent = [t for t in (_pts(r.get("pushed_at", "")) for r in sl if isinstance(r, dict)) if t]
    active = 20 if any(now - t < 90 * 86400 for t in recent) else (10 if any(now - t < 365 * 86400 for t in recent) else 0)
    age = max(0, datetime.now().year - int((sp.get("created_at") or "2026")[:4]))
    self_score = min(40, star_total // 10) + min(25, int(star_per * 5)) + active \
        + min(20, int(sp.get("followers", 0) or 0) // 50) + min(10, age) \
        + (5 if sp.get("hireable") else 0) + (3 if sp.get("bio") else 0)
    self_info = {"login": sp.get("login") or os.path.basename(owner_dir),
                 "score": self_score, "star_total": star_total, "active": active}
except Exception:
    pass

out = {"owner": os.path.basename(owner_dir), "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
       "min_score": min_score, "self": self_info, "people": radar}
json.dump(out, open(os.path.join(owner_dir, "radar.json"), "w"), ensure_ascii=False, indent=1)
print("radar-scan: %d people classified -> radar.json" % len(radar))
EOF
