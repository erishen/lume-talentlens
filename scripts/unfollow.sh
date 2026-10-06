#!/usr/bin/env bash
# Unfollow water-account candidates flagged by people-suspects.py.
# Requires a GitHub PAT with the 'user:follow' scope — the token is read from
# GH_TOKEN and is NEVER printed or written to disk.
#
# Usage:
#   GH_TOKEN=ghp_xxx bash scripts/unfollow.sh
#
# Exit 0 only when every account was either unfollowed (204) or not followed
# (404); any 401/403/other failure exits non-zero so you can inspect the output.
set -u

API="https://api.github.com/user/following"

# high-confidence water accounts (API-verified 2026-10-06)
#   pipiwork0007-ai  -> followers=1 repos=0, created 2026-05 (hard water account)
#   shinobi-coder701 / takumi-sato0209 / MaxCode917 -> 2600-4000 followers in 3-4 months
#   Lxcardoza993 / raviwijerathna1 -> borderline, kept per user choice
#   abdulwasio2521 -> 797 followers / 10 repos, looks like a real dev — consider removing
# API-confirmed 2026-10-06 (promoted from medium):
#   HEJustinSun (3367 fol / 1 repo in 6 weeks), irisdomain23 (705 fol in 1 month),
#   xcontcom (12772 fol), pwnedroot (7992 fol / 7 repos), jkdevcode (6541 fol),
#   webbrain-one (24555 repos — auto-commit farm)
LOGINS=(
  pipiwork0007-ai
  shinobi-coder701
  takumi-sato0209
  MaxCode917
  Lxcardoza993
  raviwijerathna1
  abdulwasio2521
  HEJustinSun
  irisdomain23
  xcontcom
  pwnedroot
  jkdevcode
  webbrain-one
  # medium: registered 2024+ only, no template-name pattern (user chose all 17)
  RichardTang-Aden
  bryanadenhq
  arielshakaramiro
  itzmitto
)

if [ -z "${GH_TOKEN:-}" ]; then
  echo "error: GH_TOKEN is not set. Create a classic PAT with the 'user:follow' scope, then:" >&2
  echo "  GH_TOKEN=ghp_xxx bash scripts/unfollow.sh" >&2
  exit 1
fi

ok=0; skip=0; fail=0
for login in "${LOGINS[@]}"; do
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    -X DELETE \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$API/$login") || true
  case "$code" in
    204) echo "  unfollowed       @$login";            ok=$((ok+1));;
    404) echo "  not following    @$login (skipped)";  skip=$((skip+1));;
    403) echo "  FAILED 403       @$login (rate limit or token lacks 'user:follow')"; fail=$((fail+1));;
    401) echo "  FAILED 401       @$login (token invalid or revoked)";                 fail=$((fail+1));;
    *)   echo "  FAILED $code     @$login";            fail=$((fail+1));;
  esac
  sleep 0.6
done

echo "done: $ok unfollowed, $skip already-not-following, $fail failed"
[ "$fail" -eq 0 ]
