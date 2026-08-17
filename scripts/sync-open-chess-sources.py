#!/usr/bin/env python3
"""Download reproducible, attribution-preserving open chess reference sources."""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_LIBRARY_ROOT = Path.home() / "Documents" / "EnCroissant" / "AI Chess Coach Library"
WIKIBOOK_API = "https://en.wikibooks.org/w/api.php"
WIKIBOOK_ROOT = "Chess Opening Theory"
CAPABLANCA_TEXT = "https://www.gutenberg.org/cache/epub/33870/pg33870.txt"
USER_AGENT = (
    "EnCroissantPrivateCoach/1.0 "
    "(https://github.com/loxtyrrell03/en-croissant; private lawful corpus builder)"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_json(url: str) -> dict:
    for attempt in range(7):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Accept-Encoding": "identity",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 6:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2 ** attempt
            print(
                f"Wikibooks API returned {error.code}; retrying in {min(60.0, max(1.0, delay)):.0f}s",
                flush=True,
            )
            time.sleep(min(60.0, max(1.0, delay)))
    raise RuntimeError("Wikibooks API retry loop exited unexpectedly")


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def sync_wikibook(output: Path) -> dict:
    pages: list[dict] = []
    continuation: dict[str, str] = {}
    while True:
        parameters = {
            "action": "query",
            "list": "allpages",
            "apprefix": WIKIBOOK_ROOT,
            "apnamespace": "0",
            "aplimit": "100",
            "format": "json",
            "formatversion": "2",
            **continuation,
        }
        payload = fetch_json(f"{WIKIBOOK_API}?{urllib.parse.urlencode(parameters)}")
        for page in payload.get("query", {}).get("allpages", []):
            title = str(page.get("title") or "")
            if title != WIKIBOOK_ROOT and not title.startswith(f"{WIKIBOOK_ROOT}/"):
                continue
            pages.append({"pageid": page.get("pageid"), "title": title})
        next_page = payload.get("continue")
        if not next_page:
            break
        continuation = {key: str(value) for key, value in next_page.items() if key != "continue"}
        time.sleep(0.15)

    # The full Wikibook contains thousands of move-by-move leaf pages.  The
    # coach needs its broad plan material, so snapshot the root plus every
    # first-move and reply family page; concrete depth already comes from the
    # legality-checked book-line index.
    pages = [
        page
        for page in pages
        if page["title"] == WIKIBOOK_ROOT
        or len(str(page["title"]).removeprefix(f"{WIKIBOOK_ROOT}/").split("/")) <= 2
    ]
    print(f"Wikibooks broad-plan snapshot selected {len(pages)} pages", flush=True)
    records: list[dict] = []
    # MediaWiki limits whole-article plaintext extracts to one page per call.
    batch_size = 1
    for start in range(0, len(pages), batch_size):
        batch = pages[start : start + batch_size]
        page_ids = "|".join(str(page["pageid"]) for page in batch if page.get("pageid"))
        parameters = {
            "action": "query",
            "pageids": page_ids,
            "prop": "extracts|info|revisions",
            "explaintext": "1",
            "exlimit": "1",
            "inprop": "url",
            "rvprop": "ids|timestamp",
            "format": "json",
            "formatversion": "2",
            "maxlag": "5",
        }
        payload = fetch_json(f"{WIKIBOOK_API}?{urllib.parse.urlencode(parameters)}")
        for page in payload.get("query", {}).get("pages", []):
            title = str(page.get("title") or "")
            revision = (page.get("revisions") or [{}])[0]
            page_id = page.get("pageid")
            revision_id = revision.get("revid")
            url = str(page.get("fullurl") or "")
            permalink = f"https://en.wikibooks.org/w/index.php?title={urllib.parse.quote(title.replace(' ', '_'))}&oldid={revision_id}" if revision_id else url
            records.append(
                {
                    "pageid": page_id,
                    "revid": revision_id,
                    "revision_timestamp": revision.get("timestamp"),
                    "title": title,
                    "url": url,
                    "permalink": permalink,
                    "extract": page.get("extract") or "",
                }
            )
        completed = min(start + len(batch), len(pages))
        if completed % 25 == 0 or completed == len(pages):
            print(f"Wikibooks snapshot: {completed}/{len(pages)} pages", flush=True)
        time.sleep(0.5)

    records.sort(key=lambda record: str(record["title"]))
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as destination:
        for record in records:
            destination.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.replace(temporary, output)
    return {"records": len(records), "path": str(output)}


def sync_capablanca(output: Path) -> dict:
    data = fetch_bytes(CAPABLANCA_TEXT)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, output)
    return {"bytes": len(data), "path": str(output)}


def write_manifest(library_root: Path, wikibook_path: Path, capablanca_path: Path) -> Path:
    course_candidates = sorted(
        (library_root.parent / "Chessable Courses").glob("03 - Chess Structures*"),
        key=lambda path: path.name,
    )
    if not course_candidates:
        raise FileNotFoundError("The Chess Structures Chessable course folder was not found.")
    course_path = course_candidates[0].resolve()
    manifest = {
        "schema_version": 1,
        "updated_at": utc_now(),
        "rights_note": (
            "Private Chessable PGNs are user-owned and local-only. Wikibooks text is CC BY-SA 4.0 "
            "with per-page permanent-link attribution. Chess Fundamentals is public domain in the "
            "USA and, because Capablanca died in 1942, is also out of copyright in the UK; the "
            "Project Gutenberg license and source notice are retained in the downloaded text."
        ),
        "sources": [
            {
                "type": "pgn_course",
                "path": str(course_path),
                "course_manifest": "_course-manifest.json",
                "book": {
                    "id": "strategy-structures-private-course",
                    "title": "Chess Structures: A Grandmaster Guide",
                    "author": "Mauricio Flores Rios",
                    "author_title": "GM",
                    "year": 2015,
                    "publisher": "Quality Chess / Chessable",
                    "shelf": "02 Middlegame and Pawn Structures",
                    "coverage": "Full private course: recurring pawn structures, plans for both sides, piece placement, thematic breaks, exchanges, manoeuvres, and model games",
                    "source_style": "pawn_structure_plans",
                    "priority": "foundation",
                    "product_url": "https://www.chessable.com/chess-structures-a-grandmaster-guide/course/14540/",
                    "sample_url": "",
                    "local_path": "",
                    "status": "private-user-owned-course",
                    "access_scope": "user_owned_full",
                    "content_scope": "private_user_owned_chessable_pgn",
                    "collection_segment": "Private user-owned courses",
                },
            },
            {
                "type": "wikibooks_jsonl",
                "path": str(wikibook_path.resolve()),
                "book": {
                    "id": "open-wikibooks-opening-theory",
                    "title": "Chess Opening Theory",
                    "author": "Wikibooks contributors",
                    "publisher": "Wikibooks",
                    "shelf": "Opening Books — Open Licensed",
                    "coverage": "Broad opening-family pages through the first move and reply, emphasizing move purposes, plans, trade-offs, candidate moves, and transpositions",
                    "source_style": "opening_ideas_reference",
                    "priority": "supplemental",
                    "product_url": "https://en.wikibooks.org/wiki/Chess_Opening_Theory",
                    "sample_url": "",
                    "local_path": "",
                    "status": "open-license-snapshot",
                    "access_scope": "cc_by_sa_4_0",
                    "content_scope": "open_licensed_full_snapshot",
                    "license": "CC BY-SA 4.0",
                    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                    "collection_segment": "Opening Books",
                },
            },
            {
                "type": "plain_text",
                "path": str(capablanca_path.resolve()),
                "ebook_id": "33870",
                "book": {
                    "id": "open-capablanca-chess-fundamentals",
                    "title": "Chess Fundamentals",
                    "author": "Jose Raul Capablanca",
                    "author_title": "World Champion",
                    "year": 1921,
                    "publisher": "Project Gutenberg",
                    "shelf": "Opening Books — Public Domain Foundations",
                    "coverage": "General opening strategy, control of the centre, pawn play, typical opening-to-middlegame transitions, and annotated model games",
                    "source_style": "strategic_principles",
                    "priority": "supplemental",
                    "product_url": "https://www.gutenberg.org/ebooks/33870",
                    "sample_url": "",
                    "local_path": "",
                    "status": "public-domain-snapshot",
                    "access_scope": "public_domain",
                    "content_scope": "public_domain_full_text",
                    "license": "Public domain; Project Gutenberg terms retained",
                    "collection_segment": "Opening Books",
                },
            },
        ],
    }
    manifest_path = library_root / "00 Master Library Guide" / "AI Chess Coach supplemental sources.json"
    temporary = manifest_path.with_suffix(manifest_path.suffix + ".tmp")
    temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, manifest_path)
    return manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library-root", type=Path, default=DEFAULT_LIBRARY_ROOT)
    parser.add_argument("--skip-download", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    library_root = args.library_root.expanduser().resolve()
    open_root = library_root / "09 Open Licensed and Public Domain"
    wikibook_path = open_root / "Wikibooks Chess Opening Theory" / "pages.jsonl"
    capablanca_path = open_root / "Jose Raul Capablanca - Chess Fundamentals" / "pg33870.txt"
    report: dict[str, object] = {"updated_at": utc_now()}
    if not args.skip_download:
        report["wikibooks"] = sync_wikibook(wikibook_path)
        report["capablanca"] = sync_capablanca(capablanca_path)
    elif not wikibook_path.exists() or not capablanca_path.exists():
        raise FileNotFoundError("Open-source snapshots are missing; run without --skip-download first.")
    report["manifest"] = str(write_manifest(library_root, wikibook_path, capablanca_path))
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
