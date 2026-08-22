#!/usr/bin/env bash
# Resize + convert the artwork that isn't the hero: entry thumbnails and story
# card art. Same idea as optimize-hero.sh, applied to a whole folder.
#
#   ./tools/optimize-art.sh assets/entries 1400 square
#   ./tools/optimize-art.sh stories/art    1600 wide
#
# Writes <name>.avif / .webp / .jpg next to the originals and leaves the
# originals alone, so move them out of the repo afterwards.
#
# Transparent art (story cards, mascot) must stay AVIF/WebP — JPEG has no alpha
# and would fill the transparency with black.

set -euo pipefail

DIR="${1:?Usage: optimize-art.sh <folder> <max-width> [square|wide]}"
MAXW="${2:-1400}"
SHAPE="${3:-square}"

shopt -s nullglob nocaseglob
FILES=("$DIR"/*.png "$DIR"/*.jpg "$DIR"/*.jpeg)
[ ${#FILES[@]} -eq 0 ] && { echo "No images in $DIR"; exit 1; }

for SRC in "${FILES[@]}"; do
  BASE="${SRC%.*}"
  # skip files we generated on a previous run
  case "$SRC" in *.avif|*.webp) continue ;; esac

  BEFORE=$(du -h "$SRC" | cut -f1)

  magick "$SRC" -resize "${MAXW}x${MAXW}>" -strip -quality 55 "${BASE}.avif"
  magick "$SRC" -resize "${MAXW}x${MAXW}>" -strip -quality 75 -define webp:method=6 "${BASE}.webp"

  # JPEG fallback only for opaque art. Detect alpha before writing one.
  if [ "$(magick identify -format '%A' "$SRC")" = "False" ]; then
    magick "$SRC" -resize "${MAXW}x${MAXW}>" -strip -quality 80 -interlace Plane \
      -sampling-factor 4:2:0 "${BASE}.jpg"
  fi

  AFTER=$(du -h "${BASE}.avif" | cut -f1)
  echo "$(basename "$SRC"): $BEFORE → $AFTER (avif)"
done

echo
echo "Now point the <img> tags at the new files. For transparent art use a"
echo "<picture> with avif + webp sources and no jpg fallback."
