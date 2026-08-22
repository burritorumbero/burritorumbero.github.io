#!/usr/bin/env bash
# Generate the cover variants a story page expects, from one source image.
#
#   ./tools/optimize-cover.sh stories/1kie/assets/cover.png
#
# Writes, next to the source:
#   cover-800.avif   cover-1200.avif   cover-1600.avif
#   cover-800.webp   cover-1200.webp   cover-1600.webp
#   cover-800.jpg    cover-1200.jpg    cover-1600.jpg   (opaque sources only)
#
# The filenames are what build-stories.py looks for — it scans the folder and
# writes <source> tags only for the formats it finds, so generating just AVIF
# and WebP is fine. Transparent art deliberately gets no JPEG: JPEG has no
# alpha channel and would fill the transparency with black.
#
# Source should be 16:9 and at least 1600px wide. Needs ImageMagick 7.

set -euo pipefail

SRC="${1:?Usage: optimize-cover.sh stories/<name>/assets/<file>.png}"
DIR="$(dirname "$SRC")"
WIDTHS=(800 1200 1600)

# Warn if the aspect ratio isn't 16:9 — the card crops to that shape.
RATIO=$(magick identify -format '%[fx:w/h]' "$SRC")
if (($(echo "$RATIO < 1.7 || $RATIO > 1.8" | bc -l))); then
  echo "! ${SRC} is ${RATIO}:1, not 16:9 (1.78). It will be letterboxed in the card."
fi

HAS_ALPHA=$(magick identify -format '%A' "$SRC")

# Write a file, then confirm it really is the format we asked for. Some
# ImageMagick builds ship without an AVIF *encoder*: they print a warning,
# write a file anyway, and you end up serving a .avif the browser can't
# decode — a broken image with no obvious cause.
emit() { # emit <output-path> <expected-format> <magick args...>
  local out="$1" want="$2"
  shift 2
  magick "$SRC" "$@" "$out" 2>/dev/null || true
  if [ ! -s "$out" ] || [ "$(magick identify -format '%m' "$out" 2>/dev/null)" != "$want" ]; then
    rm -f "$out"
    return 1
  fi
}

MISSING_AVIF=0

for W in "${WIDTHS[@]}"; do
  emit "$DIR/cover-${W}.avif" AVIF -resize "${W}x" -strip -quality 50 || MISSING_AVIF=1
  emit "$DIR/cover-${W}.webp" WEBP -resize "${W}x" -strip -quality 72 -define webp:method=6 ||
    echo "! WebP encoding failed at ${W}px"

  if [ "$HAS_ALPHA" = "False" ]; then
    emit "$DIR/cover-${W}.jpg" JPEG -resize "${W}x" -strip -quality 80 -interlace Plane \
      -sampling-factor 4:2:0 || echo "! JPEG encoding failed at ${W}px"
  fi
done

if [ "$MISSING_AVIF" = "1" ]; then
  echo "! Your ImageMagick cannot encode AVIF, so no .avif files were written."
  echo "  WebP alone is fine — the build only advertises formats it finds."
  echo "  For AVIF: brew install imagemagick / apt install libheif-examples,"
  echo "  or convert at squoosh.app and save as cover-800.avif etc."
fi

if [ "$HAS_ALPHA" != "False" ]; then
  echo "  (transparent source — skipped JPEG so the background stays clear)"
fi

echo
echo "Source: $(du -h "$SRC" | cut -f1)"
ls -1S "$DIR"/cover-*.{avif,webp,jpg} 2>/dev/null | while read -r f; do
  printf "  %-24s %s\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
echo
echo "Keep the original out of the repo, then rebuild:"
echo "  python3 tools/build-stories.py && python3 tools/build-shell.py"
