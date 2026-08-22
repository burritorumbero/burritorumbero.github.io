#!/usr/bin/env bash
# Turn one oversized hero PNG into the resized AVIF / WebP / JPEG variants
# that index.html expects.
#
#   ./tools/optimize-hero.sh path/to/your-hero.png
#
# Needs ImageMagick 7 (`magick`) built with AVIF + WebP support:
#   macOS:  brew install imagemagick
#   Ubuntu: sudo apt install imagemagick libheif-examples webp
#
# Outputs into assets/: hero-1280 / hero-1920 / hero-2560 in .avif, .webp, .jpg

set -euo pipefail

SRC="${1:?Usage: optimize-hero.sh path/to/hero.png}"
OUT="$(dirname "$0")/../assets"
mkdir -p "$OUT"

# 21:9 source cropped to the ~2.7:1 the hero actually shows. Drop the -gravity
# line if you would rather keep the full frame and let CSS crop it.
for W in 1280 1920 2560; do
  echo "→ ${W}px"

  # AVIF: smallest, used by every current browser. q50 is visually clean for
  # a hero that also gets faded out toward the bottom.
  magick "$SRC" -resize "${W}x" -strip -quality 50 "$OUT/hero-${W}.avif"

  # WebP: fallback for older Safari/Edge.
  magick "$SRC" -resize "${W}x" -strip -quality 72 -define webp:method=6 \
    "$OUT/hero-${W}.webp"

  # JPEG: universal last resort.
  magick "$SRC" -resize "${W}x" -strip -quality 78 -interlace Plane \
    -sampling-factor 4:2:0 "$OUT/hero-${W}.jpg"
done

echo
echo "Original: $(du -h "$SRC" | cut -f1)"
ls -lh "$OUT"/hero-*.{avif,webp,jpg} 2>/dev/null | awk '{print $9, $5}'
echo
echo "Now update the width/height on the hero <img> in index.html to match"
echo "hero-2560's real dimensions, so the browser reserves the right space."
