#!/usr/bin/env python3
"""
make-thumbnails.py — build browse-grid thumbnails for every comic.

Scans gallery/*/pages/ for numerically-named images and writes a WebP
thumbnail for each into gallery/*/pages/thumbnails/, keeping the same name
(1.png -> thumbnails/1.webp). Existing thumbnails are only rebuilt when the
source image's content changed, and thumbnails whose source is gone are
deleted, so the folder always mirrors pages/.

Runs in the GitHub Action on every push that touches pages/, and can be run
locally too:

    pip install pillow
    python3 tools/make-thumbnails.py
"""

import hashlib
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GALLERY = ROOT / "gallery"

THUMB_WIDTH = 480
THUMB_QUALITY = 78
PAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".avif")


def source_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def build() -> int:
    made = removed = kept = 0

    for pages_dir in sorted(GALLERY.glob("*/pages")):
        thumbs_dir = pages_dir / "thumbnails"
        thumbs_dir.mkdir(exist_ok=True)

        # .manifest.json remembers each source's content hash, so unchanged
        # images are skipped even on a fresh CI checkout (where file mtimes
        # are useless — every file looks newly modified).
        manifest_path = thumbs_dir / ".manifest.json"
        manifest = {}
        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text())
            except json.JSONDecodeError:
                manifest = {}

        sources = {
            f.stem: f for f in pages_dir.iterdir()
            if f.is_file() and f.suffix.lower() in PAGE_EXTS
            and re.fullmatch(r"\d+", f.stem)
        }

        # build / refresh
        for stem, src in sorted(sources.items(), key=lambda kv: int(kv[0])):
            out = thumbs_dir / f"{stem}.webp"
            digest = source_hash(src)

            entry = manifest.get(stem)
            if out.is_file() and isinstance(entry, dict) and entry.get("hash") == digest:
                kept += 1
                continue

            with Image.open(src) as im:
                im = im.convert("RGBA") if im.mode in ("P", "LA") else im
                ratio = THUMB_WIDTH / im.width
                if ratio < 1:
                    im = im.resize((THUMB_WIDTH, round(im.height * ratio)),
                                   Image.LANCZOS)
                im.save(out, "WEBP", quality=THUMB_QUALITY, method=6)
                size = [im.width, im.height]

            # Dimensions are recorded so build-gallery.py can set the grid's
            # aspect ratio without needing Pillow itself.
            manifest[stem] = {"hash": digest, "size": size}
            made += 1
            print(f"  → {out.relative_to(ROOT)}")

        # remove orphans
        for out in thumbs_dir.glob("*.webp"):
            if out.stem not in sources:
                out.unlink()
                manifest.pop(out.stem, None)
                removed += 1
                print(f"  ✗ {out.relative_to(ROOT)} (source gone)")

        manifest_path.write_text(json.dumps(manifest, indent=0, sort_keys=True))

    print(f"\n{made} thumbnail(s) built, {kept} unchanged, {removed} removed.")
    return 0


if __name__ == "__main__":
    sys.exit(build())
