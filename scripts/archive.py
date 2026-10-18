#!/usr/bin/env python3
"""archive.py — TODO #11 高手档案知识库. Turn the talent-radar profit signals
(radar.json) + network data (people.json) into a structured markdown knowledge
base for HR / learning: each mutual high scorer with their money pattern,
monetization signals (site / product / sponsor), best-effort monetization tags
(SaaS-like product / sponsor / course / consulting), and top repos.

Reads only local data (offline). The radar pool must exist first:
    make score && make radar        # or: make daily
Output defaults to data/github/<owner>/archive.md (gitignored — personal);
override with OUT=/path/to/file.md.

Usage:
    python3 scripts/archive.py            # default owner
    OWNER=alice python3 scripts/archive.py
    OUT=docs/pool.md python3 scripts/archive.py
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv(path):
    """Minimal .env loader (key=value lines; existing env vars win)."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except OSError:
        pass


_load_dotenv(os.path.join(ROOT, ".env"))
OWNER = os.environ.get("OWNER", "")
if not OWNER:
    try:
        with open(os.path.join(ROOT, "data", "github", "last_owner")) as f:
            OWNER = f.read().strip()
    except OSError:
        OWNER = ""
if not OWNER:
    print("archive: no owner. Set OWNER (e.g. OWNER=alice) or add OWNER= to .env", file=sys.stderr)
    sys.exit(1)
OUT = os.environ.get("OUT", os.path.join(ROOT, "data", "github", OWNER, "archive.md"))


def _load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def money_tags(p):
    """Best-effort monetization tags on top of the structural signals. The
    exact SaaS/consulting split needs live profile text; these are keyword
    hints from the radar evidence note / blog / company (keep local)."""
    tags = []
    if p.get("sponsor") is True:
        tags.append("赞助 (Sponsors)")
    if p.get("product"):
        tags.append("产品/SaaS · 仓库带落地页")
    if p.get("site"):
        tags.append("个人站/官网")
    text = " ".join([p.get("note") or "", p.get("blog") or "", p.get("company") or ""]).lower()
    if re.search(r"course|tutorial|academy|school|教学|课程|卖课", text):
        tags.append("卖课/课程")
    if re.search(r"consult|freelanc|coach|mentor|咨询|接单|外包", text):
        tags.append("咨询/接单")
    return tags


def main() -> int:
    owner_dir = os.path.join(ROOT, "data", "github", OWNER)
    radar = _load(os.path.join(owner_dir, "radar.json"), None)
    if not radar or not radar.get("people"):
        print(f"archive: no radar pool for @{OWNER} (data/github/{OWNER}/radar.json) — run make score && make radar first", file=sys.stderr)
        return 1

    people = _load(os.path.join(owner_dir, "people.json"), {})
    names = {u.get("login"): (u.get("name") or u.get("login")) for u in people.get("following", []) + people.get("followers", [])}

    pool = radar.get("people", [])
    pool.sort(key=lambda p: -int(p.get("score", 0) or 0))
    by_mode = {}
    for p in pool:
        by_mode.setdefault(p.get("mode", "other"), []).append(p)

    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    mini = int((radar.get("min_score") or 60))
    L = []
    L.append(f"# 高手档案知识库 · {OWNER}")
    L.append("")
    L.append(f"- 生成：{now}")
    L.append(f"- 来源：radar.json / people.json（离线）· 雷达门槛 score ≥ {mini} · 共 {len(pool)} 人")
    L.append("- 变现标签为本地关键词推断（site/product/sponsor 为结构信号），精确口径请逐人确认。")
    L.append("")
    L.append("## 汇总")
    L.append("")
    L.append("| 盈利模式 | 人数 | 代表（score） |")
    L.append("|---|---|---|")
    modes_rank = sorted(by_mode.items(), key=lambda kv: -len(kv[1]))
    for mode, ps in modes_rank:
        top = ps[0]
        L.append(f"| `{mode}` | {len(ps)} | {top.get('login')}（{top.get('score')}） |")
    L.append("")
    L.append("## 档案")
    L.append("")

    def esc(x):
        return str(x).replace("|", "\\|")

    for mode, ps in modes_rank:
        L.append(f"### {mode} · {len(ps)} 人")
        L.append("")
        for i, p in enumerate(ps, 1):
            login = p.get("login", "?")
            name = names.get(login) or login
            score = p.get("score", 0)
            L.append(f"#### {i}. {name} · `{login}` · score {score}")
            L.append("")
            L.append(f"- 一句话证据：{p.get('note') or '无'}")
            tags = money_tags(p)
            L.append(f"- 变现信号：{', '.join(tags) if tags else '无公开变现信号'}")
            L.append(f"- 个人站/博客：{p.get('blog') or '无'}")
            L.append(f"- 公司：{p.get('company') or '无'} · 所在地：{p.get('loc') or '未知'}")
            L.append(f"- 开放求职/接活（hireable）：{'是' if p.get('hireable') else '否'}")
            L.append(f"- 影响力：star 总数 {p.get('star_total', 0)} · star/仓库 {p.get('star_per_repo', 0)} · 粉丝 {p.get('followers', 0)}")
            repos = p.get("top_repos") or []
            if repos:
                L.append("- Top 仓库：")
                for r in repos[:3]:
                    L.append(f"  - {esc(r.get('name'))}（{r.get('stars')}★）— {esc(r.get('desc') or '')}")
            else:
                L.append("- Top 仓库：无")
            L.append("")

    with open(OUT, "w") as f:
        f.write("\n".join(L))
    print(f"archive: {len(pool)} people -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())