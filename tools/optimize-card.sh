#!/usr/bin/env bash
# One image in, two web-ready variants out, keeping the original's name.
#
#   ./tools/optimize-card.sh stories/art/sundays.png
#   ./tools/optimize-card.sh stories/art/sundays.png 1600   # custom max width
#
# Writes, beside the source:
#   sundays.avif
#   sundays.webp
#
# No JPEG: this is for the transparent 16:9 card art in stories/art/, and JPEG
# has no alpha channel — it would fill the transparency with black. Both AVIF
# and WebP keep it.
#
# Needs ImageMagick. Uses `magick` (v7) if present, else `convert` (v6).

set -euo pipefail

SRC="${1:?Usage: optimize-card.sh <image> [max-width]}"
MAXW="${2:-1200}"

[ -f "$SRC" ] || {
  echo "No such file: $SRC"
  exit 1
}

if command -v magick >/dev/null 2>&1; then
  IM="magick"
  IDENTIFY="magick identify"
else
  IM="convert"
  IDENTIFY="identify"
fi

BASE="${SRC%.*}"

# Write, then confirm the result really is the format requested. Some
# ImageMagick builds can read AVIF but not write it: they print a warning,
# leave a file behind anyway, and you end up serving an .avif no browser can
# decode — a broken image with no obvious cause.
emit() { # emit <output> <expected-format> <args...>
  local out="$1" want="$2"
  shift 2
  $IM "$SRC" "$@" "$out" 2>/dev/null || true
  if [ ! -s "$out" ] || [ "$($IDENTIFY -format '%m' "$out" 2>/dev/null)" != "$want" ]; then
    rm -f "$out"
    return 1
  fi
}

# -resize "${MAXW}x>" only shrinks; a source already narrower is left alone.
emit "${BASE}.avif" AVIF -resize "${MAXW}x>" -strip -quality 50 || {
  echo "! Your ImageMagick cannot encode AVIF — no .avif written."
  echo "  WebP alone works fine. For AVIF: brew install imagemagick,"
  echo "  apt install libheif-examples, or use squoosh.app."
}

emit "${BASE}.webp" WEBP -resize "${MAXW}x>" -strip -quality 75 -define webp:method=6 ||
  {
    echo "! WebP encoding failed."
    exit 1
  }

printf '\n  %-28s %s\n' "$(basename "$SRC") (source)" "$(du -h "$SRC" | cut -f1)"
for f in "${BASE}.avif" "${BASE}.webp"; do
  [ -f "$f" ] && printf '  %-28s %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
echo
echo "Point the card at the .webp (or use a <picture> with both), then move"
echo "the source out of the repo."
