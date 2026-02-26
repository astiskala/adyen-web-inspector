#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: zip command not found." >&2
  exit 1
fi

pnpm build

mkdir -p release
VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")"
ARCHIVE_PATH="release/adyen-web-inspector-v${VERSION}.zip"

rm -f "$ARCHIVE_PATH"
(
  cd dist
  zip -rq "../$ARCHIVE_PATH" .
)

echo "Created Chrome Web Store upload package: $ARCHIVE_PATH"
