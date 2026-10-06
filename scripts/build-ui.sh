#!/usr/bin/env bash
# build-ui.sh — bundle the React dashboard/agent UI with esbuild.
#
# frontend is pnpm-managed (pnpm install creates its own node_modules with a
# virtual store); esbuild resolves "react" via frontend/node_modules and is
# invoked as the standalone native binary (node itself is not required).
#
# Output: ../www/github/app.js  (the Lume views dir is a virtual root, so
# the bundle is served at /app.js).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FE="$ROOT/frontend"

cd "$FE"

# 1) ensure dependencies are installed (frontend owns its node_modules — do
#    NOT fall back to symlinking the research tree's copy)
if [ ! -e node_modules/react ]; then
  echo "build-ui: frontend/node_modules missing — run: (cd frontend && pnpm install)" >&2
  exit 1
fi

# 2) locate esbuild (native binary inside the linked node_modules)
ESB="$FE/node_modules/.bin/esbuild"
[ -x "$ESB" ] || { echo "build-ui: esbuild not found at $ESB" >&2; exit 1; }

echo "build-ui: $ESB src/main.tsx -> ../www/github/app.js"
"$ESB" src/main.tsx \
  --bundle --minify --format=esm --jsx=automatic \
  --outfile=../www/github/app.js

# 3) cache-bust: stamp a fresh version into the HTML shells so the browser
#    picks up this bundle (they reference /app.js?v=<ts> and /app.css?v=<ts>).
#    Match up to the closing quote so a stale suffix (e.g. an earlier manual
#    "BUILD" stamp) can't survive the replacement.
V="$(date +%s)"
for page in index.html chat.html; do
  f="$ROOT/www/github/$page"
  [ -f "$f" ] || continue
  sed -i.bak "s/\.js?v=[^\"']*/.js?v=$V/; s/\.css?v=[^\"']*/.css?v=$V/" "$f"
  rm -f "$f.bak"
done
echo "build-ui: done ($(wc -c < ../www/github/app.js | tr -d ' ') bytes, ?v=$V)"
