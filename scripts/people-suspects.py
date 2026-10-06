#!/usr/bin/env python3
"""people-suspects.py — flag likely "water accounts" (批量关注/僵尸号) among an
owner's followers AND/OR following using data already in people.json (no API
cost).

The followers/following list endpoints only store login/name/avatar/url/type,
but the avatar URL embeds the GitHub user id, which is a free proxy for
account age (bigger id = later signup). Combined with login-name patterns
(number tails, stacked buzzwords, South-Asian batch templates), new accounts
look like mass-registered water accounts with high confidence.

Output: data/github/<owner>/suspects.json next to people.json. Every suspect
carries a `kind` (followers | following | both). The server merges it by
login into /api/people for BOTH lists, so following suspects now show up too.

Usage:
  OWNER=erishen python3 scripts/people-suspects.py           # both lists
  KIND=following OWNER=erishen python3 scripts/people-suspects.py
  KIND=followers OWNER=erishen python3 scripts/people-suspects.py
Precise confirmation (followers_count < 5 / repos == 0) still needs the API —
see scripts/people-scan.sh once quota or GH_TOKEN is available.
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OWNER = os.environ.get("OWNER", "erishen")
KIND = os.environ.get("KIND", "all")  # all | followers | following
PEOPLE = os.path.join(ROOT, "data", "github", OWNER, "people.json")


def year_est(uid: int) -> str:
    if uid < 2_000_000:   return "2012前"
    if uid < 10_000_000:  return "2013-16"
    if uid < 30_000_000:  return "2017-19"
    if uid < 80_000_000:  return "2020-21"
    if uid < 150_000_000: return "2022-23"
    if uid < 220_000_000: return "2024"
    if uid < 280_000_000: return "2025"
    return "2026"


RECRUITER_RE = re.compile(
    r"(?i)(recruit|hiring|talent[-_]?(acq|acquisition)|headhunt|head[-_]?hunt|"
    r"(^|[-_])(hr|hrs)([-_]|$)|staffing|peopleops|people[-_]?ops|human[-_]?capital|"
    r"outsourc|career|job[-_]?(hunter|provider)|workforce)"
)


def patterns(login: str) -> list:
    marks = []
    if re.search(r"\d{3,}$", login):
        marks.append("number-tail")
    # word-boundary so common substrings (dev in "devansh", ai in "main",
    # web in "webster") don't mark every name as a buzzword stack
    if re.search(r"(?i)\b(coder|dev|ninja|tech|official|social|ai|oss|byte|web)\b", login):
        marks.append("buzzword")
    if re.search(r"[A-Z]+-[A-Z]+", login):
        marks.append("hyphen-stack")
    if re.search(r"(?i)(muhammad|shahid|abdul|ravi|akash|deepanshu|sidd|md\.?)", login):
        marks.append("batch-name")
    return marks


def scan(users, kind: str, out: dict, org_skipped: list) -> None:
    """Append suspects from one list to `out` (login-keyed; merge kind)."""
    for u in users:
        login = u.get("login", "")
        if not login:
            continue
        # Organizations need org verification/email — they are never
        # mass-registered water accounts (bulk-registered projects excepted).
        # Excluding them kills the false positives on accounts like
        # modelcontextprotocol / open-webui (registered 2024+ but legit).
        if u.get("type") == "Organization":
            org_skipped.append(login)
            continue
        m = re.search(r"/u/(\d+)", u.get("avatar", ""))
        uid = int(m.group(1)) if m else 0
        y = year_est(uid)
        pats = patterns(login)
        if y in ("2025", "2026") and pats:
            level = "high"      # brand-new + template name: strongest signal
        elif y in ("2024", "2025", "2026"):
            level = "medium"    # registered recently; pattern or not
        else:
            continue
        prev = out.get(login)
        if prev is None:
            out[login] = {
                "login": login,
                "uid": uid,
                "est_registered": y,
                "patterns": pats,
                "level": level,
                # hiring-side accounts (recruiters/HR) are NOT water accounts in
                # the harmful sense — they bulk-follow developers as a sourcing
                # action. Flag them separately so the UI can label them as
                # opportunities.
                "maybe_recruiter": bool(RECRUITER_RE.search(login)),
                "kind": kind,
            }
        else:
            # same login in both lists: keep the stronger level, mark "both"
            if level == "high" and prev["level"] == "medium":
                prev["level"] = "high"
            if prev.get("kind") != kind:
                prev["kind"] = "both"


def main() -> int:
    if not os.path.exists(PEOPLE):
        print(f"people-suspects: {PEOPLE} missing — run OWNER={OWNER} make fetch first", file=sys.stderr)
        return 1
    data = json.load(open(PEOPLE))

    kinds = ["followers", "following"] if KIND == "all" else [KIND]
    merged = {}   # login -> suspect (merged across kinds)
    totals = {}   # kind -> count scanned
    org_skipped = []
    for k in kinds:
        users = data.get(k, [])
        totals[k] = len(users)
        scan(users, k, merged, org_skipped)

    suspects = sorted(merged.values(), key=lambda s: (-s["uid"]))
    counts = {
        "high": sum(1 for s in suspects if s["level"] == "high"),
        "medium": sum(1 for s in suspects if s["level"] == "medium"),
        "maybe_recruiter": sum(1 for s in suspects if s["maybe_recruiter"]),
        "registered_2024_plus": sum(1 for s in suspects if s["est_registered"] in ("2024", "2025", "2026")),
        "total_followers": totals.get("followers", 0),
        "total_following": totals.get("following", 0),
        "per_kind": {
            k: {
                "high": sum(1 for s in suspects if s["level"] == "high" and s.get("kind") in (k, "both")),
                "medium": sum(1 for s in suspects if s["level"] == "medium" and s.get("kind") in (k, "both")),
                "total": totals[k],
            }
            for k in kinds
        },
        "excluded_organizations": len(org_skipped),
    }
    out = {
        "owner": OWNER,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": os.path.relpath(PEOPLE, ROOT),
        "note": "预筛基于 avatar 用户 id 分层 + 登录名模式（零 API 成本）；精确确认（followers<5 / repos=0）需 scripts/people-scan.sh",
        "counts": counts,
        "suspects": suspects,
    }
    dest = os.path.join(os.path.dirname(PEOPLE), "suspects.json")
    with open(dest, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    per = counts["per_kind"]
    summary = " + ".join(
        f"{k}: {per[k]['high']} high + {per[k]['medium']} medium of {per[k]['total']}"
        for k in kinds
    )
    print(f"people-suspects: {summary} ({counts['registered_2024_plus']} registered 2024+) -> {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
