#!/usr/bin/env python3
"""notify-selftest.py — regression guard for the DingTalk push helpers
(scripts/notify.py) and the trending renderer (scripts/trending-push.py).

Pure functions are checked directly; ``send_text`` is exercised against a
loopback http.server so the retry / business-error / masking paths are covered
without any network. No .env, no real webhook, no GitHub.

Run from the repo root:  python3 scripts/notify-selftest.py
Exits non-zero on any failure (wired into `make test`).
"""
import base64
import hashlib
import hmac
import http.server
import importlib.util
import json
import os
import sys
import threading
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import notify  # noqa: E402


def _load_trending():
    path = os.path.join(HERE, "trending-push.py")
    spec = importlib.util.spec_from_file_location("trending_push", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tpush = _load_trending()

fails = []


def check(name, cond):
    print(("  PASS  " if cond else "  FAIL  ") + name)
    if not cond:
        fails.append(name)


# --------------------------------------------------------------- mock server
class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence
        pass

    def do_POST(self):
        srv = self.server
        length = int(self.headers.get("Content-Length", 0) or 0)
        srv.bodies.append(self.rfile.read(length).decode("utf-8"))
        idx = srv.served
        srv.served += 1
        entry = srv.responses[idx] if idx < len(srv.responses) else srv.responses[-1]
        # entry is (status, body) or (status, body, {header: value})
        status, body = entry[0], entry[1]
        hdrs = entry[2] if len(entry) > 2 else {}
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for k, v in hdrs.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))


def start_server(responses):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    srv.responses = responses
    srv.bodies = []
    srv.served = 0
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/robot/send"


# ---------------------------------------------------- notify: sign / mask
url = "https://oapi.dingtalk.com/robot/send?access_token=abcd1234"
check("no secret -> url unchanged", notify._signed_url(url, "") == url)
check("non-dingtalk host -> url unchanged",
      notify._signed_url("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x", "s") ==
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x")

signed = notify._signed_url(url, "mysecret")
query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(signed).query))
check("dingtalk+secret adds timestamp+sign", "timestamp" in query and "sign" in query)
expect = base64.b64encode(
    hmac.new(b"mysecret", f"{query['timestamp']}\nmysecret".encode(),
             hashlib.sha256).digest()).decode()
check("sign matches URL-encoded HMAC-SHA256",
      query["sign"] == expect)  # parse_qsl already percent-decoded the value

# ------------------------------------------------------- notify: business ok
check("empty body -> ok", notify._business_ok("") == (True, ""))
check("non-json body -> ok", notify._business_ok("ok")[0] is True)
check("errcode 0 -> ok", notify._business_ok('{"errcode":0}')[0] is True)
ok0, why0 = notify._business_ok('{"errcode":310000,"errmsg":"sign not match"}')
check("errcode != 0 -> fail", ok0 is False and "310000" in why0)
check("code 0 -> ok", notify._business_ok('{"code":0}')[0] is True)
check("code != 0 -> fail", notify._business_ok('{"code":40001}')[0] is False)

# ------------------------------------------------------- notify: url masking
masked = notify._display_url(url)
check("display_url drops the query", "access_token" not in masked and masked.endswith("?…"))

# ------------------------------------------------------------- notify: markdown
md = "# 标题\n\n## 关注变化\n- 新增 `alice`：3\n* 取关 `bob`：1\n"
flat = notify.md_to_text(md)
check("md_to_text drops heading markers", "#" not in flat)
check("md_to_text converts bullets", "· 新增 alice：3" in flat and "· 取关 bob：1" in flat)
check("md_to_text strips backticks", "`" not in flat)

# --------------------------------------------------- notify: send_text e2e
srv, hook = start_server([(200, '{"errcode":0,"errmsg":"ok"}')])
ok, msg = notify.send_text("hi", url=hook, secret="", retries=1)
check("send_text success -> ok", ok is True)
check("send_text posts text payload",
      srv.bodies and '"msgtype": "text"' in srv.bodies[0].replace("\n", " "))
srv.shutdown()

# 500 then 200: transport failure is retried (delay 0 in test)
srv, hook = start_server([(500, "boom"), (200, '{"errcode":0}')])
ok, msg = notify.send_text("hi", url=hook, secret="", retries=2, retry_delay=0)
check("send_text retries 5xx then succeeds", ok is True and srv.served == 2)
srv.shutdown()

# business error: no retry, fails immediately
srv, hook = start_server([(200, '{"errcode":310000,"errmsg":"sign not match"}')])
ok, msg = notify.send_text("hi", url=hook, secret="", retries=3, retry_delay=0)
check("send_text business error fails without retry", ok is False and srv.served == 1)
srv.shutdown()

# not configured
ok, msg = notify.send_text("hi", url="", secret="", retries=1)
check("send_text without url -> fail", ok is False)

# keyword: prepended to body so keyword-secured robots accept the push
srv, hook = start_server([(200, '{"errcode":0}')])
ok, msg = notify.send_text("每日摘要", url=hook, secret="", keyword="GitHub", retries=1)
body = json.loads(srv.bodies[0])
check("send_text prepends missing keyword",
      body["text"]["content"].startswith("【GitHub】") and "每日摘要" in body["text"]["content"])
# keyword already present in body -> not duplicated
srv, hook = start_server([(200, '{"errcode":0}')])
ok, msg = notify.send_text("【GitHub】每日摘要", url=hook, secret="", keyword="GitHub", retries=1)
body = json.loads(srv.bodies[0])
check("send_text does not duplicate present keyword",
      body["text"]["content"].count("【GitHub】") == 1)
srv.shutdown()

# 429 (no Retry-After): transport-layer retry path, instant delays
srv, hook = start_server([(429, '{"errcode":0}'), (200, '{"errcode":0}')])
ok, msg = notify.send_text("hi", url=hook, secret="", retries=2, retry_delay=0)
check("send_text retries 429 then succeeds", ok is True and srv.served == 2)
srv.shutdown()

# ------------------------------------------------- retry delay policy (pure)
check("_retry_after honours short Retry-After",
      notify._retry_after({"Retry-After": "5"}, 30.0, 1) == 5.0)
check("_retry_after caps hostile Retry-After to backoff",
      notify._retry_after({"Retry-After": "99"}, 30.0, 2) == 60.0)
check("_retry_after no header -> linear backoff",
      notify._retry_after({}, 3.0, 1) == 3.0)
check("_retry_after bad header -> linear backoff",
      notify._retry_after({"Retry-After": "zzz"}, 3.0, 1) == 3.0)

# ------------------------------------------------- trending: renderer helpers
check("fmt_stars 3412 -> 3.4k", tpush._fmt_stars(3412) == "3.4k")
check("fmt_stars 999 -> 999", tpush._fmt_stars(999) == "999")
check("since_days weekly -> 7", tpush._since_days("weekly") == 7)
check("valid lang Python", tpush._valid_lang("Python") is True)
check("invalid lang (space)", tpush._valid_lang("Py thon") is False)

payload = {
    "ok": True, "since": "daily", "lang": "Go", "count": 3,
    "generated_at": "2026-10-18", "owner": "",
    "items": [
        {"full_name": "a/b", "stars": 3412, "lang": "Go",
         "desc": "ENONLY", "desc_zh": "中文描述"},
        {"full_name": "c/d", "stars": 999, "lang": "", "desc": "only english"},
        {"full_name": "e/f", "stars": 50, "lang": "Go", "desc": "x"},
    ],
}
msg = tpush.render_message(payload, top=2)
check("render header has label+lang+date",
      "GitHub 趋势榜" in msg and "每日" in msg and "Go" in msg and "2026-10-18" in msg)
check("render prefers Chinese desc", "中文描述" in msg and "ENONLY" not in msg)
check("render falls back to English desc", "only english" in msg)
check("render respects top limit", "3. e/f" not in msg and "2. c/d" in msg)
check("render reports total", "共 3 项" in msg)

# owner scope shows in the header
msg2 = tpush.render_message({**payload, "owner": "acme"}, top=1)
check("render shows owner scope", "@acme" in msg2)

# -------------------------------------------------------------------------- done
print()
if fails:
    print("NOTIFY SELFTEST FAILED: %d" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("PASS  all notify/trending-push checks")
