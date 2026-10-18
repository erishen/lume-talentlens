#!/usr/bin/env python3
"""trending-push.py — push the GitHub trending board to a DingTalk group.

The content half of the DingTalk push (the transport is scripts/notify.py).
Pulls the same feed the dashboard's "趋势" tab renders and sends a compact text
list to the configured webhook.

Data source, in order:
  1. the running lume server's ``/api/trending`` (preferred: it injects
     GH_TOKEN, TTL-caches, and — with ``tr=zh`` — machine-translates the
     descriptions, so the group reads Chinese);
  2. GitHub's Search API directly (fallback when no server is up; descriptions
     stay in English). Honours GH_TOKEN and the LUME_HTTP_PROXY bridge.

Config (repo-root .env or environment; env wins):
    TREND_WEBHOOK_URL      robot webhook (see scripts/notify.py)
    TREND_WEBHOOK_SECRET   DingTalk 加签 secret (optional)
    TREND_PUSH_BASE_URL    base URL of the lume server (default
                           http://127.0.0.1:<LUME_GITHUB_PORT|8091>)
    GH_TOKEN               raises the Search API quota (fallback path)
    LUME_HTTP_PROXY        bridged to HTTPS_PROXY for the direct GitHub call

Usage:
    make trending-push                       # daily, top 10, Chinese
    make trending-push SINCE=weekly TOP=15
    DRY_RUN=1 make trending-push             # print the message, don't push
    python3 scripts/trending-push.py --since monthly --top 20 --no-translate
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import notify  # noqa: E402  (sibling module in scripts/)

SINCE_DAYS = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90, "year": 365}
SINCE_LABEL = {"daily": "每日", "weekly": "本周", "monthly": "本月",
               "quarterly": "近 3 月", "year": "今年"}
VALID_LANGS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+#.-")


def _bridge_proxy() -> None:
    """Route the direct-GitHub fallback through LUME_HTTP_PROXY like the shell
    scripts do (env.sh). urllib reads HTTPS_PROXY; loopback stays direct."""
    proxy = os.environ.get("LUME_HTTP_PROXY", "").strip()
    if not proxy:
        return
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ.setdefault(k, proxy)
    # Keep loopback direct even when a proxy is set: make sure 127.0.0.1 and
    # localhost are in NO_PROXY without leaving a leading-comma gap.
    existing = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    parts = [p for p in existing.split(",") if p]
    for host in ("127.0.0.1", "localhost"):
        if host not in parts:
            parts.append(host)
    joined = ",".join(parts)
    os.environ["NO_PROXY"] = joined
    os.environ["no_proxy"] = joined


def _since_days(since: str) -> int:
    return SINCE_DAYS.get(since, 1)


def _fmt_stars(n: int) -> str:
    n = int(n or 0)
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def _valid_lang(lang: str) -> bool:
    return bool(lang) and len(lang) <= 30 and all(c in VALID_LANGS for c in lang)


def _server_base_url(explicit: str) -> str:
    if explicit:
        return explicit.rstrip("/")
    env = os.environ.get("TREND_PUSH_BASE_URL", "").strip()
    if env:
        return env.rstrip("/")
    port = os.environ.get("LUME_GITHUB_PORT", "8091").strip() or "8091"
    return f"http://127.0.0.1:{port}"


def fetch_from_server(base_url: str, since: str, lang: str, owner: str,
                      tr: str, timeout: float) -> dict:
    qp = {"since": since, "tr": tr}
    if lang:
        qp["lang"] = lang
    if owner:
        qp["owner"] = owner
    url = f"{base_url}/api/trending?" + urllib.parse.urlencode(qp)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def fetch_direct(since: str, lang: str, owner: str, top: int, timeout: float) -> dict:
    """GitHub Search API fallback (mirrors app/lib/trending.lume's query).

    Same privacy invariant: every query carries ``is:public`` so the server
    token can never surface private repos. Descriptions are not translated.
    """
    days = _since_days(since)
    date = (datetime.date.today() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    q = f"created:>{date} is:public"
    if owner:
        q = f"user:{owner} {q}"
    if lang:
        q = f"{q} language:{lang}"
    url = ("https://api.github.com/search/repositories?q="
           + urllib.parse.quote(q, safe="") + f"&sort=stars&order=desc&per_page={top}")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "lume-talentlens"}
    token = os.environ.get("GH_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = json.loads(resp.read().decode("utf-8", errors="replace"))
    items = []
    for it in raw.get("items", []):
        if it.get("private"):
            continue
        ow = it.get("owner") or {}
        items.append({
            "full_name": it.get("full_name") or "",
            "url": it.get("html_url") or "",
            "desc": it.get("description") or "",
            "lang": it.get("language") or "",
            "stars": it.get("stargazers_count") or 0,
        })
    return {
        "ok": True,
        "since": since,
        "lang": lang,
        "count": len(items),
        "generated_at": (datetime.date.today() - datetime.timedelta(days=days)).strftime("%Y-%m-%d"),
        "items": items,
        "source": "github-search",
    }


def render_message(payload: dict, top: int) -> str:
    items = payload.get("items") or []
    since = payload.get("since", "daily")
    label = SINCE_LABEL.get(since, since)
    date = payload.get("generated_at", "")
    lang = payload.get("lang", "")
    scope = payload.get("owner") or ""
    head = f"📈 GitHub 趋势榜 · {label}"
    if scope:
        head += f" · @{scope}"
    if lang:
        head += f" · {lang}"
    if date:
        head += f" · {date}"

    lines = [head, ""]
    shown = items[:top] if top > 0 else items
    for i, it in enumerate(shown, 1):
        name = it.get("full_name") or it.get("name") or "?"
        stars = _fmt_stars(it.get("stars", 0))
        langtag = it.get("lang") or ""
        meta = f"⭐{stars}"
        if langtag:
            meta += f" · {langtag}"
        lines.append(f"{i}. {name} {meta}")
        desc = (it.get("desc_zh") or it.get("desc") or "").strip()
        if desc:
            lines.append(f"   {desc}")
    total = payload.get("count", len(items))
    lines.append("")
    lines.append(f"共 {total} 项 · github.com/trending")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="推送 GitHub 趋势榜到 webhook")
    ap.add_argument("--since", default=os.environ.get("TREND_PUSH_SINCE", "daily"),
                    choices=list(SINCE_DAYS), help="时间窗（默认 daily）")
    ap.add_argument("--lang", default=os.environ.get("TREND_PUSH_LANG", ""),
                    help="语言过滤，如 Python / Go（默认不限）")
    ap.add_argument("--top", type=int, default=int(os.environ.get("TREND_PUSH_TOP", "10")),
                    help="消息里最多几条（默认 10）")
    ap.add_argument("--owner", default="", help="只看某个 owner 的新仓库")
    ap.add_argument("--base-url", default="", help="lume 服务地址（默认读 TREND_PUSH_BASE_URL）")
    ap.add_argument("--no-translate", action="store_true",
                    help="不请求机翻（走服务端时默认 tr=zh）")
    ap.add_argument("--direct", action="store_true",
                    help="跳过本地服务，直接打 GitHub Search API")
    ap.add_argument("--timeout", type=float, default=20.0, help="单次请求超时秒（默认 20）")
    ap.add_argument("--dry-run", action="store_true",
                    default=os.environ.get("DRY_RUN", "")
                            not in ("", "0", "false", "False", "no", "No"),
                    help="只打印消息，不推送（或设 DRY_RUN=1 环境变量；与 make 口径一致）")
    args = ap.parse_args()

    notify._load_dotenv(os.path.join(ROOT, ".env"))
    _bridge_proxy()

    lang = args.lang.strip()
    if lang and not _valid_lang(lang):
        print(f"trending-push: 非法 lang: {lang}", file=sys.stderr)
        return 2

    payload = None
    source = ""
    if not args.direct:
        base = _server_base_url(args.base_url)
        tr = "" if args.no_translate else "zh"
        try:
            payload = fetch_from_server(base, args.since, lang, args.owner, tr, args.timeout)
            source = base
            if not payload.get("ok", False):
                print(f"trending-push: 服务端返回失败：{payload.get('err')}", file=sys.stderr)
                payload = None
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as e:
            print(f"trending-push: 本地服务不可用（{type(e).__name__}: {e}）→ 回退直连 GitHub",
                  file=sys.stderr)

    if payload is None:
        try:
            payload = fetch_direct(args.since, lang, args.owner, args.top, args.timeout)
            source = "api.github.com (direct)"
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as e:
            print(f"trending-push: 直连 GitHub 也失败：{type(e).__name__}: {e}", file=sys.stderr)
            return 1

    if not payload.get("items"):
        print("trending-push: 没有可推送的趋势项", file=sys.stderr)
        return 1

    message = render_message(payload, args.top)
    if args.dry_run:
        print(f"trending-push: [dry-run] 数据源 {source}\n")
        print(message)
        return 0

    if not notify.configured():
        print(f"trending-push: 未配置 {notify.ENV_URL}，无法推送（--dry-run 可先看消息）",
              file=sys.stderr)
        return 1

    ok, msg = notify.send_text(message)
    print(f"trending-push: {msg}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
