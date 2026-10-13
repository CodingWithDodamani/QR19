#!/usr/bin/env bash
#
# Builds public/qr19-source-code.zip — the shareable QR19 source archive
# served by the "Download source code" button in the footer.
#
# The archive contains only what the app needs to run anywhere:
#   src/ prisma/ public/ docs/ scripts/ db/.gitkeep, all config files,
#   package.json + bun.lock, README.md and .env.example.
#
# It never contains: node_modules, build output, the local SQLite database,
# the real .env (secrets), logs or sandbox infrastructure folders.
#
# Usage: bash scripts/export-source.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="qr19"
DEST="public/qr19-source-code.zip"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

mkdir -p "$STAGING/$NAME"

rsync -a \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dev.log' \
  --exclude 'server.log' \
  --exclude 'db/custom.db' \
  --exclude 'db/custom.db-journal' \
  --exclude 'public/qr19-source-code.zip' \
  --exclude 'tool-results' \
  --exclude 'agent-ctx' \
  --exclude '.zscripts' \
  --exclude 'examples' \
  --exclude 'skills' \
  --exclude 'tests' \
  --exclude 'mini-services' \
  --exclude 'download' \
  --exclude 'upload' \
  --exclude 'Caddyfile' \
  --exclude 'worklog.md' \
  src prisma public docs scripts db \
  package.json bun.lock tsconfig.json next.config.ts postcss.config.mjs \
  eslint.config.mjs components.json tailwind.config.ts next-env.d.ts \
  .gitignore README.md .env.example \
  "$STAGING/$NAME/"

mkdir -p "$ROOT/public"
rm -f "$ROOT/$DEST"
(cd "$STAGING" && zip -qr9 "$ROOT/$DEST" "$NAME")

# Second pass: include the freshly built archive inside itself so the
# footer "Download source code" button works out of the box in any
# extracted copy (the inner archive is a complete, zip-free snapshot).
# Regenerating with this script always produces a fresh, consistent build.
cp "$ROOT/$DEST" "$STAGING/$NAME/public/"
rm -f "$ROOT/$DEST"
(cd "$STAGING" && zip -qr9 "$ROOT/$DEST" "$NAME")

echo "Built $DEST ($(du -h "$DEST" | cut -f1), $(unzip -l "$DEST" | tail -1 | awk '{print $2}') files)"
