#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGO="$ROOT_DIR/branding/inspector-mark.svg"
OUT_DIR="$ROOT_DIR/public/assets"
STORE_ICON="$ROOT_DIR/store-assets/chrome-store-icon-128.png"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Error: rsvg-convert is required. Install librsvg first." >&2
  exit 1
fi

if [[ ! -f "$LOGO" ]]; then
  echo "Error: logo source not found: $LOGO" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

for size in 16 32 48; do
  rsvg-convert -w "$size" -h "$size" "$LOGO" -o "$OUT_DIR/icon-$size.png"
done

# Chrome uses a 96px mark with 16px transparent padding in the 128px icon.
rsvg-convert -w 96 -h 96 --page-width 128 --page-height 128 --top 16 --left 16 \
  "$LOGO" -o "$OUT_DIR/icon-128.png"
cp "$OUT_DIR/icon-128.png" "$STORE_ICON"

echo "Generated extension icons in $OUT_DIR and the store icon at $STORE_ICON"
