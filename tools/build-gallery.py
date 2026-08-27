#!/usr/bin/env python3
"""
build-gallery.py — turn folders of comic pages into reader pages.

For every folder under gallery/ that contains a gallery.json, this generates:

    gallery/<name>/index.html         landing page (cover, genres, buttons)
    gallery/<name>/read/index.html    fullscreen reader (Start Comic)
    gallery/<name>/browse/index.html  thumbnail grid (Browse Comic)

You maintain:

  gallery/<name>/gallery.json   title, genres, release, status, synopsis
  gallery/<name>/pages/         1.png, 2.png, … — the comic itself, in order
  gallery/<name>/assets/        cover-800/1200/1600 variants (optimize-cover.sh)

Thumbnails live in gallery/<name>/pages/thumbnails/ and are produced by
tools/make-thumbnails.py (run automatically by the GitHub Action). Pages whose
thumbnail is missing still work in the reader; the browse grid falls back to
the original image for them, which is slower but never broken.

    python3 tools/build-gallery.py && python3 tools/build-shell.py
"""

import json
import re
import sys
from pathlib import Path

from buildlib import (GALLERY_MARKER, ROOT, cover_data, make_env,
                      pick_page_files, root_prefix, section_for,
                      write_if_changed)

GALLERY = ROOT / "gallery"
PAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".avif")
BROWSE_BATCH = 12   # thumbnails revealed per scroll batch
MAX_GENRES = 5


VARIANT_WIDTHS = (960, 1440, 1920, 2560)
VARIANT_FORMATS = ("avif", "webp")


def page_variants(pages_dir: Path, stem: str) -> dict:
    """srcset strings per format for one page, from files that exist.

    Paths are relative to the reader page (gallery/<name>/read/), which is why
    they start with ../pages/.
    """
    variants_dir = pages_dir / "variants"
    out = {}
    for ext in VARIANT_FORMATS:
        entries = [
            f"../pages/variants/{stem}-{w}.{ext} {w}w"
            for w in VARIANT_WIDTHS
            if (variants_dir / f"{stem}-{w}.{ext}").is_file()
        ]
        if entries:
            out[ext] = ", ".join(entries)
    return out


def list_pages(comic_dir: Path) -> list:
    """Numerically-named images in pages/, sorted 1, 2, … 10 (not 1, 10, 2)."""
    pages_dir = comic_dir / "pages"
    if not pages_dir.is_dir():
        return []

    # One file per page *number* — 1.png and 1.webp are the same page in two
    # formats, and only the preferred one is served.
    found = list(pick_page_files(pages_dir).values())

    thumbs = comic_dir / "pages" / "thumbnails"

    # Thumbnail dimensions come from the manifest make-thumbnails.py writes,
    # so the browse grid matches the comic's real page shape (landscape,
    # portrait or square) instead of assuming one.
    sizes = {}
    manifest_path = thumbs / ".manifest.json"
    if manifest_path.is_file():
        try:
            for stem, entry in json.loads(manifest_path.read_text()).items():
                if isinstance(entry, dict) and entry.get("size"):
                    sizes[stem] = entry["size"]
        except json.JSONDecodeError:
            pass

    pages = []
    for f in sorted(found, key=lambda p: int(p.stem)):
        thumb = thumbs / f"{f.stem}.webp"
        pages.append({
            "number": int(f.stem),
            "file": f.name,
            # Browse falls back to the original if the thumbnail isn't built
            # yet — slower, but never a broken image.
            "thumb": thumb.name if thumb.is_file() else f"../{f.name}",
            "thumb_w": sizes.get(f.stem, [480, 720])[0],
            "thumb_h": sizes.get(f.stem, [480, 720])[1],
            # Reader falls back to the original the same way.
            "variants": page_variants(pages_dir, f.stem),
        })
    return pages


def build() -> int:
    env = make_env()
    landing_tpl = env.get_template("gallery.html.j2")
    reader_tpl = env.get_template("reader.html.j2")
    browse_tpl = env.get_template("browse.html.j2")

    comic_dirs = sorted(p.parent for p in GALLERY.glob("*/gallery.json"))
    if not comic_dirs:
        print("No comics found (looking for gallery/*/gallery.json).")
        return 1

    written = 0

    def emit(path: Path, page: str):
        nonlocal written
        if write_if_changed(path, GALLERY_MARKER + "\n" + page):
            written += 1
            print(f"    → {path.relative_to(ROOT)}")

    for comic_dir in comic_dirs:
        meta = json.loads((comic_dir / "gallery.json").read_text(encoding="utf-8"))
        pages = list_pages(comic_dir)

        print(f"  {comic_dir.name}: {len(pages)} page(s)")
        if len(meta.get("genres", [])) > MAX_GENRES:
            print(f"    ! more than {MAX_GENRES} genres, extras dropped")
        missing = sum(1 for p in pages if p["thumb"].startswith("../"))
        if missing:
            print(f"    ! {missing} page(s) have no thumbnail yet "
                  f"(run tools/make-thumbnails.py)")
        no_variants = sum(1 for p in pages if not p["variants"])
        if no_variants:
            print(f"    ! {no_variants} page(s) have no resized variants — the "
                  f"reader will serve the full-size originals "
                  f"(run tools/make-page-variants.py)")

        comic = {
            "title": meta.get("title", comic_dir.name),
            "genres": meta.get("genres", [])[:MAX_GENRES],
            "release": meta.get("release", "—"),
            "status": meta.get("status", "Ongoing"),
            "synopsis": meta.get("synopsis", ""),
        }

        rel = (comic_dir / "index.html").relative_to(ROOT)
        emit(comic_dir / "index.html", landing_tpl.render(
            title=f"{comic['title']} — Burrito Rumbero",
            root=root_prefix(rel), section=section_for(rel),
            comic=comic, pages=pages, cover=cover_data(comic_dir),
        ))

        if not pages:
            continue

        rel = (comic_dir / "read" / "index.html").relative_to(ROOT)
        emit(comic_dir / "read" / "index.html", reader_tpl.render(
            title=f"Read {comic['title']} — Burrito Rumbero",
            root=root_prefix(rel), section=section_for(rel),
            comic=comic,
            pages=[{"n": p["number"], "src": "../pages/" + p["file"],
                    "v": p["variants"]} for p in pages],
        ))

        rel = (comic_dir / "browse" / "index.html").relative_to(ROOT)
        emit(comic_dir / "browse" / "index.html", browse_tpl.render(
            title=f"Browse {comic['title']} — Burrito Rumbero",
            root=root_prefix(rel), section=section_for(rel),
            comic=comic, pages_desc=list(reversed(pages)), batch=BROWSE_BATCH,
        ))

    print(f"\n{written} file(s) written"
          f"{'' if written else ' — everything already up to date'}.")
    return 0


if __name__ == "__main__":
    sys.exit(build())
