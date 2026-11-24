#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: zip command not found." >&2
  exit 1
fi

pnpm build

# The Chrome Web Store reads the manifest version, so the package is named after it.
VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync('dist/manifest.json', 'utf8')).version")"
PACKAGE_VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")"
if [ "$VERSION" != "$PACKAGE_VERSION" ]; then
  echo "Error: manifest version $VERSION does not match package.json version $PACKAGE_VERSION." >&2
  exit 1
fi

mkdir -p release
ARCHIVE_PATH="release/adyen-web-inspector-v${VERSION}.zip"

# Reproducible archive: fixed timestamps (SOURCE_DATE_EPOCH, else the last
# commit's time), sorted entries, and no extra file attributes or directory entries.
EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || echo 315532800)}"
node -e '
  const { readdirSync, utimesSync } = require("node:fs");
  const { join } = require("node:path");
  const epoch = Number(process.argv[1]);
  for (const entry of readdirSync("dist", { recursive: true })) utimesSync(join("dist", entry), epoch, epoch);
  utimesSync("dist", epoch, epoch);
' "$EPOCH"

rm -f "$ARCHIVE_PATH"
(
  cd dist
  find . -type f | LC_ALL=C sort | zip -qX -D "../$ARCHIVE_PATH" -@
)

echo "Created Chrome Web Store upload package: $ARCHIVE_PATH"
