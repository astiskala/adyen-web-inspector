#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIGHT_LOGO="${1:-$ROOT_DIR/branding/logo-light-bg.svg}"
OUT_DIR="$ROOT_DIR/public/assets"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Error: rsvg-convert is required. Install librsvg first." >&2
  exit 1
fi

if [[ ! -f "$LIGHT_LOGO" ]]; then
  echo "Error: logo source not found: $LIGHT_LOGO" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" "$LIGHT_LOGO" -o "$OUT_DIR/icon-$size.png"
done

echo "Generated extension icons from: $LIGHT_LOGO"
echo "Output: $OUT_DIR/icon-{16,32,48,128}.png"
