#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGO="$ROOT_DIR/branding/logo-light-bg.svg"
OUT_DIR="$ROOT_DIR/public/assets"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Error: rsvg-convert is required. Install librsvg first." >&2
  exit 1
fi

if [[ ! -f "$LOGO" ]]; then
  echo "Error: logo source not found: $LOGO" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" "$LOGO" -o "$OUT_DIR/icon-$size.png"
done

echo "Generated extension icons: $OUT_DIR/icon-{16,32,48,128}.png"
