#!/usr/bin/env bash
# fetch-github.sh — snapshot the public open-source GitHub projects of a user
# into data/github/ so the Lume app can analyze them offline.
#
# Usage:
#   scripts/fetch-github.sh                        # defaults: owner erishen
#   OWNER=acme scripts/fetch-github.sh             # any public owner
#   GH_TOKEN=ghp_... scripts/fetch-github.sh       # raise the 60→5000 req/h limit
#
# Outputs (all under data/github/<owner>/):
#   user.json     — the owner profile (read back to build snapshot.profile)
#   people.json   — followers / following (first page, slimmed) + totals
#   snapshot.json — { fetched_at, owner, profile, count, repos: [...] }
#                   (the only file the Lume server reads)
set -euo pipefail

OWNER="${OWNER:-erishen}"
# per-owner layout so multiple owners coexist: data/github/<owner>/
# (sanitize: the Lume server reads data/github/<owner>/snapshot.json, and
# files() lists owners from data/github — owner must be a safe dir name)
case "$OWNER" in
  *[!a-zA-Z0-9_-]*)
    echo "fetch: owner '$OWNER' contains unsafe characters" >&2; exit 1 ;;
esac
BASE="${GITHUB_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/github}"
DIR="$BASE/$OWNER"
API="${API_BASE:-https://api.github.com}"
TOK="${GH_TOKEN:-}"

mkdir -p "$DIR"
echo "==> fetching $OWNER -> $DIR"

# Safe empty-array expansion under `set -u`
AUTH_ARGS=()
if [ -n "$TOK" ]; then AUTH_ARGS=(-H "Authorization: Bearer $TOK"); fi

# 1) owner profile  (${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} expands to nothing when empty, safe under set -u)
ucode=$(curl -sS --max-time 30 -w '%{http_code}' ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} \
  "$API/users/$OWNER" -o "$DIR/user.json") || true
if [ "${ucode:-000}" != "200" ]; then
  echo "    profile fetch failed (HTTP $ucode) — owner '$OWNER' may not exist; aborting (no snapshot, last_owner untouched)" >&2
  rm -f "$DIR/user.json"
  rmdir "$DIR" 2>/dev/null || true  # remove only if empty (keeps an existing snapshot)
  exit 1
fi

# 2) every repo the owner created, paginated. Each page goes to its own file
#    (.repos.p<N>.tmp) — concatenating arrays into one stream was fragile
#    (a "][" inside a repo description would split the JSON and drop a page).
rm -f "$DIR"/.repos.p*.tmp
page=1
while :; do
  code=$(curl -sS --max-time 30 ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} \
    -w '%{http_code}' -o "$DIR/.repos.p$page.tmp" \
    "$API/users/$OWNER/repos?type=owner&sort=updated&per_page=100&page=$page")
  if [ "$code" != "200" ]; then
    echo "    page $page -> HTTP $code (stopping)" >&2
    break
  fi
  n=$(python3 -c "import json; print(len(json.load(open('$DIR/.repos.p$page.tmp'))))" 2>/dev/null || echo 0)
  echo "    page $page -> $n repos"
  [ "$n" -lt 100 ] && break
  page=$((page + 1))
  [ "$page" -gt 40 ] && { echo "    safety cap (40 pages)" >&2; break; }
done

# 2b) followers + following (first page of 100 each — enough for the UI's
#     avatar grid; totals come from the profile). Slim fields only.
for kind in followers following; do
  fcode=$(curl -sS --max-time 30 -w '%{http_code}' ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} \
    -o "$DIR/$kind.tmp" \
    "$API/users/$OWNER/$kind?per_page=100") || true
  if [ "${fcode:-000}" != "200" ]; then
    echo "    $kind -> HTTP ${fcode:-000} (storing empty list)" >&2
    echo "[]" > "$DIR/$kind.tmp"
  fi
  echo "    $kind -> $(python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))))" "$DIR/$kind.tmp" 2>/dev/null || echo 0) users"
done

# Combine all pages into one JSON array
python3 - "$DIR" "$OWNER" <<'PY'
import json, os, sys, datetime, glob

d = os.path.abspath(sys.argv[1]); owner = sys.argv[2]

# Each page lives in its own .repos.p<N>.tmp file; read them in order.
# (Old code concatenated arrays and split on "][" — fragile against "]["
# appearing inside a repo description, which silently dropped a page.)
repos = []
for f in sorted(glob.glob(os.path.join(d, ".repos.p*.tmp"))):
    try:
        repos.extend(json.load(open(f)))
    except Exception:
        print("    warning: skipping unreadable page file %s" % os.path.basename(f), file=sys.stderr)

# de-dupe by full_name (keep last = most recent metadata)
seen = {}
for r in repos:
    seen[r["full_name"]] = r
repos = list(seen.values())

# tag forks
for r in repos:
    r["_is_fork"] = bool(r.get("fork"))

now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
ts = now.strftime("%Y-%m-%dT%H:%M:%SZ")
non_fork = [r for r in repos if not r.get("fork")]

def iso_to_dt(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None

def days_since(dt):
    if dt is None:
        return None
    return max(0, int((now - dt).total_seconds() // 86400))

def recency_bucket(days):
    if days is None:
        return "unknown"
    if days <= 90:
        return "active"
    if days <= 365:
        return "recent"
    if days <= 730:
        return "dormant"
    return "stale"

# Precompute derived numeric fields so the Lume app does pure aggregation.
def clip(s, n=140):
    if not s:
        return ""
    s = s.strip()
    return s[:n] if len(s) <= n else s[:n - 1] + "…"

for r in repos:
    created = iso_to_dt(r.get("created_at"))
    updated = iso_to_dt(r.get("updated_at"))
    pushed = iso_to_dt(r.get("pushed_at"))
    r["created_year"] = created.year if created else 0
    r["updated_year"] = updated.year if updated else 0
    r["age_days"] = days_since(created)
    r["days_since_push"] = days_since(pushed)
    r["days_since_updated"] = days_since(updated)
    # "active" = pushed within 90d — a push is the signal that code is still
    # being written; updated_at (README tweaks etc.) is not.
    r["recency"] = recency_bucket(r["days_since_push"])
    # which month each repo was last pushed (YYYY-MM) — drives the
    # recruiter-facing "recent activity" trend; empty when no push date.
    r["push_month"] = pushed.strftime("%Y-%m") if pushed else ""
    # keep JSON lean: clip long descriptions + cap topic lists (the Lume HTTP
    # framework caps a response body at 65536 bytes).
    r["description"] = clip(r.get("description"))
    topics = r.get("topics") or []
    r["topics"] = topics[:8]

# Project to only the fields the Lume app actually reads, so snapshot.json
# stays small enough that even a full /api/overview ships under the cap.
KEEP = [
    "name", "full_name", "language", "stargazers_count", "forks_count",
    "open_issues_count", "fork", "archived", "created_at", "updated_at",
    "pushed_at", "html_url", "description", "license", "topics", "size",
    # derived (added above)
    "created_year", "updated_year", "age_days", "days_since_push",
    "days_since_updated", "recency", "push_month", "_is_fork",
]
def slim(r):
    out = {}
    for k in KEEP:
        out[k] = r.get(k)
    lic = out.get("license")
    if isinstance(lic, dict):
        out["license"] = {"spdx_id": lic.get("spdx_id")}
    return out

repos = [slim(r) for r in repos]

# write outputs
# (repos.json / meta.json dropped — the slim repo list is embedded in
#  snapshot.json which the Lume server reads; nothing consumes the other two.)
try:
    user = json.load(open(os.path.join(d, "user.json")))
except Exception:
    user = {"login": owner}
json.dump(user, open(os.path.join(d, "user.json"), "w"), indent=2)

# people.json — the followers / following lists (first page, slimmed).
def slim_people(path):
    try:
        data = json.load(open(os.path.join(d, path)))
    except Exception:
        return []
    out = []
    for u in data:
        out.append({
            "login": u.get("login"),
            "name": u.get("name") or u.get("login"),
            "avatar": u.get("avatar_url"),
            "url": u.get("html_url"),
            "type": u.get("type"),
        })
    return out

people = {
    "followers": slim_people("followers.tmp"),
    "following": slim_people("following.tmp"),
    "totals": {"followers": user.get("followers"), "following": user.get("following")},
    "note": "first page (up to 100) of each; totals from the owner profile",
}
json.dump(people, open(os.path.join(d, "people.json"), "w"), indent=2)
for p in ("followers.tmp", "following.tmp"):
    try:
        os.remove(os.path.join(d, p))
    except OSError:
        pass

snapshot = {
    "fetched_at": ts,
    "owner": owner,
    "profile": {
        "login": user.get("login", owner),
        "name": user.get("name"),
        "avatar_url": user.get("avatar_url"),
        "bio": user.get("bio"),
        "company": user.get("company"),
        "location": user.get("location"),
        "blog": user.get("blog"),
        "twitter_username": user.get("twitter_username"),
        "hireable": user.get("hireable"),
        "followers": user.get("followers"),
        "following": user.get("following"),
        "public_repos": user.get("public_repos"),
        "public_gists": user.get("public_gists"),
        "created_at": user.get("created_at"),
        "html_url": user.get("html_url"),
    },
    "count": len(repos),
    "non_fork_count": len(non_fork),
    "repos": repos,
}
json.dump(snapshot, open(os.path.join(d, "snapshot.json"), "w"), indent=2)
print("    -> %d repos (%d non-fork) written to %s" % (len(repos), len(non_fork), d))
PY
rm -f "$DIR"/.repos.p*.tmp
# drop deprecated outputs (repo list now lives in snapshot.json; meta.json unused)
rm -f "$DIR/repos.json" "$DIR/meta.json"
# record the most-recently-fetched owner as the app default (single line, no
# trailing newline — the Lume server reads it with read_file)
printf '%s' "$OWNER" > "$BASE/last_owner"
echo "done. (last_owner -> $OWNER)"
