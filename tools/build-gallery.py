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
                      root_prefix, section_for, write_if_changed)

GALLERY = ROOT / "gallery"
PAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".avif")
BROWSE_BATCH = 12   # thumbnails revealed per scroll batch
MAX_GENRES = 5


def list_pages(comic_dir: Path) -> list:
    """Numerically-named images in pages/, sorted 1, 2, … 10 (not 1, 10, 2)."""
    pages_dir = comic_dir / "pages"
    if not pages_dir.is_dir():
        return []

    found = []
    for f in pages_dir.iterdir():
        if not f.is_file() or f.suffix.lower() not in PAGE_EXTS:
            continue
        if not re.fullmatch(r"\d+", f.stem):
            print(f"    ! pages/{f.name}: name isn't a number, skipped")
            continue
        found.append(f)

    thumbs = comic_dir / "pages" / "thumbnails"
    pages = []
    for f in sorted(found, key=lambda p: int(p.stem)):
        thumb = thumbs / f"{f.stem}.webp"
        pages.append({
            "number": int(f.stem),
            "file": f.name,
            # Browse falls back to the original if the thumbnail isn't built
            # yet — slower, but never a broken image.
            "thumb": thumb.name if thumb.is_file() else f"../{f.name}",
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
            comic=comic, pages=[p["file"] for p in pages],
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
