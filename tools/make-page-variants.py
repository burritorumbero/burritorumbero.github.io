#!/usr/bin/env python3
"""
make-page-variants.py — responsive versions of every comic page.

Comic pages are the heaviest thing on the site: a full-resolution PNG can be
tens of megabytes, and the reader has to fetch a whole one before showing
anything. This writes a set of narrower AVIF/WebP copies so the browser can
pick a size that matches the screen — a phone gets roughly a tenth of what a
desktop does, and neither downloads the original.

    gallery/<name>/pages/7.png
      -> gallery/<name>/pages/variants/7-960.avif   (and .webp)
      -> gallery/<name>/pages/variants/7-1440.avif
      -> gallery/<name>/pages/variants/7-1920.avif
      -> gallery/<name>/pages/variants/7-2560.avif

Widths wider than the source are skipped (never upscale). Unchanged sources
are skipped via a content-hash manifest, so re-runs are cheap even in CI where
every file looks freshly modified. Variants whose source is gone are deleted.

    pip install pillow
    python3 tools/make-page-variants.py
"""

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

from buildlib import pick_page_files

ROOT = Path(__file__).resolve().parent.parent
GALLERY = ROOT / "gallery"

# Roughly: phone, tablet/small laptop, laptop, large/retina.
WIDTHS = (960, 1440, 1920, 2560)

# (extension, PIL format, save kwargs). AVIF first — it is what the reader
# prefers when the browser supports it.
FORMATS = [
    ("avif", "AVIF", {"quality": 55}),
    ("webp", "WEBP", {"quality": 80, "method": 6}),
]

PAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".avif")


def source_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def build() -> int:
    made = kept = removed = 0
    saved_bytes = 0

    for pages_dir in sorted(GALLERY.glob("*/pages")):
        variants_dir = pages_dir / "variants"
        variants_dir.mkdir(exist_ok=True)

        manifest_path = variants_dir / ".manifest.json"
        manifest = {}
        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text())
            except json.JSONDecodeError:
                manifest = {}

        sources = pick_page_files(pages_dir)

        if sources:
            print(f"  {pages_dir.parent.name}: {len(sources)} page(s)")

        for stem, src in sorted(sources.items(), key=lambda kv: int(kv[0])):
            digest = source_hash(src)
            expected = []

            with Image.open(src) as im:
                usable = [w for w in WIDTHS if w <= im.width] or [im.width]
                for w in usable:
                    for ext, _, _ in FORMATS:
                        expected.append(variants_dir / f"{stem}-{w}.{ext}")

                if manifest.get(stem) == digest and all(p.is_file() for p in expected):
                    kept += 1
                    continue

                im = im.convert("RGB") if im.mode not in ("RGB", "RGBA") else im
                for w in usable:
                    resized = im if w == im.width else im.resize(
                        (w, round(im.height * w / im.width)), Image.LANCZOS)
                    for ext, fmt, opts in FORMATS:
                        out = variants_dir / f"{stem}-{w}.{ext}"
                        try:
                            resized.save(out, fmt, **opts)
                        except Exception as exc:
                            print(f"    ! {out.name}: {exc}")
                            out.unlink(missing_ok=True)

            biggest = variants_dir / f"{stem}-{max(usable)}.avif"
            if biggest.is_file():
                saved_bytes += src.stat().st_size - biggest.stat().st_size

            manifest[stem] = digest
            made += 1
            print(f"    → {stem}: {len(usable)} width(s) × {len(FORMATS)} format(s)")

        # drop variants whose source no longer exists
        for out in variants_dir.glob("*.*"):
            if out.name == ".manifest.json":
                continue
            stem = out.stem.rsplit("-", 1)[0]
            if stem not in sources:
                out.unlink()
                manifest.pop(stem, None)
                removed += 1

        manifest_path.write_text(json.dumps(manifest, indent=0, sort_keys=True))

    print(f"\n{made} page(s) converted, {kept} unchanged, {removed} stale file(s) removed.")
    if saved_bytes > 0:
        print(f"Largest variant is {saved_bytes / 1e6:.0f} MB lighter than the "
              f"originals in total.")
    return 0


if __name__ == "__main__":
    sys.exit(build())
