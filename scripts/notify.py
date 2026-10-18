#!/usr/bin/env python3
"""notify.py — push a plain-text message to a webhook (钉钉自定义机器人 / 企微 /
Server酱), the transport half of the DingTalk push.

Mirrors work/sale/daoye-signal's tender_signal/notify.py so both projects send
DingTalk group messages the same way. The behaviour that matters:

  * 钉钉「加签」: when TREND_WEBHOOK_SECRET is set AND the URL host is
    oapi.dingtalk.com, append ``timestamp`` (ms) + ``sign``
    (URL-encoded base64 HMAC-SHA256(secret, f"{ts}\\n{secret}")).
  * HTTP 200 ≠ success: 企微 also answers 200 with a body whose ``errcode``/``code``
    is non-zero, so the body is inspected before declaring victory.
  * transport-only retry (timeout / connection reset / 5xx / 429); a business
    error (errcode != 0, e.g. bad sign) fails at once — retrying never helps.
  * the webhook URL (its ``access_token`` and the sign live in the query) is
    masked before it reaches a log line.

Config (repo-root .env or the same-named environment variable; env wins):
    TREND_WEBHOOK_URL      the robot's webhook URL (empty = not configured)
    TREND_WEBHOOK_SECRET   DingTalk 加签 secret (optional; leave empty if the
                           robot uses a keyword / IP allowlist instead)
    TREND_WEBHOOK_KEYWORD  DingTalk 关键词-security keyword; prepended to every
                           message body so keyword-secured robots accept pushes
                           regardless of content (留空 if the robot uses 加签/IP)

Usage:
    python3 scripts/notify.py --text "hello"
    echo "multi-line" | python3 scripts/notify.py          # text from stdin
    python3 scripts/notify.py --text "$(cat logs/daily/2026-10-18.md)"
Exits non-zero (and prints why) when the push fails or nothing is configured.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ENV_URL = "TREND_WEBHOOK_URL"
ENV_SECRET = "TREND_WEBHOOK_SECRET"
# DingTalk robots secured by keyword need the keyword to appear in the message
# body. Set TREND_WEBHOOK_KEYWORD and send_text prepends it, so ANY push (daily
# summary, trending board) passes keyword inspection. Leave empty when the
# robot uses 加签 / IP allowlist.
ENV_KEYWORD = "TREND_WEBHOOK_KEYWORD"

# Network wobble: a webhook times out or resets the connection now and then;
# dropping a whole day's report over one blip is too brittle. Only transport
# failures (unreachable / timeout / 5xx / 429) are retried — a business error
# (errcode != 0) is deterministic and re-sending cannot fix it.
PUSH_RETRIES = 3
PUSH_RETRY_DELAY = 3.0


def _load_dotenv(path):
    """Minimal .env loader (key=value lines; existing env vars win).

    Same contract as people-suspects.py: a value already in the environment is
    never overridden, so ``TREND_WEBHOOK_URL=... make ...`` beats .env.
    """
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


def webhook_url() -> str:
    _load_dotenv(os.path.join(ROOT, ".env"))
    return os.environ.get(ENV_URL, "").strip()


def webhook_secret() -> str:
    _load_dotenv(os.path.join(ROOT, ".env"))
    return os.environ.get(ENV_SECRET, "").strip()


def webhook_keyword() -> str:
    _load_dotenv(os.path.join(ROOT, ".env"))
    return os.environ.get(ENV_KEYWORD, "").strip()


def configured() -> bool:
    return bool(webhook_url())


def _signed_url(url: str, secret: str) -> str:
    """钉钉「加签」: append timestamp + sign. Other webhooks (or no secret) are
    returned unchanged.

    Only oapi.dingtalk.com is signed: 企微 / Server酱 do not verify a signature,
    so appending params would be harmless but makes the logged URL noisier — a
    host gate keeps the behaviour true to its name.
    """
    if not secret or "oapi.dingtalk.com" not in url:
        return url
    ts = str(round(time.time() * 1000))
    digest = hmac.new(secret.encode("utf-8"), f"{ts}\n{secret}".encode("utf-8"),
                      hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(digest))
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}timestamp={ts}&sign={sign}"


def _business_ok(body: str) -> tuple[bool, str]:
    """HTTP 200 is not push success: 企微 robots also fail with errcode != 0.

    Returns (ok, reason). A non-JSON / JSON-less body is treated as success
    (an unknown-but-2xx response should not be reported as a failure).
    """
    raw = (body or "").strip()
    if not raw:
        return True, ""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return True, ""  # plain-text "ok" etc.
    if not isinstance(data, dict):
        return True, ""
    # DingTalk/企微 use errcode, Server酱 uses code — both are 0 on success.
    for field in ("errcode", "code"):
        if field in data:
            rc = data[field]
            if rc not in (0, "0", None):
                return False, (f"{field}={rc} "
                               f"{data.get('errmsg') or data.get('message') or ''}").strip()
    return True, ""


def _display_url(url: str) -> str:
    """Webhook URL for logs/returns: drop the query.

    The access_token and the sign both live in the query — printing the raw URL
    would leak the token prefix into logs (and, via the push text, into the
    group). Keep scheme://host/path, replace the query with '…'.
    """
    try:
        p = urllib.parse.urlsplit(url)
        base = f"{p.scheme}://{p.netloc}{p.path}"
    except ValueError:
        return "webhook"
    return f"{base}?…" if p.query else base


def md_to_text(md: str) -> str:
    """Flatten a markdown summary to plain text for a text message.

    DingTalk text messages render ``#``/backticks literally, so the daily
    summary (markdown) would look noisy; convert headings to plain lines and
    bullets to '· ' so it reads cleanly in the group.
    """
    out = []
    for line in md.splitlines():
        s = line.rstrip()
        if s.startswith("### "):
            s = s[4:]
        elif s.startswith("## "):
            s = s[3:]
        elif s.startswith("# "):
            s = s[2:]
        # turn a leading "- " / "* " bullet into a middot bullet
        stripped = s.lstrip()
        indent = s[: len(s) - len(stripped)]
        if stripped.startswith("- ") or stripped.startswith("* "):
            s = indent + "· " + stripped[2:]
        # drop inline code backticks (kept content)
        s = s.replace("`", "")
        out.append(s)
    return "\n".join(out).strip()


def _retry_after(resp_headers, fallback: float, attempt: int) -> float:
    """Delay before the next attempt. 429 responses that send ``Retry-After``
    in seconds are honoured (capped so a hostile value can't stall the caller);
    otherwise the linear backoff fallback. Returns seconds to sleep.
    """
    ra = (resp_headers or {}).get("Retry-After", "") if resp_headers else ""
    try:
        secs = float(ra)
    except (TypeError, ValueError):
        secs = -1.0
    if 0 < secs <= 30:
        return secs
    return fallback * attempt


def send_text(content: str, url: str | None = None, secret: str | None = None,
              keyword: str | None = None,
              retries: int = PUSH_RETRIES, retry_delay: float = PUSH_RETRY_DELAY
              ) -> tuple[bool, str]:
    """POST a plain-text message. Returns (ok, message).

    ``url``/``secret``/``keyword`` default to the environment/.env config; pass
    them explicitly in tests to avoid touching the real config. A keyword
    prepends to the body so keyword-secured DingTalk robots accept the push.
    """
    if url is None:
        url = webhook_url()
    if secret is None:
        secret = webhook_secret()
    if keyword is None:
        keyword = webhook_keyword()
    if not url:
        return False, (f"未配置 webhook（.env 的 {ENV_URL}，或同名环境变量）")

    # DingTalk keyword robots reject any message whose body lacks the keyword.
    # Prepend it (only once, and only when it is not already present in the
    # text) so BOTH the trending board and the daily summary pass inspection.
    kw = (keyword or "").strip()
    if kw and kw not in content:
        content = f"【{kw}】{content}"

    url = _signed_url(url, secret)
    payload = json.dumps({"msgtype": "text", "text": {"content": content}},
                         ensure_ascii=False).encode("utf-8")

    last = ""
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            # 5xx / 429: the server is temporarily unwell, retry. 4xx (401/404):
            # a config/permission problem — retrying is futile, fail now.
            if e.code >= 500 or e.code == 429:
                last = f"HTTP {e.code}"
                if attempt < retries:
                    time.sleep(_retry_after(getattr(e, "headers", None),
                                            retry_delay, attempt))
                    continue
                return False, f"推送失败（重试 {retries} 次）：{last}"
            return False, f"推送失败：HTTP {e.code}"
        except Exception as e:  # noqa: BLE001 transport-layer errors are retryable
            last = f"{type(e).__name__}: {e}"
            if attempt < retries:
                time.sleep(retry_delay * attempt)
                continue
            return False, f"推送失败（重试 {retries} 次）：{last}"

        # got an HTTP response: business judgement is not retried
        ok, why = _business_ok(body)
        if not ok:
            return False, f"推送被拒绝：HTTP 200 但 {why}（{_display_url(url)}）"
        suffix = f"，第 {attempt} 次尝试成功" if attempt > 1 else ""
        return True, f"已推送（{_display_url(url)}{suffix}）"

    return False, f"推送失败：{last}"  # pragma: no cover — loop branches cover it


def main() -> int:
    ap = argparse.ArgumentParser(description="推送纯文本到 webhook（钉钉/企微/Server酱）")
    ap.add_argument("--text", help="要推送的文本；省略则从 stdin 读")
    ap.add_argument("--markdown", action="store_true",
                    help="把输入当 markdown 摘要，先拍平成纯文本再发")
    args = ap.parse_args()

    if args.text is not None:
        content = args.text
    else:
        content = sys.stdin.read()
    if args.markdown:
        content = md_to_text(content)

    if not content.strip():
        print("notify: 没有可推送的内容", file=sys.stderr)
        return 2

    ok, msg = send_text(content)
    print(("notify: " + msg))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
