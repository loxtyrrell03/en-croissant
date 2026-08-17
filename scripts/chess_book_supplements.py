"""Ingest private PGN courses and openly licensed web books for the coach corpus.

The PDF corpus builder intentionally remains page based.  This module adapts
non-PDF sources to the same page/chapter/chunk contract while preserving their
real source locators and, for chess content, legality-checked position anchors.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Sequence

import chess

from chess_book_lines import OpeningLineMove, OpeningLineRecord, normalize_fen_key


MAX_CHUNK_CHARACTERS = 3_400
TARGET_CHUNK_CHARACTERS = 2_400
PGN_TOKEN_RE = re.compile(
    r"\{[^}]*\}|\(|\)|\$\d+|1/2-1/2|1-0|0-1|\*|\d+\.(?:\.\.)?|[^\s(){}]+",
    re.DOTALL,
)
PGN_HEADER_RE = re.compile(r'^\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"])*)"\]\s*$', re.MULTILINE)
MOVE_NUMBER_RE = re.compile(r"^\d+\.(?:\.\.)?$")
MOVE_SUFFIX_RE = re.compile(r"(?:\$\d+|[!?]+|[\u00b1\u2213\u221e\u00b2\u00b3\u00a9\u0192]+)+$")
PLAN_LANGUAGE_RE = re.compile(
    r"\b(?:white['’]s plans?|black['’]s plans?|plans? for (?:white|black)|"
    r"pawn structure|formation|thematic (?:break|plan)|typical (?:break|plan|manoeuvre|maneuver)|"
    r"learning objectives?|final remarks?)\b",
    re.IGNORECASE,
)
WIKIBOOK_MOVE_SEGMENT_RE = re.compile(r"^(\d+)\.(\.\.)?\s*([^/]+)$")


@dataclass
class SupplementalPage:
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
class SupplementalChapter:
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
class SupplementalChunk:
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
    embedding: object | None = field(default=None, repr=False)


@dataclass(frozen=True)
class StructureAnchor:
    anchor_id: str
    book_id: str
    chapter_id: str | None
    source_chunk_id: str | None
    label: str
    fen: str
    pawn_key: str
    source_order: int
    confidence: float


@dataclass
class SupplementalCorpus:
    pages: list[SupplementalPage] = field(default_factory=list)
    chapters: list[SupplementalChapter] = field(default_factory=list)
    chunks: list[SupplementalChunk] = field(default_factory=list)
    opening_lines: list[OpeningLineRecord] = field(default_factory=list)
    structure_anchors: list[StructureAnchor] = field(default_factory=list)
    audit: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ParsedPgnMove:
    san: str
    uci: str
    fen_before: str
    fen_after: str
    ply: int


@dataclass
class ParsedPgnGame:
    headers: dict[str, str]
    root_fen: str
    comments: list[tuple[str, str]]
    lines: list[list[ParsedPgnMove]]
    illegal_tokens: int = 0


def stable_id(*parts: object, length: int = 24) -> str:
    material = "\x1f".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:length]


def clean_text(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00ad", "").replace("\u200b", "").replace("\ufeff", "")
    text = re.sub(r"[\t\x0b\x0c]+", " ", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_text(text: str, target: int = TARGET_CHUNK_CHARACTERS, maximum: int = MAX_CHUNK_CHARACTERS) -> list[str]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", clean_text(text)) if part.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_length = 0

    def flush() -> None:
        nonlocal current, current_length
        if current:
            chunks.append("\n\n".join(current).strip())
        current = []
        current_length = 0

    for paragraph in paragraphs:
        segments = [paragraph]
        if len(paragraph) > maximum:
            segments = []
            words = paragraph.split()
            part: list[str] = []
            length = 0
            for word in words:
                if part and length + len(word) + 1 > maximum:
                    segments.append(" ".join(part))
                    part = []
                    length = 0
                part.append(word)
                length += len(word) + 1
            if part:
                segments.append(" ".join(part))
        for segment in segments:
            if current and current_length + len(segment) + 2 > target and current_length >= 700:
                flush()
            current.append(segment)
            current_length += len(segment) + 2
            if current_length >= maximum:
                flush()
    flush()
    return [chunk for chunk in chunks if len(chunk) >= 80]


def pawn_structure_key(board_or_fen: chess.Board | str) -> str:
    board = board_or_fen if isinstance(board_or_fen, chess.Board) else chess.Board(board_or_fen)
    # Keep the rank-8-to-rank-1 ordering of a FEN board field. This makes the
    # key straightforward to reproduce in the TypeScript and Rust runtimes.
    return "".join(
        piece if piece in {"P", "p"} else "."
        for rank in board.board_fen().split("/")
        for piece in "".join(
            "." * int(character) if character.isdigit() else character
            for character in rank
        )
    )


def load_supplemental_manifest(path: Path) -> list[dict]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    sources = payload.get("sources", []) if isinstance(payload, dict) else []
    return [source for source in sources if isinstance(source, dict) and source.get("book")]


def _unescape_header(value: str) -> str:
    return value.replace(r'\"', '"').replace(r"\\", "\\")


def split_pgn_games(text: str) -> Iterator[str]:
    starts = [match.start() for match in re.finditer(r"(?m)^\[Event\s+", text)]
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(text)
        yield text[start:end].strip()


def _clean_san_token(token: str) -> str:
    token = token.replace("0-0-0", "O-O-O").replace("0-0", "O-O")
    token = MOVE_SUFFIX_RE.sub("", token.strip())
    return token.rstrip(",;")


def _format_san_movetext(root: chess.Board, moves: Sequence[ParsedPgnMove]) -> str:
    board = root.copy(stack=False)
    parts: list[str] = []
    for index, move in enumerate(moves):
        if board.turn == chess.WHITE:
            parts.append(f"{board.fullmove_number}. {move.san}")
        elif index == 0:
            parts.append(f"{board.fullmove_number}... {move.san}")
        else:
            parts.append(move.san)
        board.push_uci(move.uci)
    return " ".join(parts)


def parse_annotated_pgn_game(block: str) -> ParsedPgnGame:
    headers = {key: _unescape_header(value) for key, value in PGN_HEADER_RE.findall(block)}
    root = chess.Board(headers.get("FEN")) if headers.get("FEN") else chess.Board()
    movetext = re.sub(r"(?m)^\[[^\n]*\]\s*$", "", block)
    board = root.copy(stack=False)
    path: list[ParsedPgnMove] = []
    lines: list[list[ParsedPgnMove]] = []
    comments: list[tuple[str, str]] = []
    variation_stack: list[tuple[chess.Board, list[ParsedPgnMove], bool]] = []
    skip_variation = False
    illegal_tokens = 0

    for raw_token in PGN_TOKEN_RE.findall(movetext):
        token = raw_token.strip()
        if not token:
            continue
        if token.startswith("{"):
            comment = clean_text(token[1:-1])
            if comment and comment not in {"_", "-KEY-"}:
                comments.append((board.fen(en_passant="legal"), comment))
            continue
        if token == "(":
            variation_stack.append((board.copy(stack=False), list(path), skip_variation))
            if path:
                board = chess.Board(path[-1].fen_before)
                path = path[:-1]
            skip_variation = False
            continue
        if token == ")":
            if path:
                lines.append(list(path))
            if variation_stack:
                board, path, skip_variation = variation_stack.pop()
            continue
        if skip_variation or token.startswith("$") or MOVE_NUMBER_RE.match(token):
            continue
        if token in {"1-0", "0-1", "1/2-1/2", "*"}:
            if path:
                lines.append(list(path))
            continue
        san_token = _clean_san_token(token)
        if not san_token or san_token in {"--", "…", "..."}:
            continue
        try:
            move = board.parse_san(san_token)
        except (ValueError, AssertionError):
            illegal_tokens += 1
            if variation_stack:
                skip_variation = True
            continue
        fen_before = board.fen(en_passant="legal")
        canonical_san = board.san(move)
        uci = move.uci()
        board.push(move)
        path.append(
            ParsedPgnMove(
                san=canonical_san,
                uci=uci,
                fen_before=fen_before,
                fen_after=board.fen(en_passant="legal"),
                ply=board.ply(),
            )
        )
    if path:
        lines.append(list(path))

    unique_lines: dict[tuple[str, ...], list[ParsedPgnMove]] = {}
    for line in lines:
        if not line:
            continue
        key = tuple(move.uci for move in line)
        unique_lines.setdefault(key, line)
    return ParsedPgnGame(
        headers=headers,
        root_fen=root.fen(en_passant="legal"),
        comments=comments,
        lines=list(unique_lines.values()),
        illegal_tokens=illegal_tokens,
    )


def _opening_record(
    *,
    book_id: str,
    chapter_id: str,
    line_kind: str,
    root_fen: str,
    parsed_moves: Sequence[ParsedPgnMove],
    source_order: int,
    source_chunk_id: str | None,
    complete_game: bool,
    identity: str,
) -> OpeningLineRecord:
    root = chess.Board(root_fen)
    moves = tuple(
        OpeningLineMove(
            move_index=index,
            ply=move.ply,
            san=move.san,
            uci=move.uci,
            fen_before=move.fen_before,
            fen_before_key=normalize_fen_key(move.fen_before),
            fen_after=move.fen_after,
            fen_after_key=normalize_fen_key(move.fen_after),
            source_pdf_page=source_order,
            source_printed_page=None,
            source_chunk_id=source_chunk_id,
            confidence=1.0,
        )
        for index, move in enumerate(parsed_moves)
    )
    san_movetext = _format_san_movetext(root, parsed_moves)
    pgn_prefix = ""
    if root.fen(en_passant="legal") != chess.Board().fen(en_passant="legal"):
        escaped_fen = root.fen(en_passant="legal").replace('"', r'\"')
        pgn_prefix = f'[SetUp "1"]\n[FEN "{escaped_fen}"]\n\n'
    line_id = stable_id(book_id, identity, root_fen, *(move.uci for move in parsed_moves))
    return OpeningLineRecord(
        line_id=line_id,
        book_id=book_id,
        chapter_id=chapter_id,
        line_kind=line_kind,
        pgn=f"{pgn_prefix}{san_movetext} {'*' if not complete_game else ''}".strip(),
        san_line=" ".join(move.san for move in parsed_moves),
        uci_line=" ".join(move.uci for move in parsed_moves),
        move_count=len(moves),
        first_pdf_page=source_order,
        last_pdf_page=source_order,
        source_chunk_id=source_chunk_id,
        confidence=1.0,
        complete_game=complete_game,
        moves=moves,
    )


def ingest_pgn_course(book: dict, source: dict) -> SupplementalCorpus:
    source_root = Path(source["path"]).expanduser().resolve()
    manifest_path = source_root / source.get("course_manifest", "_course-manifest.json")
    course_manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    ordered_files = [entry.get("file") for entry in course_manifest.get("chapter_files", []) if entry.get("file")]
    paths = [source_root / name for name in ordered_files if (source_root / name).exists()]
    if not paths:
        paths = sorted(source_root.glob("*.pgn"))

    corpus = SupplementalCorpus()
    source_order = 0
    illegal_tokens = 0
    parsed_games = 0
    anchor_keys: set[tuple[str, str]] = set()
    seen_line_ids: set[str] = set()

    for chapter_index, path in enumerate(paths, start=1):
        fallback_title = re.sub(r"^\d+\s*-\s*", "", path.stem)
        chapter_id = stable_id(book["id"], "pgn-chapter", chapter_index, fallback_title)
        chapter_first_page = source_order + 1
        chapter_last_page = chapter_first_page
        chapter_has_content = False
        first_game = True
        blocks = list(split_pgn_games(path.read_text(encoding="utf-8", errors="replace")))

        for game_index, block in enumerate(blocks, start=1):
            parsed = parse_annotated_pgn_game(block)
            parsed_games += 1
            illegal_tokens += parsed.illegal_tokens
            source_order += 1
            chapter_last_page = source_order
            variation_label = parsed.headers.get("Round") or f"{chapter_index}.{game_index}"
            contextual_comments = []
            for fen, comment in parsed.comments:
                try:
                    board = chess.Board(fen)
                    position_label = f"Position after ply {board.ply()}"
                except ValueError:
                    position_label = "Course note"
                contextual_comments.append(f"{position_label}: {comment}")
            page_text = clean_text("\n\n".join(contextual_comments))
            if len(page_text) < 80:
                first_game = False
                continue
            chapter_has_content = True
            citation = (
                f"{book['title']} — {fallback_title}, Chessable variation {variation_label} "
                "(private user-owned PGN)"
            )
            page = SupplementalPage(
                book_id=book["id"],
                pdf_page=source_order,
                printed_page=None,
                raw_text=page_text,
                clean_text=page_text,
                extraction_method="pgn-comments",
                extraction_confidence=1.0,
                contains_chess_notation=bool(parsed.lines),
                chapter_id=chapter_id,
                chapter_title=fallback_title,
            )
            corpus.pages.append(page)
            page_chunks: list[SupplementalChunk] = []
            for sequence, chunk_text in enumerate(split_text(page_text), start=1):
                text_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
                chunk = SupplementalChunk(
                    chunk_id=stable_id(book["id"], source_order, sequence, text_hash),
                    book_id=book["id"],
                    chapter_id=chapter_id,
                    chapter_title=fallback_title,
                    pdf_page_start=source_order,
                    pdf_page_end=source_order,
                    printed_page_start=None,
                    printed_page_end=None,
                    sequence_in_page=sequence,
                    text=chunk_text,
                    word_count=len(re.findall(r"\S+", chunk_text)),
                    estimated_tokens=max(1, math.ceil(len(chunk_text) / 4)),
                    citation=citation,
                    access_scope=book["access_scope"],
                    diagram_candidate=False,
                    contains_chess_notation=bool(parsed.lines),
                    text_sha256=text_hash,
                )
                corpus.chunks.append(chunk)
                page_chunks.append(chunk)
            source_chunk_id = page_chunks[0].chunk_id if page_chunks else None

            complete_game = parsed.headers.get("Result", "*") != "*"
            for line_index, parsed_line in enumerate(parsed.lines[:256], start=1):
                record = _opening_record(
                    book_id=book["id"],
                    chapter_id=chapter_id,
                    line_kind="private_course_variation",
                    root_fen=parsed.root_fen,
                    parsed_moves=parsed_line,
                    source_order=source_order,
                    source_chunk_id=source_chunk_id,
                    complete_game=complete_game and line_index == 1,
                    identity=f"{path.name}:{game_index}:{line_index}",
                )
                if record.line_id not in seen_line_ids:
                    seen_line_ids.add(record.line_id)
                    corpus.opening_lines.append(record)

            root_comment = parsed.comments[0][1] if parsed.comments else ""
            should_anchor = bool(parsed.headers.get("FEN")) and (
                first_game or PLAN_LANGUAGE_RE.search(page_text) is not None
            )
            if should_anchor and source_chunk_id:
                try:
                    root_board = chess.Board(parsed.root_fen)
                    pawn_key = pawn_structure_key(root_board)
                    anchor_key = (chapter_id, pawn_key)
                    if anchor_key not in anchor_keys and pawn_key.count("P") + pawn_key.count("p") >= 4:
                        anchor_keys.add(anchor_key)
                        corpus.structure_anchors.append(
                            StructureAnchor(
                                anchor_id=stable_id(book["id"], chapter_id, pawn_key),
                                book_id=book["id"],
                                chapter_id=chapter_id,
                                source_chunk_id=source_chunk_id,
                                label=fallback_title,
                                fen=root_board.fen(en_passant="legal"),
                                pawn_key=pawn_key,
                                source_order=source_order,
                                confidence=1.0 if PLAN_LANGUAGE_RE.search(root_comment) else 0.96,
                            )
                        )
                except ValueError:
                    pass
            first_game = False

        corpus.chapters.append(
            SupplementalChapter(
                chapter_id=chapter_id,
                book_id=book["id"],
                order_index=chapter_index,
                number=str(chapter_index),
                title=fallback_title,
                printed_page_start=None,
                pdf_page_start=chapter_first_page if chapter_has_content else None,
                pdf_page_end=chapter_last_page if chapter_has_content else None,
                accessible_in_excerpt=chapter_has_content,
                detection_method="pgn-course-manifest",
                confidence=1.0,
            )
        )

    corpus.audit = {
        "book_id": book["id"],
        "path": str(source_root),
        "source_type": "pgn_course",
        "source_files": len(paths),
        "games": parsed_games,
        "pages": len(corpus.pages),
        "chapters": len(corpus.chapters),
        "accessible_chapters": sum(chapter.accessible_in_excerpt for chapter in corpus.chapters),
        "chunks": len(corpus.chunks),
        "opening_lines": len(corpus.opening_lines),
        "opening_line_moves": sum(len(line.moves) for line in corpus.opening_lines),
        "structure_anchors": len(corpus.structure_anchors),
        "illegal_tokens": illegal_tokens,
        "extraction_errors": [],
        "ocr_failures": [],
        "ocr_pages": 0,
    }
    return corpus


def _wikibook_move_path(title: str) -> list[str] | None:
    prefix = "Chess Opening Theory/"
    if not title.startswith(prefix):
        return [] if title == "Chess Opening Theory" else None
    moves: list[str] = []
    expected_ply = 1
    for segment in title[len(prefix):].split("/"):
        match = WIKIBOOK_MOVE_SEGMENT_RE.match(segment.replace("_", " ").strip())
        if not match:
            return None
        move_number = int(match.group(1))
        black = bool(match.group(2))
        ply = (move_number - 1) * 2 + (2 if black else 1)
        if ply != expected_ply:
            return None
        moves.append(match.group(3).strip())
        expected_ply += 1
    return moves


def _wikibook_group_title(moves: Sequence[str]) -> str:
    if not moves:
        return "Opening principles and first moves"
    if len(moves) == 1:
        return f"{moves[0]} opening family"
    return f"{moves[0]} {moves[1]} opening family"


def _parsed_line_from_san(moves: Sequence[str]) -> list[ParsedPgnMove] | None:
    board = chess.Board()
    parsed: list[ParsedPgnMove] = []
    for raw_san in moves:
        san = _clean_san_token(raw_san)
        try:
            move = board.parse_san(san)
        except (ValueError, AssertionError):
            return None
        fen_before = board.fen(en_passant="legal")
        canonical_san = board.san(move)
        uci = move.uci()
        board.push(move)
        parsed.append(
            ParsedPgnMove(
                san=canonical_san,
                uci=uci,
                fen_before=fen_before,
                fen_after=board.fen(en_passant="legal"),
                ply=board.ply(),
            )
        )
    return parsed


def ingest_wikibook_jsonl(book: dict, source: dict) -> SupplementalCorpus:
    source_path = Path(source["path"]).expanduser().resolve()
    records = [json.loads(line) for line in source_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    corpus = SupplementalCorpus()
    chapter_by_group: dict[str, SupplementalChapter] = {}
    chapter_page_bounds: dict[str, list[int]] = {}
    seen_line_ids: set[str] = set()

    for source_order, record in enumerate(records, start=1):
        title = str(record.get("title") or "").strip()
        move_path = _wikibook_move_path(title)
        if move_path is None:
            continue
        text = clean_text(record.get("extract") or "")
        if len(text) < 80:
            continue
        group_title = _wikibook_group_title(move_path)
        chapter = chapter_by_group.get(group_title)
        if chapter is None:
            chapter_id = stable_id(book["id"], "wikibook-family", group_title)
            chapter = SupplementalChapter(
                chapter_id=chapter_id,
                book_id=book["id"],
                order_index=len(chapter_by_group) + 1,
                number=None,
                title=group_title,
                printed_page_start=None,
                pdf_page_start=source_order,
                pdf_page_end=source_order,
                accessible_in_excerpt=True,
                detection_method="wikibooks-move-family",
                confidence=1.0,
            )
            chapter_by_group[group_title] = chapter
            chapter_page_bounds[chapter_id] = [source_order, source_order]
        else:
            chapter_page_bounds[chapter.chapter_id][1] = source_order

        display_title = title.replace("Chess Opening Theory/", "").replace("_", " ") or "Starting position"
        permalink = str(record.get("permalink") or record.get("url") or book.get("product_url") or "")
        revision_id = record.get("revid")
        citation = f"Wikibooks Chess Opening Theory — {display_title}"
        if revision_id:
            citation += f", revision {revision_id}"
        page = SupplementalPage(
            book_id=book["id"],
            pdf_page=source_order,
            printed_page=None,
            raw_text=text,
            clean_text=text,
            extraction_method="mediawiki-plaintext",
            extraction_confidence=1.0,
            contains_chess_notation=bool(move_path),
            chapter_id=chapter.chapter_id,
            chapter_title=group_title,
        )
        corpus.pages.append(page)
        page_chunks: list[SupplementalChunk] = []
        for sequence, chunk_text in enumerate(split_text(text), start=1):
            if permalink:
                chunk_text = f"Source page: {permalink}\n\n{chunk_text}"
            text_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
            chunk = SupplementalChunk(
                chunk_id=stable_id(book["id"], source_order, sequence, text_hash),
                book_id=book["id"],
                chapter_id=chapter.chapter_id,
                chapter_title=group_title,
                pdf_page_start=source_order,
                pdf_page_end=source_order,
                printed_page_start=None,
                printed_page_end=None,
                sequence_in_page=sequence,
                text=chunk_text,
                word_count=len(re.findall(r"\S+", chunk_text)),
                estimated_tokens=max(1, math.ceil(len(chunk_text) / 4)),
                citation=citation,
                access_scope=book["access_scope"],
                diagram_candidate=False,
                contains_chess_notation=bool(move_path),
                text_sha256=text_hash,
            )
            corpus.chunks.append(chunk)
            page_chunks.append(chunk)

        parsed_line = _parsed_line_from_san(move_path)
        if parsed_line and page_chunks:
            line = _opening_record(
                book_id=book["id"],
                chapter_id=chapter.chapter_id,
                line_kind="open_wikibook_position",
                root_fen=chess.STARTING_FEN,
                parsed_moves=parsed_line,
                source_order=source_order,
                source_chunk_id=page_chunks[0].chunk_id,
                complete_game=False,
                identity=f"wikibook:{record.get('pageid')}:{revision_id}",
            )
            if line.line_id not in seen_line_ids:
                seen_line_ids.add(line.line_id)
                corpus.opening_lines.append(line)

    for chapter in chapter_by_group.values():
        bounds = chapter_page_bounds[chapter.chapter_id]
        chapter.pdf_page_start, chapter.pdf_page_end = bounds
        corpus.chapters.append(chapter)
    corpus.chapters.sort(key=lambda chapter: chapter.order_index)
    corpus.audit = {
        "book_id": book["id"],
        "path": str(source_path),
        "source_type": "wikibooks_jsonl",
        "source_records": len(records),
        "pages": len(corpus.pages),
        "chapters": len(corpus.chapters),
        "accessible_chapters": len(corpus.chapters),
        "chunks": len(corpus.chunks),
        "opening_lines": len(corpus.opening_lines),
        "opening_line_moves": sum(len(line.moves) for line in corpus.opening_lines),
        "structure_anchors": 0,
        "extraction_errors": [],
        "ocr_failures": [],
        "ocr_pages": 0,
    }
    return corpus


def _plain_text_sections(text: str) -> list[tuple[str, str]]:
    text = clean_text(text)
    start_marker = re.search(r"\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*", text)
    if start_marker:
        text = text[start_marker.end():]
    end_marker = re.search(r"\*\*\* END OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*", text)
    if end_marker:
        text = text[:end_marker.start()]
    heading_re = re.compile(
        r"(?m)^(?P<title>(?:CHAPTER\s+[IVXLCDM]+|PART\s+[IVXLCDM]+|"
        r"\d+\.\s+[A-Z][A-Z0-9 ,:'\-]+|[A-Z][A-Z0-9 ,:'\-]{8,}))\s*$"
    )
    matches = list(heading_re.finditer(text))
    sections: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = clean_text(text[match.end():end])
        title = clean_text(match.group("title")).title()
        if len(body) >= 120:
            sections.append((title, body))
    return sections or [("Complete text", text)]


def ingest_plain_text(book: dict, source: dict) -> SupplementalCorpus:
    source_path = Path(source["path"]).expanduser().resolve()
    sections = _plain_text_sections(source_path.read_text(encoding="utf-8", errors="replace"))
    corpus = SupplementalCorpus()
    source_order = 0
    for chapter_index, (title, body) in enumerate(sections, start=1):
        chapter_id = stable_id(book["id"], "text-chapter", chapter_index, title)
        chunks = split_text(body)
        if not chunks:
            continue
        first_page = source_order + 1
        for sequence, chunk_text in enumerate(chunks, start=1):
            source_order += 1
            citation = f"{book['title']} — {title} (Project Gutenberg eBook {source.get('ebook_id', '')})"
            page = SupplementalPage(
                book_id=book["id"],
                pdf_page=source_order,
                printed_page=None,
                raw_text=chunk_text,
                clean_text=chunk_text,
                extraction_method="gutenberg-plaintext",
                extraction_confidence=1.0,
                contains_chess_notation=bool(re.search(r"\b(?:O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8])\b", chunk_text)),
                chapter_id=chapter_id,
                chapter_title=title,
            )
            corpus.pages.append(page)
            text_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
            corpus.chunks.append(
                SupplementalChunk(
                    chunk_id=stable_id(book["id"], source_order, sequence, text_hash),
                    book_id=book["id"],
                    chapter_id=chapter_id,
                    chapter_title=title,
                    pdf_page_start=source_order,
                    pdf_page_end=source_order,
                    printed_page_start=None,
                    printed_page_end=None,
                    sequence_in_page=sequence,
                    text=chunk_text,
                    word_count=len(re.findall(r"\S+", chunk_text)),
                    estimated_tokens=max(1, math.ceil(len(chunk_text) / 4)),
                    citation=citation,
                    access_scope=book["access_scope"],
                    diagram_candidate="[Illustration" in chunk_text,
                    contains_chess_notation=page.contains_chess_notation,
                    text_sha256=text_hash,
                )
            )
        corpus.chapters.append(
            SupplementalChapter(
                chapter_id=chapter_id,
                book_id=book["id"],
                order_index=chapter_index,
                number=str(chapter_index),
                title=title,
                printed_page_start=None,
                pdf_page_start=first_page,
                pdf_page_end=source_order,
                accessible_in_excerpt=True,
                detection_method="plaintext-heading",
                confidence=0.9,
            )
        )
    corpus.audit = {
        "book_id": book["id"],
        "path": str(source_path),
        "source_type": "plain_text",
        "pages": len(corpus.pages),
        "chapters": len(corpus.chapters),
        "accessible_chapters": len(corpus.chapters),
        "chunks": len(corpus.chunks),
        "opening_lines": 0,
        "opening_line_moves": 0,
        "structure_anchors": 0,
        "extraction_errors": [],
        "ocr_failures": [],
        "ocr_pages": 0,
    }
    return corpus


def ingest_supplemental_source(source: dict) -> SupplementalCorpus:
    book = dict(source["book"])
    book.setdefault("access_scope", "open_licensed")
    kind = source.get("type")
    if kind == "pgn_course":
        return ingest_pgn_course(book, source)
    if kind == "wikibooks_jsonl":
        return ingest_wikibook_jsonl(book, source)
    if kind == "plain_text":
        return ingest_plain_text(book, source)
    raise ValueError(f"Unsupported supplemental chess-book source type: {kind}")
