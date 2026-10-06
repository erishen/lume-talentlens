#!/usr/bin/env bash
# build-ui.sh — bundle the React dashboard/agent UI with esbuild.
#
# The Lume research tree ships a working node_modules (react, react-dom,
# esbuild, typescript). We symlink it into frontend/node_modules and run the
# standalone esbuild binary (node itself is not required — esbuild is a
# native binary that resolves "react" via frontend/node_modules).
#
# Output: ../www/github/app.js  (the Lume views dir is a virtual root, so
# the bundle is served at /app.js).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FE="$ROOT/frontend"
LUME_NM="$ROOT/../research/lume/frontend/node_modules"

cd "$FE"

# 1) ensure node_modules is present (link the framework's copy if missing)
if [ ! -e node_modules/react ]; then
  if [ ! -d "$LUME_NM" ]; then
    echo "build-ui: $LUME_NM not found — run pnpm install in research/lume/frontend" >&2
    exit 1
  fi
  ln -sfn "$LUME_NM" node_modules
  echo "build-ui: linked node_modules -> $LUME_NM"
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
