#!/usr/bin/env python3
"""Render an exact cited chess-book PDF page for visual or multimodal analysis."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path


DEFAULT_CORPUS = (
    Path.home()
    / "Documents"
    / "EnCroissant"
    / "AI Chess Coach Library"
    / "00 AI Corpus"
    / "chess-books.sqlite3"
)


def find_pdftoppm(explicit: str | None) -> Path:
    if explicit:
        path = Path(explicit)
        if path.exists():
            return path
        raise FileNotFoundError(path)
    bundled = (
        Path.home()
        / ".cache"
        / "codex-runtimes"
        / "codex-primary-runtime"
        / "dependencies"
        / "native"
        / "poppler"
        / "Library"
        / "bin"
        / "pdftoppm.exe"
    )
    if bundled.exists():
        return bundled
    located = shutil.which("pdftoppm")
    if located:
        return Path(located)
    raise FileNotFoundError("pdftoppm is required")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("book_id")
    parser.add_argument("pdf_page", type=int)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--pdftoppm", default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.corpus.exists():
        raise FileNotFoundError(args.corpus)
    connection = sqlite3.connect(f"file:{args.corpus.resolve()}?mode=ro", uri=True)
    try:
        book = connection.execute(
            "SELECT title,author,local_path FROM books WHERE book_id=?",
            (args.book_id,),
        ).fetchone()
        page = connection.execute(
            "SELECT printed_page,chapter_title,diagram_candidate FROM pages WHERE book_id=? AND pdf_page=?",
            (args.book_id, args.pdf_page),
        ).fetchone()
    finally:
        connection.close()
    if book is None:
        raise KeyError(f"Unknown book id: {args.book_id}")
    if page is None:
        raise IndexError(f"PDF page {args.pdf_page} is not indexed for {args.book_id}")
    pdf_path = Path(book[2])
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)
    output = args.output or args.corpus.parent / "page-renders" / args.book_id / f"page-{args.pdf_page:04d}.png"
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    executable = find_pdftoppm(args.pdftoppm)
    environment = os.environ.copy()
    environment["PATH"] = str(executable.parent) + os.pathsep + environment.get("PATH", "")
    prefix = output.with_suffix("")
    completed = subprocess.run(
        [
            str(executable), "-f", str(args.pdf_page), "-l", str(args.pdf_page), "-singlefile",
            "-png", "-r", str(args.dpi), str(pdf_path), str(prefix),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        env=environment,
    )
    if completed.returncode != 0 or not output.exists():
        raise RuntimeError(completed.stderr.strip() or "pdftoppm did not produce an image")
    payload = {
        "book_id": args.book_id,
        "title": book[0],
        "author": book[1],
        "pdf_page": args.pdf_page,
        "printed_page": page[0],
        "chapter_title": page[1],
        "diagram_candidate": bool(page[2]),
        "pdf_path": str(pdf_path),
        "render_path": str(output),
        "bytes": output.stat().st_size,
        "dpi": args.dpi,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
