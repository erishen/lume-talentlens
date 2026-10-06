#!/usr/bin/env python3
"""people-suspects.py — flag likely "water accounts" (批量关注/僵尸号) among an
owner's followers using data already in people.json (no API cost).

The followers list endpoint only stores login/name/avatar/url/type, but the
avatar URL embeds the GitHub user id, which is a free proxy for account age
(bigger id = later signup). Combined with login-name patterns (number tails,
stacked buzzwords, South-Asian batch templates), new accounts look like
mass-registered water accounts with high confidence.

Output: data/github/<owner>/suspects.json next to people.json.

Usage:  OWNER=erishen python3 scripts/people-suspects.py
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
    r"\bhr[-_a-z]*\b|staffing|peopleops|people[-_]?ops|human[-_]?capital|"
    r"outsourc|career|job[-_]?(hunter|provider)|workforce)"
)


def patterns(login: str) -> list:
    marks = []
    if re.search(r"\d{3,}$", login):
        marks.append("number-tail")
    if re.search(r"(?i)(coder|dev|ninja|tech|official|social|ai|oss|byte|web)", login):
        marks.append("buzzword")
    if re.search(r"[A-Z]+-[A-Z]+", login):
        marks.append("hyphen-stack")
    if re.search(r"(?i)(muhammad|shahid|abdul|ravi|akash|deepanshu|sidd|md\.?)", login):
        marks.append("batch-name")
    return marks


def main() -> int:
    if not os.path.exists(PEOPLE):
        print(f"people-suspects: {PEOPLE} missing — run OWNER={OWNER} make fetch first", file=sys.stderr)
        return 1
    data = json.load(open(PEOPLE))
    users = data.get("followers", [])

    suspects = []
    for u in users:
        login = u.get("login", "")
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
        suspects.append({
            "login": login,
            "uid": uid,
            "est_registered": y,
            "patterns": pats,
            "level": level,
            # hiring-side accounts (recruiters/HR) are NOT water accounts in the
            # harmful sense — they bulk-follow developers as a sourcing action.
            # Flag them separately so the UI can label them as opportunities.
            "maybe_recruiter": bool(RECRUITER_RE.search(login)),
        })

    suspects.sort(key=lambda s: (-s["uid"]))
    counts = {
        "high": sum(1 for s in suspects if s["level"] == "high"),
        "medium": sum(1 for s in suspects if s["level"] == "medium"),
        "maybe_recruiter": sum(1 for s in suspects if s["maybe_recruiter"]),
        "registered_2024_plus": sum(1 for s in suspects if s["est_registered"] in ("2024", "2025", "2026")),
        "total_followers": len(users),
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
    print(f"people-suspects: {counts['high']} high + {counts['medium']} medium suspects "
          f"({counts['registered_2024_plus']} registered 2024+) of {counts['total_followers']} followers -> {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
