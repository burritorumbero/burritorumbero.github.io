#!/usr/bin/env python3
"""
build-stories.py — turn your writing into pages.

For every folder under stories/ that contains a story.json, this generates:

    stories/<name>/index.html                  the story landing page
    stories/<name>/chapters/<id>/index.html    one page per chapter draft

You maintain two things by hand:

  stories/<name>/story.json     title, genres, release, status, synopsis
  stories/<name>/drafts/*.txt   one chapter per file, with a small header

A chapter draft looks like this — header keys, a line with three dashes, then
the prose. Blank lines separate paragraphs:

    title: First Light
    published: 2026-08-14 18:00
    ---
    The city looked different from up here.

The filename becomes the URL: drafts/c001.txt -> chapters/c001/.
No HTML lives in this file — the markup is in tools/shell/*.j2.

    python3 tools/build-stories.py && python3 tools/build-shell.py
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from buildlib import (GENERATED_MARKER, ROOT, cover_data, find_mascot,
                      make_env, root_prefix, section_for, write_if_changed)

STORIES = ROOT / "stories"

VISIBLE_CHAPTERS = 9   # rows shown before "Show more"
MAX_GENRES = 5

DATE_FORMATS = ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M", "%Y-%m-%d")


def parse_draft(path: Path) -> dict:
    """Split a chapter .txt into its header keys and its paragraphs."""
    raw = path.read_text(encoding="utf-8")

    if "\n---" in raw:
        header_text, body = raw.split("\n---", 1)
        body = body.lstrip("-\n")
    else:
        header_text, body = "", raw

    meta = {}
    for line in header_text.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip().lower()] = value.strip()

    stamp = None
    for fmt in DATE_FORMATS:
        try:
            stamp = datetime.strptime(meta.get("published", ""), fmt)
            break
        except ValueError:
            continue

    if stamp is None:
        # No usable date: fall back to the file's own mtime so the chapter
        # still sorts sensibly instead of vanishing.
        stamp = datetime.fromtimestamp(path.stat().st_mtime)
        print(f"    ! {path.name}: no valid 'published:' date, using file mtime")

    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)

    return {
        "id": path.stem,
        "title": meta.get("title", path.stem),
        "published": stamp,
        "iso": stamp.isoformat(),
        "human": stamp.strftime("%d %b %Y"),
        "paragraphs": [p.strip() for p in re.split(r"\n\s*\n", body.strip()) if p.strip()],
    }


def build() -> int:
    env = make_env()
    story_tpl = env.get_template("story.html.j2")
    chapter_tpl = env.get_template("chapter.html.j2")
    redirect_tpl = env.get_template("redirect.html.j2")

    story_dirs = sorted(p.parent for p in STORIES.glob("*/story.json"))
    if not story_dirs:
        print("No stories found (looking for stories/*/story.json).")
        return 1

    written = 0

    for story_dir in story_dirs:
        meta = json.loads((story_dir / "story.json").read_text(encoding="utf-8"))
        drafts_dir = story_dir / "drafts"
        drafts = sorted(drafts_dir.glob("*.txt")) if drafts_dir.is_dir() else []

        print(f"  {story_dir.name}: {len(drafts)} chapter(s)")
        if len(meta.get("genres", [])) > MAX_GENRES:
            print(f"    ! more than {MAX_GENRES} genres, extras dropped")

        chapters = [parse_draft(d) for d in drafts]
        oldest_first = sorted(chapters, key=lambda c: c["published"])
        newest_first = list(reversed(oldest_first))

        story = {
            "title": meta.get("title", story_dir.name),
            "genres": meta.get("genres", [])[:MAX_GENRES],
            "release": meta.get("release", "—"),
            "status": meta.get("status", "Ongoing"),
            "synopsis": meta.get("synopsis", ""),
        }

        # This story's own mascot (assets/mascot.*), shown on the landing
        # page and every chapter. Falls back to the site mascot when absent.
        mascot = find_mascot(story_dir)
        mascot_rel = str(mascot.relative_to(ROOT)) if mascot else None

        def mascot_for(rel_page):
            return root_prefix(rel_page) + mascot_rel if mascot_rel else None

        rel = (story_dir / "index.html").relative_to(ROOT)
        page = story_tpl.render(
            title=f"{story['title']} — Burrito Rumbero",
            root=root_prefix(rel),
            section=section_for(rel),
            mascot_src=mascot_for(rel),
            story=story,
            chapters=newest_first,
            visible=VISIBLE_CHAPTERS,
            cover=cover_data(story_dir),
        )
        if write_if_changed(story_dir / "index.html", GENERATED_MARKER + "\n" + page):
            written += 1
            print(f"    → {rel}")

        for i, chapter in enumerate(oldest_first):
            out = story_dir / "chapters" / chapter["id"] / "index.html"
            rel = out.relative_to(ROOT)
            page = chapter_tpl.render(
                title=f"{chapter['title']} — {story['title']}",
                root=root_prefix(rel),
                section=section_for(rel),
                mascot_src=mascot_for(rel),
                story=story,
                chapter=chapter,
                prev=oldest_first[i - 1] if i > 0 else None,
                next=oldest_first[i + 1] if i < len(oldest_first) - 1 else None,
            )
            if write_if_changed(out, GENERATED_MARKER + "\n" + page):
                written += 1
                print(f"    → {rel}")

        # stories/<name>/latest -> the most recent chapter. Regenerated on
        # every build, so it always follows the newest published date.
        if newest_first:
            out = story_dir / "latest" / "index.html"
            page = redirect_tpl.render(
                title=f"Latest chapter — {story['title']}",
                target=f"../chapters/{newest_first[0]['id']}/index.html",
                kind="chapter",
            )
            if write_if_changed(out, GENERATED_MARKER + "\n" + page):
                written += 1
                print(f"    → {out.relative_to(ROOT)}")

    print(f"\n{written} file(s) written"
          f"{'' if written else ' — everything already up to date'}.")
    return 0


if __name__ == "__main__":
    sys.exit(build())
