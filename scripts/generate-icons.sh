#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIGHT_LOGO="$ROOT_DIR/branding/logo-light-bg.svg"
DARK_LOGO="$ROOT_DIR/branding/logo-dark-bg.svg"
OUT_DIR="$ROOT_DIR/public/assets"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Error: rsvg-convert is required. Install librsvg first." >&2
  exit 1
fi

for logo in "$LIGHT_LOGO" "$DARK_LOGO"; do
  if [[ ! -f "$logo" ]]; then
    echo "Error: logo source not found: $logo" >&2
    exit 1
  fi
done

mkdir -p "$OUT_DIR"

for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" "$LIGHT_LOGO" -o "$OUT_DIR/icon-$size.png"
  rsvg-convert -w "$size" -h "$size" "$DARK_LOGO" -o "$OUT_DIR/icon-dark-$size.png"
done

echo "Generated extension icons:"
echo "  Light: $OUT_DIR/icon-{16,32,48,128}.png"
echo "  Dark:  $OUT_DIR/icon-dark-{16,32,48,128}.png"
