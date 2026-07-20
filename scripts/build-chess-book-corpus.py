#!/usr/bin/env python3
"""Build a citation-safe local AI corpus from the lawful chess-book library.

The generated corpus deliberately keeps PDF-page boundaries. That makes every
retrieved chunk traceable to a page even when a publisher excerpt has no PDF
bookmarks or its printed page numbering is incomplete.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import re
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable, Iterator, Sequence

import numpy as np
from pypdf import PdfReader


SCHEMA_VERSION = 1
BUILDER_VERSION = "1.0.0"
DEFAULT_LIBRARY_ROOT = Path.home() / "Documents" / "EnCroissant" / "AI Chess Coach Library"
DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
TARGET_CHUNK_CHARACTERS = 2_400
MAX_CHUNK_CHARACTERS = 3_400
MIN_TEXT_PAGE_CHARACTERS = 40
TOC_FRONT_PAGES = 14
DIAGRAM_MARKER = "[Chess diagram on this page - inspect the rendered PDF page for the board position.]"

logging.getLogger("pypdf").setLevel(logging.ERROR)


@dataclass
class PageRecord:
    book_id: str
    pdf_page: int
    printed_page: int | None
    raw_text: str
    clean_text: str
    extraction_method: str
    extraction_confidence: float
    is_toc: bool = False
    is_front_matter: bool = False
    diagram_candidate: bool = False
    contains_chess_notation: bool = False
    render_path: str | None = None
    chapter_id: str | None = None
    chapter_title: str | None = None


@dataclass
class TocEntry:
    order_index: int
    number: str | None
    title: str
    printed_page: int | None
    source_pdf_page: int


@dataclass
class ChapterRecord:
    chapter_id: str
    book_id: str
    order_index: int
    number: str | None
    title: str
    printed_page_start: int | None
    pdf_page_start: int | None
    pdf_page_end: int | None
    accessible_in_excerpt: bool
    detection_method: str
    confidence: float


@dataclass
class ChunkRecord:
    chunk_id: str
    book_id: str
    chapter_id: str | None
    chapter_title: str | None
    pdf_page_start: int
    pdf_page_end: int
    printed_page_start: int | None
    printed_page_end: int | None
    sequence_in_page: int
    text: str
    word_count: int
    estimated_tokens: int
    citation: str
    access_scope: str
    diagram_candidate: bool
    contains_chess_notation: bool
    text_sha256: str
    embedding: np.ndarray | None = field(default=None, repr=False)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def stable_id(*parts: object, length: int = 24) -> str:
    material = "\x1f".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:length]


def normalize_whitespace(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("\u00ad", "").replace("\u200b", "").replace("\ufeff", "")
    text = "".join(
        character
        for character in text
        if character in {"\n", "\t"}
        or unicodedata.category(character) not in {"Cc", "Cf", "Cs", "Cn"}
    )
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\t\x0b\x0c]+", " ", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_heading(text: str) -> str:
    text = normalize_whitespace(text).lower()
    text = text.replace("–", "-").replace("—", "-")
    text = re.sub(r"\.{2,}", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def heading_tokens(text: str) -> set[str]:
    stop = {
        "a", "an", "and", "at", "by", "chess", "for", "from", "in", "of", "on", "the",
        "to", "volume", "with", "chapter", "part", "edition",
    }
    return {token for token in normalize_heading(text).split() if len(token) > 1 and token not in stop}


def heading_similarity(left: str, right: str) -> float:
    left_norm = normalize_heading(left)
    right_norm = normalize_heading(right)
    if not left_norm or not right_norm:
        return 0.0
    if left_norm == right_norm:
        return 1.0
    if left_norm in right_norm or right_norm in left_norm:
        shorter = min(len(left_norm), len(right_norm))
        longer = max(len(left_norm), len(right_norm))
        ratio = shorter / longer
        shorter_tokens = min(len(heading_tokens(left_norm)), len(heading_tokens(right_norm)))
        if shorter >= 5 and (ratio >= 0.50 or shorter_tokens >= 2):
            return max(0.78, ratio)
    left_tokens = heading_tokens(left_norm)
    right_tokens = heading_tokens(right_norm)
    union = left_tokens | right_tokens
    intersection = left_tokens & right_tokens
    jaccard = len(left_tokens & right_tokens) / len(union) if union else 0.0
    sequence = SequenceMatcher(None, left_norm, right_norm).ratio()
    # Similar-looking book and chapter titles often share one generic word such
    # as "preparation". A multi-word chapter needs at least two meaningful
    # token matches unless one normalized heading contains the other.
    if len(right_tokens) >= 2 and len(intersection) < 2:
        sequence = min(sequence, 0.55)
    return max(jaccard, sequence * 0.9)


def text_lines(text: str) -> list[str]:
    return [re.sub(r"\s+", " ", line).strip() for line in normalize_whitespace(text).splitlines() if line.strip()]


def detect_toc_page(text: str, pdf_page: int) -> bool:
    if pdf_page > TOC_FRONT_PAGES:
        return False
    lines = text_lines(text)
    if not lines:
        return False
    exact_contents = any(normalize_heading(line) in {"contents", "table of contents"} for line in lines[:12])
    trailing_numbers = sum(
        bool(re.search(r"(?:\.{2,}|\s{2,}|\D\s)(\d{1,3})\s*$", line))
        for line in lines
        if len(line) > 4
    )
    return exact_contents or trailing_numbers >= 5


TOC_LINE = re.compile(
    r"^\s*(?:(?:chapter\s+)?(?P<number>\d{1,2})[.)]?\s+)?"
    r"(?P<title>.*?\S)\s+(?:\.{2,}\s*)?(?P<page>\d{1,3})\s*$",
    re.IGNORECASE,
)


def parse_toc_entries(pages: Sequence[PageRecord]) -> list[TocEntry]:
    entries: list[TocEntry] = []
    seen: set[tuple[str, int | None]] = set()
    for page in pages:
        if not page.is_toc:
            continue
        for line in text_lines(page.raw_text):
            cleaned = re.sub(r"\.{2,}", " ", line)
            match = TOC_LINE.match(cleaned)
            if not match:
                continue
            title = match.group("title").strip(" .-\t")
            printed_page = int(match.group("page"))
            number = match.group("number")
            normalized = normalize_heading(title)
            if len(normalized) < 3 or normalized in {"contents", "table of contents"}:
                continue
            if printed_page > 999:
                continue
            key = (normalized, printed_page)
            if key in seen:
                continue
            seen.add(key)
            entries.append(TocEntry(len(entries), number, title, printed_page, page.pdf_page))
    return entries


def detect_printed_page(text: str, is_toc: bool) -> int | None:
    if is_toc:
        return None
    lines = text_lines(text)
    if not lines:
        return None
    candidates = lines[:4] + lines[-4:]
    patterns = [
        re.compile(r"^(\d{1,3})$"),
        re.compile(r"^(\d{1,3})\s+[A-Za-z]"),
        re.compile(r"^[A-Za-z].{2,90}\s+(\d{1,3})$"),
    ]
    for line in candidates:
        for pattern in patterns:
            match = pattern.match(line)
            if match:
                value = int(match.group(1))
                if 1 <= value <= 999:
                    return value
    return None


def repeated_marginal_lines(pages: Sequence[PageRecord]) -> set[str]:
    counts: Counter[str] = Counter()
    considered = 0
    for page in pages:
        if page.is_toc or len(page.raw_text) < MIN_TEXT_PAGE_CHARACTERS:
            continue
        lines = text_lines(page.raw_text)
        if not lines:
            continue
        considered += 1
        candidates = lines[:2] + lines[-2:]
        for line in set(candidates):
            normalized = re.sub(r"\d+", "#", normalize_heading(line))
            if 3 <= len(normalized) <= 110:
                counts[normalized] += 1
    threshold = max(3, math.ceil(considered * 0.30))
    return {line for line, count in counts.items() if count >= threshold}


def clean_page_text(raw_text: str, marginal_lines: set[str]) -> str:
    lines = normalize_whitespace(raw_text).splitlines()
    kept: list[str] = []
    for line in lines:
        stripped = re.sub(r"\s+", " ", line).strip()
        if not stripped:
            kept.append("")
            continue
        private_use_count = len(PRIVATE_USE.findall(stripped))
        if private_use_count >= 4:
            if not kept or kept[-1] != DIAGRAM_MARKER:
                kept.append(DIAGRAM_MARKER)
            continue
        stripped = PRIVATE_USE.sub("", stripped).strip()
        if not stripped:
            continue
        normalized = re.sub(r"\d+", "#", normalize_heading(stripped))
        if normalized in marginal_lines:
            continue
        if re.fullmatch(r"\d{1,3}", stripped):
            continue
        kept.append(stripped)
    text = "\n".join(kept)
    text = re.sub(
        rf"(?:{re.escape(DIAGRAM_MARKER)}\s*)+",
        DIAGRAM_MARKER + "\n",
        text,
    )
    text = re.sub(r"(?<=[a-z])[-‐]\n(?=[a-z])", "", text)
    text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    return text.strip()


PRIVATE_USE = re.compile(r"[\ue000-\uf8ff]")
SAN_MOVE = re.compile(
    r"(?<![A-Za-z0-9])(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-z])"
)


def is_diagram_candidate(text: str) -> bool:
    private_use_count = len(PRIVATE_USE.findall(text))
    return (
        private_use_count >= 12
        or bool(re.search(r"W[_-]{6,}W", text, re.IGNORECASE))
        or len(re.findall(r"\[[A-Za-z0-9_.+\-]{8,}\]", text)) >= 4
        or len(re.findall(r"[♔♕♖♗♘♙♚♛♜♝♞♟]", text)) >= 8
    )


def find_pdftoppm(explicit: str | None) -> str:
    if explicit:
        path = Path(explicit)
        if path.exists():
            return str(path)
        raise FileNotFoundError(f"pdftoppm not found: {explicit}")
    located = shutil.which("pdftoppm")
    if located:
        # The Codex Windows wrapper is convenient interactively but does not
        # add Poppler's DLL directory when launched from Python. Prefer the
        # actual executable when the bundled layout is available.
        located_path = Path(located)
        bundled_exe = (
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
        if located_path.suffix.lower() in {".cmd", ".bat"} and bundled_exe.exists():
            return str(bundled_exe)
        return located
    fallback = (
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
    if fallback.exists():
        return str(fallback)
    raise FileNotFoundError("pdftoppm is required for OCR and page rendering")


def render_pdf_page(
    pdftoppm: str,
    pdf_path: Path,
    pdf_page: int,
    output_path: Path,
    dpi: int = 180,
) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and output_path.stat().st_size > 1000:
        return output_path
    prefix = output_path.with_suffix("")
    command = [
        pdftoppm,
        "-f", str(pdf_page),
        "-l", str(pdf_page),
        "-singlefile",
        "-png",
        "-r", str(dpi),
        str(pdf_path),
        str(prefix),
    ]
    environment = os.environ.copy()
    environment["PATH"] = str(Path(pdftoppm).parent) + os.pathsep + environment.get("PATH", "")
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        env=environment,
    )
    if completed.returncode != 0 or not output_path.exists():
        raise RuntimeError(f"pdftoppm failed for {pdf_path.name} page {pdf_page}: {completed.stderr.strip()}")
    return output_path


class OcrEngine:
    def __init__(self) -> None:
        from rapidocr_onnxruntime import RapidOCR

        self.engine = RapidOCR()

    def recognize(self, image_path: Path) -> tuple[str, float]:
        result, _elapsed = self.engine(str(image_path))
        if not result:
            return "", 0.0
        lines: list[tuple[float, float, str, float]] = []
        for item in result:
            box, text, confidence = item
            y = sum(point[1] for point in box) / len(box)
            x = min(point[0] for point in box)
            lines.append((y, x, str(text), float(confidence)))
        lines.sort(key=lambda value: (round(value[0] / 12), value[1]))
        text = "\n".join(value[2] for value in lines)
        confidence = sum(value[3] for value in lines) / len(lines)
        return normalize_whitespace(text), confidence


def read_pdf_pages(
    book: dict,
    output_root: Path,
    pdftoppm: str,
    ocr_engine_holder: list[OcrEngine | None],
    enable_ocr: bool,
) -> tuple[list[PageRecord], dict]:
    pdf_path = Path(book["local_path"])
    reader = PdfReader(str(pdf_path), strict=False)
    raw_texts: list[str] = []
    extraction_errors: list[dict] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            raw_texts.append(normalize_whitespace(page.extract_text() or ""))
        except Exception as exc:  # preserve per-page failure and continue with OCR eligibility
            raw_texts.append("")
            extraction_errors.append({"pdf_page": index, "error": str(exc)})

    nonempty = sum(len(text) >= MIN_TEXT_PAGE_CHARACTERS for text in raw_texts)
    image_only_document = bool(raw_texts) and nonempty / len(raw_texts) < 0.10
    records: list[PageRecord] = []
    ocr_pages = 0
    ocr_failures: list[dict] = []

    for index, raw_text in enumerate(raw_texts, start=1):
        method = "pdf-text" if len(raw_text) >= MIN_TEXT_PAGE_CHARACTERS else "none"
        confidence = 1.0 if method == "pdf-text" else 0.0
        render_path: str | None = None
        should_ocr = enable_ocr and image_only_document and len(raw_text) < MIN_TEXT_PAGE_CHARACTERS
        if should_ocr:
            try:
                if ocr_engine_holder[0] is None:
                    ocr_engine_holder[0] = OcrEngine()
                relative_render = Path("page-renders") / book["id"] / f"page-{index:04d}.png"
                rendered = render_pdf_page(pdftoppm, pdf_path, index, output_root / relative_render, dpi=190)
                ocr_text, ocr_confidence = ocr_engine_holder[0].recognize(rendered)
                render_path = relative_render.as_posix()
                if ocr_text:
                    raw_text = ocr_text
                    method = "ocr"
                    confidence = ocr_confidence
                    ocr_pages += 1
            except Exception as exc:
                ocr_failures.append({"pdf_page": index, "error": str(exc)})

        is_toc = detect_toc_page(raw_text, index)
        records.append(
            PageRecord(
                book_id=book["id"],
                pdf_page=index,
                printed_page=detect_printed_page(raw_text, is_toc),
                raw_text=raw_text,
                clean_text="",
                extraction_method=method,
                extraction_confidence=confidence,
                is_toc=is_toc,
                diagram_candidate=is_diagram_candidate(raw_text),
                contains_chess_notation=bool(SAN_MOVE.search(raw_text)),
                render_path=render_path,
            )
        )

    marginal_lines = repeated_marginal_lines(records)
    for record in records:
        record.clean_text = clean_page_text(record.raw_text, marginal_lines)

    audit = {
        "book_id": book["id"],
        "path": str(pdf_path),
        "pdf_sha256": sha256_file(pdf_path),
        "pages": len(records),
        "pdf_text_pages": sum(page.extraction_method == "pdf-text" for page in records),
        "ocr_pages": ocr_pages,
        "empty_pages": sum(not page.clean_text for page in records),
        "image_only_before_ocr": image_only_document,
        "extraction_errors": extraction_errors,
        "ocr_failures": ocr_failures,
    }
    return records, audit


def page_heading_candidates(page: PageRecord, book_title: str) -> list[str]:
    lines = text_lines(page.raw_text)[:18]
    candidates: list[str] = []
    book_norm = normalize_heading(book_title)
    for line in lines:
        stripped = re.sub(r"^\d{1,3}\s+", "", line).strip()
        norm = normalize_heading(stripped)
        if not norm or norm == book_norm or len(norm) > 120:
            continue
        if re.match(r"^(?:chapter\s+\d+|\d{1,2}[.)]?\s+[A-Z])", stripped, re.IGNORECASE):
            candidates.append(stripped)
        elif norm in {"foreword", "preface", "introduction", "series introduction", "conclusion", "exercises", "tests", "solutions"}:
            candidates.append(stripped)
        elif len(stripped.split()) <= 10 and stripped[:1].isupper():
            candidates.append(stripped)
    return candidates


def build_chapters(book: dict, pages: list[PageRecord]) -> tuple[list[ChapterRecord], list[dict]]:
    toc_entries = parse_toc_entries(pages)
    matched_starts: dict[int, tuple[int, float, str]] = {}

    for page in pages:
        if page.is_toc or not page.clean_text:
            continue
        candidates = page_heading_candidates(page, book["title"])
        for toc_index, entry in enumerate(toc_entries):
            best = max((heading_similarity(candidate, entry.title) for candidate in candidates), default=0.0)
            if best >= 0.66:
                previous = matched_starts.get(toc_index)
                if previous is None or page.pdf_page < previous[0] or best > previous[1] + 0.10:
                    matched_starts[toc_index] = (page.pdf_page, best, "toc-heading-match")

    # Explicit headings that are not represented in the contents page still form usable sections.
    synthetic: list[tuple[int, str, float]] = []
    for page in pages:
        if page.is_toc or not page.clean_text:
            continue
        candidates = page_heading_candidates(page, book["title"])
        for candidate in candidates:
            if any(heading_similarity(candidate, entry.title) >= 0.66 for entry in toc_entries):
                continue
            norm = normalize_heading(candidate)
            if re.match(r"^chapter\s+\d+", norm) or norm in {
                "foreword", "preface", "introduction", "series introduction", "conclusion", "exercises", "tests", "solutions",
            }:
                synthetic.append((page.pdf_page, candidate, 0.62))
                break

    chapters: list[ChapterRecord] = []
    for index, entry in enumerate(toc_entries):
        match = matched_starts.get(index)
        start = match[0] if match else None
        confidence = match[1] if match else 0.45
        method = match[2] if match else "toc-only"
        chapters.append(
            ChapterRecord(
                chapter_id=stable_id(book["id"], entry.order_index, entry.title, entry.printed_page),
                book_id=book["id"],
                order_index=entry.order_index,
                number=entry.number,
                title=entry.title,
                printed_page_start=entry.printed_page,
                pdf_page_start=start,
                pdf_page_end=None,
                accessible_in_excerpt=start is not None,
                detection_method=method,
                confidence=confidence,
            )
        )

    existing_starts = {(chapter.pdf_page_start, normalize_heading(chapter.title)) for chapter in chapters if chapter.pdf_page_start}
    for pdf_page, title, confidence in synthetic:
        key = (pdf_page, normalize_heading(title))
        if key in existing_starts:
            continue
        chapters.append(
            ChapterRecord(
                chapter_id=stable_id(book["id"], "synthetic", pdf_page, title),
                book_id=book["id"],
                order_index=len(chapters),
                number=None,
                title=title,
                printed_page_start=next((page.printed_page for page in pages if page.pdf_page == pdf_page), None),
                pdf_page_start=pdf_page,
                pdf_page_end=None,
                accessible_in_excerpt=True,
                detection_method="visible-heading",
                confidence=confidence,
            )
        )

    accessible = sorted(
        [chapter for chapter in chapters if chapter.accessible_in_excerpt and chapter.pdf_page_start is not None],
        key=lambda chapter: (chapter.pdf_page_start or 0, chapter.order_index),
    )
    # Page-bounded chunks cannot truthfully claim two chapter labels for the
    # same page. Keep the strongest match and retain the alternatives as
    # inaccessible catalogue metadata for manual review.
    by_start: dict[int, list[ChapterRecord]] = defaultdict(list)
    for chapter in accessible:
        by_start[chapter.pdf_page_start or 0].append(chapter)
    deduplicated: list[ChapterRecord] = []
    for start, group in sorted(by_start.items()):
        winner = max(group, key=lambda chapter: (chapter.confidence, len(heading_tokens(chapter.title)), -chapter.order_index))
        deduplicated.append(winner)
        for chapter in group:
            if chapter is winner:
                continue
            chapter.accessible_in_excerpt = False
            chapter.pdf_page_start = None
            chapter.detection_method = "ambiguous-same-page-heading"
            chapter.confidence = min(chapter.confidence, 0.45)
    accessible = deduplicated

    content_pages = [page.pdf_page for page in pages if not page.is_toc and page.clean_text]
    if not accessible and content_pages:
        title = "Available excerpt"
        chapter = ChapterRecord(
            chapter_id=stable_id(book["id"], "available-excerpt"),
            book_id=book["id"],
            order_index=len(chapters),
            number=None,
            title=title,
            printed_page_start=next((page.printed_page for page in pages if page.pdf_page == min(content_pages)), None),
            pdf_page_start=min(content_pages),
            pdf_page_end=max(content_pages),
            accessible_in_excerpt=True,
            detection_method="excerpt-fallback",
            confidence=0.50,
        )
        chapters.append(chapter)
        accessible = [chapter]

    for index, chapter in enumerate(accessible):
        next_start = accessible[index + 1].pdf_page_start if index + 1 < len(accessible) else None
        if next_start is not None:
            chapter.pdf_page_end = max(chapter.pdf_page_start or 1, next_start - 1)
        elif content_pages:
            chapter.pdf_page_end = max(content_pages)
        else:
            chapter.pdf_page_end = chapter.pdf_page_start

    # Assign page-level chapter metadata. Pages before the first detected section remain front matter.
    for page in pages:
        choices = [
            chapter
            for chapter in accessible
            if chapter.pdf_page_start is not None
            and chapter.pdf_page_start <= page.pdf_page
            and (chapter.pdf_page_end is None or page.pdf_page <= chapter.pdf_page_end)
        ]
        if choices:
            chapter = max(choices, key=lambda item: item.pdf_page_start or 0)
            page.chapter_id = chapter.chapter_id
            page.chapter_title = chapter.title
            if page.printed_page is None and chapter.printed_page_start is not None and chapter.pdf_page_start is not None:
                offset = page.pdf_page - chapter.pdf_page_start
                if 0 <= offset <= 60:
                    page.printed_page = chapter.printed_page_start + offset
        else:
            page.is_front_matter = not page.is_toc

    chapters.sort(key=lambda chapter: (chapter.order_index, chapter.pdf_page_start or 10_000))
    review: list[dict] = []
    if not toc_entries:
        review.append({"book_id": book["id"], "issue": "no-contents-page-detected", "severity": "info"})
    unavailable = sum(not chapter.accessible_in_excerpt for chapter in chapters)
    if unavailable:
        review.append(
            {
                "book_id": book["id"],
                "issue": "toc-entries-not-present-in-excerpt",
                "count": unavailable,
                "severity": "expected-for-publisher-excerpt",
            }
        )
    if not accessible:
        review.append({"book_id": book["id"], "issue": "no-accessible-section", "severity": "warning"})
    return chapters, review


def split_text(text: str, target: int = TARGET_CHUNK_CHARACTERS, maximum: int = MAX_CHUNK_CHARACTERS) -> list[str]:
    text = text.strip()
    if not text:
        return []
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if len(paragraphs) == 1:
        paragraphs = [part.strip() for part in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", text) if part.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_length = 0

    def flush() -> None:
        nonlocal current, current_length
        if current:
            chunks.append("\n\n".join(current).strip())
            overlap = current[-1] if len(current[-1]) <= 320 else ""
            current = [overlap] if overlap else []
            current_length = len(overlap)

    for paragraph in paragraphs:
        if len(paragraph) > maximum:
            words = paragraph.split()
            segments: list[str] = []
            segment: list[str] = []
            length = 0
            for word in words:
                if segment and length + len(word) + 1 > maximum:
                    segments.append(" ".join(segment))
                    segment = []
                    length = 0
                segment.append(word)
                length += len(word) + 1
            if segment:
                segments.append(" ".join(segment))
        else:
            segments = [paragraph]
        for segment in segments:
            if current and current_length + len(segment) + 2 > target and current_length >= 700:
                flush()
            current.append(segment)
            current_length += len(segment) + 2
            if current_length >= maximum:
                flush()
    if current:
        chunks.append("\n\n".join(current).strip())
    return [chunk for chunk in chunks if len(chunk) >= 80]


def make_citation(book: dict, page: PageRecord) -> str:
    chapter = f" - {page.chapter_title}" if page.chapter_title else ""
    printed = f", printed p. {page.printed_page}" if page.printed_page is not None else ""
    return f"{book['title']} - {book['author']}{chapter} - PDF p. {page.pdf_page}{printed}"


def build_chunks(book: dict, pages: Sequence[PageRecord]) -> list[ChunkRecord]:
    chunks: list[ChunkRecord] = []
    access_scope = "publisher_excerpt" if book.get("installed_sample") else "metadata_only"
    for page in pages:
        if page.is_toc or len(page.clean_text) < 80:
            continue
        for sequence, chunk_text in enumerate(split_text(page.clean_text), start=1):
            chunk_id = stable_id(book["id"], page.pdf_page, sequence, hashlib.sha256(chunk_text.encode("utf-8")).hexdigest())
            words = len(re.findall(r"\S+", chunk_text))
            chunks.append(
                ChunkRecord(
                    chunk_id=chunk_id,
                    book_id=book["id"],
                    chapter_id=page.chapter_id,
                    chapter_title=page.chapter_title,
                    pdf_page_start=page.pdf_page,
                    pdf_page_end=page.pdf_page,
                    printed_page_start=page.printed_page,
                    printed_page_end=page.printed_page,
                    sequence_in_page=sequence,
                    text=chunk_text,
                    word_count=words,
                    estimated_tokens=max(1, math.ceil(len(chunk_text) / 4)),
                    citation=make_citation(book, page),
                    access_scope=access_scope,
                    diagram_candidate=page.diagram_candidate,
                    contains_chess_notation=page.contains_chess_notation,
                    text_sha256=hashlib.sha256(chunk_text.encode("utf-8")).hexdigest(),
                )
            )
    return chunks


def embed_chunks(chunks: list[ChunkRecord], books_by_id: dict[str, dict], model_name: str, batch_size: int) -> dict:
    from fastembed import TextEmbedding

    model = TextEmbedding(model_name=model_name)
    texts = []
    for chunk in chunks:
        book = books_by_id[chunk.book_id]
        context = " | ".join(
            value
            for value in [
                book["title"],
                book["author"],
                book.get("shelf"),
                book.get("coverage"),
                chunk.chapter_title,
                chunk.text,
            ]
            if value
        )
        texts.append(context)
    vectors = model.passage_embed(texts, batch_size=batch_size) if hasattr(model, "passage_embed") else model.embed(texts, batch_size=batch_size)
    dimension = 0
    count = 0
    for chunk, vector in zip(chunks, vectors, strict=True):
        array = np.asarray(vector, dtype=np.float32)
        norm = float(np.linalg.norm(array))
        if norm:
            array = array / norm
        chunk.embedding = array
        dimension = int(array.shape[0])
        count += 1
        if count % 250 == 0:
            print(f"  embedded {count}/{len(chunks)} chunks", flush=True)
    return {"model": model_name, "dimension": dimension, "embedded_chunks": count}


def json_safe_book(book: dict, pdf_sha256: str | None) -> dict:
    item = dict(book)
    item["access_scope"] = "publisher_excerpt" if book.get("installed_sample") else "metadata_only"
    item["content_scope"] = "official_publisher_excerpt" if book.get("installed_sample") else "catalogue_entry_only"
    item["pdf_sha256"] = pdf_sha256
    return item


def page_to_dict(page: PageRecord) -> dict:
    return {
        "page_id": stable_id(page.book_id, page.pdf_page),
        "book_id": page.book_id,
        "pdf_page": page.pdf_page,
        "printed_page": page.printed_page,
        "chapter_id": page.chapter_id,
        "chapter_title": page.chapter_title,
        "extraction_method": page.extraction_method,
        "extraction_confidence": round(page.extraction_confidence, 4),
        "is_toc": page.is_toc,
        "is_front_matter": page.is_front_matter,
        "diagram_candidate": page.diagram_candidate,
        "contains_chess_notation": page.contains_chess_notation,
        "render_path": page.render_path,
        "raw_text_characters": len(page.raw_text),
        "clean_text_characters": len(page.clean_text),
        "text": page.clean_text,
    }


def chapter_to_dict(chapter: ChapterRecord) -> dict:
    return {
        "chapter_id": chapter.chapter_id,
        "book_id": chapter.book_id,
        "order_index": chapter.order_index,
        "number": chapter.number,
        "title": chapter.title,
        "printed_page_start": chapter.printed_page_start,
        "pdf_page_start": chapter.pdf_page_start,
        "pdf_page_end": chapter.pdf_page_end,
        "accessible_in_excerpt": chapter.accessible_in_excerpt,
        "detection_method": chapter.detection_method,
        "confidence": round(chapter.confidence, 4),
    }


def chunk_to_dict(chunk: ChunkRecord) -> dict:
    return {
        "chunk_id": chunk.chunk_id,
        "book_id": chunk.book_id,
        "chapter_id": chunk.chapter_id,
        "chapter_title": chunk.chapter_title,
        "pdf_page_start": chunk.pdf_page_start,
        "pdf_page_end": chunk.pdf_page_end,
        "printed_page_start": chunk.printed_page_start,
        "printed_page_end": chunk.printed_page_end,
        "sequence_in_page": chunk.sequence_in_page,
        "word_count": chunk.word_count,
        "estimated_tokens": chunk.estimated_tokens,
        "citation": chunk.citation,
        "access_scope": chunk.access_scope,
        "diagram_candidate": chunk.diagram_candidate,
        "contains_chess_notation": chunk.contains_chess_notation,
        "text_sha256": chunk.text_sha256,
        "text": chunk.text,
    }


def write_jsonl_atomic(path: Path, items: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as output:
        for item in items:
            output.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.replace(temp, path)


def create_database(
    path: Path,
    books: Sequence[dict],
    pages: Sequence[PageRecord],
    chapters: Sequence[ChapterRecord],
    chunks: Sequence[ChunkRecord],
    embedding_info: dict | None,
    run_info: dict,
) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    if temp.exists():
        temp.unlink()
    connection = sqlite3.connect(temp)
    try:
        connection.executescript(
            """
            PRAGMA journal_mode = DELETE;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE books (
                book_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                author_title TEXT,
                year INTEGER,
                publisher TEXT,
                shelf TEXT,
                coverage TEXT,
                source_style TEXT,
                priority TEXT,
                product_url TEXT,
                sample_url TEXT,
                local_path TEXT,
                status TEXT,
                access_scope TEXT NOT NULL,
                content_scope TEXT NOT NULL,
                pdf_sha256 TEXT,
                metadata_json TEXT NOT NULL
            );
            CREATE TABLE chapters (
                chapter_id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL REFERENCES books(book_id),
                order_index INTEGER NOT NULL,
                number TEXT,
                title TEXT NOT NULL,
                printed_page_start INTEGER,
                pdf_page_start INTEGER,
                pdf_page_end INTEGER,
                accessible_in_excerpt INTEGER NOT NULL,
                detection_method TEXT NOT NULL,
                confidence REAL NOT NULL
            );
            CREATE TABLE pages (
                page_id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL REFERENCES books(book_id),
                chapter_id TEXT REFERENCES chapters(chapter_id),
                pdf_page INTEGER NOT NULL,
                printed_page INTEGER,
                chapter_title TEXT,
                extraction_method TEXT NOT NULL,
                extraction_confidence REAL NOT NULL,
                is_toc INTEGER NOT NULL,
                is_front_matter INTEGER NOT NULL,
                diagram_candidate INTEGER NOT NULL,
                contains_chess_notation INTEGER NOT NULL,
                render_path TEXT,
                raw_text_characters INTEGER NOT NULL,
                clean_text_characters INTEGER NOT NULL,
                text TEXT NOT NULL,
                UNIQUE(book_id, pdf_page)
            );
            CREATE TABLE chunks (
                chunk_id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL REFERENCES books(book_id),
                chapter_id TEXT REFERENCES chapters(chapter_id),
                chapter_title TEXT,
                pdf_page_start INTEGER NOT NULL,
                pdf_page_end INTEGER NOT NULL,
                printed_page_start INTEGER,
                printed_page_end INTEGER,
                sequence_in_page INTEGER NOT NULL,
                word_count INTEGER NOT NULL,
                estimated_tokens INTEGER NOT NULL,
                citation TEXT NOT NULL,
                access_scope TEXT NOT NULL,
                diagram_candidate INTEGER NOT NULL,
                contains_chess_notation INTEGER NOT NULL,
                text_sha256 TEXT NOT NULL,
                text TEXT NOT NULL
            );
            CREATE TABLE embeddings (
                chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id),
                model TEXT NOT NULL,
                dimension INTEGER NOT NULL,
                vector BLOB NOT NULL
            );
            CREATE VIRTUAL TABLE chunks_fts USING fts5(
                chunk_id UNINDEXED,
                title,
                author,
                shelf,
                chapter_title,
                coverage,
                text,
                tokenize = 'porter unicode61 remove_diacritics 2'
            );
            CREATE INDEX pages_book_page ON pages(book_id, pdf_page);
            CREATE INDEX chapters_book_order ON chapters(book_id, order_index);
            CREATE INDEX chunks_book_page ON chunks(book_id, pdf_page_start);
            CREATE INDEX chunks_chapter ON chunks(chapter_id);
            """
        )
        metadata = {
            "schema_version": SCHEMA_VERSION,
            "builder_version": BUILDER_VERSION,
            "created_at": run_info["created_at"],
            "rights_note": run_info["rights_note"],
            "embedding_model": embedding_info["model"] if embedding_info else "none",
            "embedding_dimension": embedding_info["dimension"] if embedding_info else 0,
        }
        connection.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            [(key, json.dumps(value, ensure_ascii=False)) for key, value in metadata.items()],
        )
        connection.executemany(
            """INSERT INTO books(
                book_id,title,author,author_title,year,publisher,shelf,coverage,source_style,priority,
                product_url,sample_url,local_path,status,access_scope,content_scope,pdf_sha256,metadata_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [
                (
                    book["id"], book["title"], book["author"], book.get("author_title"), book.get("year"),
                    book.get("publisher"), book.get("shelf"), book.get("coverage"), book.get("source_style"),
                    book.get("priority"), book.get("product_url"), book.get("sample_url"), book.get("local_path"),
                    book.get("status"), book["access_scope"], book["content_scope"], book.get("pdf_sha256"),
                    json.dumps(book, ensure_ascii=False),
                )
                for book in books
            ],
        )
        connection.executemany(
            "INSERT INTO chapters VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    chapter.chapter_id, chapter.book_id, chapter.order_index, chapter.number, chapter.title,
                    chapter.printed_page_start, chapter.pdf_page_start, chapter.pdf_page_end,
                    int(chapter.accessible_in_excerpt), chapter.detection_method, chapter.confidence,
                )
                for chapter in chapters
            ],
        )
        connection.executemany(
            """INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [
                (
                    stable_id(page.book_id, page.pdf_page), page.book_id, page.chapter_id, page.pdf_page,
                    page.printed_page, page.chapter_title, page.extraction_method, page.extraction_confidence,
                    int(page.is_toc), int(page.is_front_matter), int(page.diagram_candidate),
                    int(page.contains_chess_notation), page.render_path, len(page.raw_text), len(page.clean_text),
                    page.clean_text,
                )
                for page in pages
            ],
        )
        books_by_id = {book["id"]: book for book in books}
        connection.executemany(
            """INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [
                (
                    chunk.chunk_id, chunk.book_id, chunk.chapter_id, chunk.chapter_title, chunk.pdf_page_start,
                    chunk.pdf_page_end, chunk.printed_page_start, chunk.printed_page_end, chunk.sequence_in_page,
                    chunk.word_count, chunk.estimated_tokens, chunk.citation, chunk.access_scope,
                    int(chunk.diagram_candidate), int(chunk.contains_chess_notation), chunk.text_sha256, chunk.text,
                )
                for chunk in chunks
            ],
        )
        connection.executemany(
            "INSERT INTO chunks_fts VALUES (?,?,?,?,?,?,?)",
            [
                (
                    chunk.chunk_id,
                    books_by_id[chunk.book_id]["title"],
                    books_by_id[chunk.book_id]["author"],
                    books_by_id[chunk.book_id].get("shelf"),
                    chunk.chapter_title,
                    books_by_id[chunk.book_id].get("coverage"),
                    chunk.text,
                )
                for chunk in chunks
            ],
        )
        if embedding_info:
            connection.executemany(
                "INSERT INTO embeddings VALUES (?,?,?,?)",
                [
                    (
                        chunk.chunk_id,
                        embedding_info["model"],
                        embedding_info["dimension"],
                        sqlite3.Binary(np.asarray(chunk.embedding, dtype="<f4").tobytes()),
                    )
                    for chunk in chunks
                    if chunk.embedding is not None
                ],
            )
        connection.commit()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
    finally:
        connection.close()
    os.replace(temp, path)


def write_readme(output_root: Path, report: dict) -> None:
    text = f"""# AI Chess Coach Corpus

Generated: {report['created_at']}

This directory is the machine-readable ingestion layer for the lawful chess-book shelf.

## Ready surfaces

- `chess-books.sqlite3` - books, pages, chapters, citation-safe chunks, FTS5 index, and local embeddings
- `books.jsonl` - one normalized record per catalogued book
- `pages.jsonl` - cleaned page text with PDF/printed page, chapter, OCR, and diagram metadata
- `chapters.jsonl` - contents-derived chapter map, including entries not present in a publisher excerpt
- `chunks.jsonl` - portable page-bounded chunks with complete citations
- `chapter-review.json` - automated chapter-map caveats for future manual review
- `ingestion-report.json` - extraction, OCR, embedding, and integrity results
- `page-renders/` - retained page images required for OCR or multimodal fallback

## Scope and rights

{report['rights_note']}

The current content scope is publisher excerpts, not complete books. Catalogue-only books have `access_scope=metadata_only` and no chunks. Installed samples have `access_scope=publisher_excerpt`. Future user-owned full books should use `access_scope=user_owned_full`.

## Search

From the repository root:

```powershell
python scripts/search-chess-book-corpus.py "candidate moves and calculation"
python scripts/search-chess-book-corpus.py --json "when should I exchange pieces"
python scripts/render-chess-book-page.py thinking-ramesh 29
```

The search tool uses reciprocal-rank fusion across SQLite FTS5 and the local `{report['embedding']['model']}` embedding index. Every result returns a citation and exact PDF page. Printed page numbers are included only when the pipeline can support them.

## Important fidelity rule

Chunks never cross PDF-page boundaries. A model may combine adjacent results, but it must preserve each source citation. Pages marked `diagram_candidate=true` should be rendered and sent to a vision-capable model before making claims about the board position; extracted font glyphs are not a trustworthy FEN representation.
"""
    temp = output_root / "README.md.tmp"
    temp.write_text(text, encoding="utf-8")
    os.replace(temp, output_root / "README.md")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library-root", type=Path, default=DEFAULT_LIBRARY_ROOT)
    parser.add_argument("--output", type=Path, default=None, help="Defaults to <library>/00 AI Corpus")
    parser.add_argument("--catalogue", type=Path, default=None, help="Defaults to the master catalogue JSON")
    parser.add_argument("--embedding-model", default=DEFAULT_EMBEDDING_MODEL)
    parser.add_argument("--embedding-batch-size", type=int, default=64)
    parser.add_argument("--no-embeddings", action="store_true")
    parser.add_argument("--no-ocr", action="store_true")
    parser.add_argument("--pdftoppm", default=None)
    parser.add_argument("--limit", type=int, default=None, help="Development-only limit on installed PDFs")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    library_root = args.library_root.resolve()
    output_root = (args.output or library_root / "00 AI Corpus").resolve()
    catalogue_path = (
        args.catalogue
        or library_root / "00 Master Library Guide" / "AI Chess Coach Library catalogue.json"
    ).resolve()
    if not catalogue_path.exists():
        raise FileNotFoundError(f"Catalogue not found: {catalogue_path}")
    output_root.mkdir(parents=True, exist_ok=True)
    pdftoppm = find_pdftoppm(args.pdftoppm)
    catalogue = json.loads(catalogue_path.read_text(encoding="utf-8"))
    source_books: list[dict] = list(catalogue["books"])
    installed = [book for book in source_books if book.get("installed_sample") and book.get("local_path")]
    if args.limit:
        selected_ids = {book["id"] for book in installed[: args.limit]}
        installed = [book for book in installed if book["id"] in selected_ids]
        source_books = [book for book in source_books if book["id"] in selected_ids or not book.get("installed_sample")]

    print(f"Building corpus from {len(installed)} installed PDFs and {len(source_books)} catalogue records", flush=True)
    started = time.monotonic()
    all_pages: list[PageRecord] = []
    all_chapters: list[ChapterRecord] = []
    all_chunks: list[ChunkRecord] = []
    book_audits: list[dict] = []
    chapter_review: list[dict] = []
    pdf_hashes: dict[str, str] = {}
    ocr_engine_holder: list[OcrEngine | None] = [None]

    for index, book in enumerate(installed, start=1):
        print(f"[{index:02d}/{len(installed):02d}] {book['title']}", flush=True)
        pages, audit = read_pdf_pages(
            book,
            output_root,
            pdftoppm,
            ocr_engine_holder,
            enable_ocr=not args.no_ocr,
        )
        chapters, review = build_chapters(book, pages)
        chunks = build_chunks(book, pages)
        audit.update(
            {
                "toc_pages": sum(page.is_toc for page in pages),
                "chapters": len(chapters),
                "accessible_chapters": sum(chapter.accessible_in_excerpt for chapter in chapters),
                "chunks": len(chunks),
                "diagram_candidate_pages": sum(page.diagram_candidate for page in pages),
                "clean_text_characters": sum(len(page.clean_text) for page in pages),
            }
        )
        pdf_hashes[book["id"]] = audit["pdf_sha256"]
        all_pages.extend(pages)
        all_chapters.extend(chapters)
        all_chunks.extend(chunks)
        book_audits.append(audit)
        chapter_review.extend(review)

    normalized_books = [json_safe_book(book, pdf_hashes.get(book["id"])) for book in source_books]
    books_by_id = {book["id"]: book for book in normalized_books}
    embedding_info = None
    if not args.no_embeddings and all_chunks:
        print(f"Embedding {len(all_chunks)} chunks with {args.embedding_model}", flush=True)
        embedding_info = embed_chunks(all_chunks, books_by_id, args.embedding_model, args.embedding_batch_size)

    created_at = utc_now()
    rights_note = catalogue.get(
        "rights_note",
        "Only lawfully acquired content may be indexed. Do not redistribute publisher excerpts.",
    )
    run_info = {"created_at": created_at, "rights_note": rights_note}

    write_jsonl_atomic(output_root / "books.jsonl", normalized_books)
    write_jsonl_atomic(output_root / "pages.jsonl", (page_to_dict(page) for page in all_pages))
    write_jsonl_atomic(output_root / "chapters.jsonl", (chapter_to_dict(chapter) for chapter in all_chapters))
    write_jsonl_atomic(output_root / "chunks.jsonl", (chunk_to_dict(chunk) for chunk in all_chunks))

    review_payload = {
        "schema_version": SCHEMA_VERSION,
        "created_at": created_at,
        "method": "Contents-page parsing plus visible-heading matching. Toc-only chapters are retained but marked inaccessible when the publisher excerpt omits them.",
        "issues": chapter_review,
    }
    review_temp = output_root / "chapter-review.json.tmp"
    review_temp.write_text(json.dumps(review_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(review_temp, output_root / "chapter-review.json")

    database_path = output_root / "chess-books.sqlite3"
    create_database(
        database_path,
        normalized_books,
        all_pages,
        all_chapters,
        all_chunks,
        embedding_info,
        run_info,
    )

    report = {
        "schema_version": SCHEMA_VERSION,
        "builder_version": BUILDER_VERSION,
        "created_at": created_at,
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "library_root": str(library_root),
        "catalogue_path": str(catalogue_path),
        "output_root": str(output_root),
        "rights_note": rights_note,
        "content_scope": "official publisher excerpts plus catalogue-only acquisition records",
        "counts": {
            "catalogued_books": len(normalized_books),
            "installed_book_pdfs": len(installed),
            "metadata_only_books": sum(book["access_scope"] == "metadata_only" for book in normalized_books),
            "pages": len(all_pages),
            "pdf_text_pages": sum(page.extraction_method == "pdf-text" for page in all_pages),
            "ocr_pages": sum(page.extraction_method == "ocr" for page in all_pages),
            "empty_pages": sum(not page.clean_text for page in all_pages),
            "toc_pages": sum(page.is_toc for page in all_pages),
            "chapters": len(all_chapters),
            "accessible_chapters": sum(chapter.accessible_in_excerpt for chapter in all_chapters),
            "toc_only_chapters": sum(not chapter.accessible_in_excerpt for chapter in all_chapters),
            "chunks": len(all_chunks),
            "diagram_candidate_pages": sum(page.diagram_candidate for page in all_pages),
            "chunks_with_printed_page": sum(chunk.printed_page_start is not None for chunk in all_chunks),
            "chunks_with_pdf_citation": sum(bool(chunk.citation) for chunk in all_chunks),
            "extraction_errors": sum(len(audit["extraction_errors"]) for audit in book_audits),
            "ocr_failures": sum(len(audit["ocr_failures"]) for audit in book_audits),
        },
        "embedding": embedding_info or {"model": "none", "dimension": 0, "embedded_chunks": 0},
        "database": {
            "path": str(database_path),
            "bytes": database_path.stat().st_size,
            "integrity_check": "ok",
            "fts": "SQLite FTS5",
            "hybrid_search": bool(embedding_info),
        },
        "book_audits": book_audits,
        "readiness": {
            "machine_readable": True,
            "page_citations_complete": all(bool(chunk.citation) for chunk in all_chunks),
            "chapter_metadata_available": bool(all_chapters),
            "ocr_completed_for_image_only_excerpt": any(audit["ocr_pages"] for audit in book_audits),
            "semantic_index_available": bool(embedding_info),
            "full_book_coverage": False,
            "remaining_boundary": "The current library contains publisher excerpts. Full-book analysis requires lawfully acquired full editions.",
        },
    }
    report_temp = output_root / "ingestion-report.json.tmp"
    report_temp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(report_temp, output_root / "ingestion-report.json")
    write_readme(output_root, report)

    print(json.dumps({"output": str(output_root), "counts": report["counts"], "embedding": report["embedding"], "readiness": report["readiness"]}, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
