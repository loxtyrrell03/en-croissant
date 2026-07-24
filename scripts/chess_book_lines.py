"""Legality-checked opening-line extraction for the chess-book corpus.

Publisher PDFs frequently use figurine algebraic notation and prose-heavy
variation trees instead of PGN. This module converts only recoverable lines:
every accepted token must be legal from an already rooted position, and every
stored move carries exact before/after FEN plus UCI and source-page metadata.
Ambiguous fragments are reported rather than guessed.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import chess


FIGURINE_TRANSLATION = str.maketrans(
    {
        "\u2654": "K",
        "\u2655": "Q",
        "\u2656": "R",
        "\u2657": "B",
        "\u2658": "N",
        "\u265a": "K",
        "\u265b": "Q",
        "\u265c": "R",
        "\u265d": "B",
        "\u265e": "N",
        "\u00a2": "K",
        "\u00a3": "Q",
        "\u00a6": "R",
        "\u00a5": "B",
        "\u00a4": "N",
        "\u2020": "+",
        "\u2021": "+",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u2026": "...",
    }
)

SAN_CORE = r"(?:O-O-O|O-O|[KQRBN](?:[a-h1-8]{0,2})?x?[a-h][1-8](?:=[QRBN])?|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?"
ANNOTATION_CHARS = re.escape("\u00b2\u00b323\u00a9\u0192\u00b1\u2213\u221e=")
MOVE_TOKEN_RE = re.compile(
    rf"(?<![A-Za-z0-9])(?:(?P<number>\d{{1,3}})\s*\.(?P<black>\s*\.\s*\.)?\s*)?"
    rf"(?P<san>{SAN_CORE})(?P<annotation>(?:[!?]+|N|[{ANNOTATION_CHARS}])*)(?![A-Za-z0-9])"
)
RESULT_RE = re.compile(r"(?<!\d)(?:1-0|0-1|1/2-1/2|\u00bd-\u00bd)(?!\d)")


@dataclass(frozen=True)
class OpeningMoveToken:
    san: str
    move_number: int | None
    black_move: bool
    start: int
    end: int

    @property
    def expected_ply(self) -> int | None:
        if self.move_number is None:
            return None
        return (self.move_number - 1) * 2 + int(self.black_move)


@dataclass
class OpeningLineNode:
    node_id: int
    parent: OpeningLineNode | None
    board: chess.Board
    san: str = ""
    uci: str = ""
    source_pdf_page: int = 0
    source_printed_page: int | None = None
    source_chunk_id: str | None = None
    source_offset: int = 0
    chapter_id: str | None = None
    confidence: float = 1.0
    children: list[OpeningLineNode] = field(default_factory=list)

    @property
    def ply(self) -> int:
        return self.board.ply()

    @property
    def fen_key(self) -> str:
        return normalize_fen_key(self.board)


@dataclass(frozen=True)
class OpeningLineMove:
    move_index: int
    ply: int
    san: str
    uci: str
    fen_before: str
    fen_before_key: str
    fen_after: str
    fen_after_key: str
    source_pdf_page: int
    source_printed_page: int | None
    source_chunk_id: str | None
    confidence: float


@dataclass(frozen=True)
class OpeningLineRecord:
    line_id: str
    book_id: str
    chapter_id: str | None
    line_kind: str
    pgn: str
    san_line: str
    uci_line: str
    move_count: int
    first_pdf_page: int
    last_pdf_page: int
    source_chunk_id: str | None
    confidence: float
    complete_game: bool
    moves: tuple[OpeningLineMove, ...]


def normalize_book_notation(text: str) -> str:
    return str(text or "").translate(FIGURINE_TRANSLATION).replace("0-0-0", "O-O-O").replace(
        "0-0", "O-O"
    )


def normalize_fen_key(board_or_fen: chess.Board | str) -> str:
    board = board_or_fen if isinstance(board_or_fen, chess.Board) else chess.Board(board_or_fen)
    return " ".join(board.fen(en_passant="legal").split()[:4])


def tokenize_opening_moves(text: str) -> list[OpeningMoveToken]:
    normalized = normalize_book_notation(text)
    tokens: list[OpeningMoveToken] = []
    for match in MOVE_TOKEN_RE.finditer(normalized):
        # Coordinate prose such as "the h5-square" and long algebraic f2-f4
        # must not masquerade as a SAN token.
        before = normalized[match.start() - 1] if match.start() else ""
        after = normalized[match.end()] if match.end() < len(normalized) else ""
        if before == "-" or after == "-":
            continue
        move_number = int(match.group("number")) if match.group("number") else None
        tokens.append(
            OpeningMoveToken(
                san=match.group("san"),
                move_number=move_number,
                black_move=bool(match.group("black")),
                start=match.start(),
                end=match.end(),
            )
        )
    return tokens


def _move_separator_only(gap: str) -> bool:
    gap = re.sub(r"\[[^\]]*(?:diagram|position)[^\]]*\]", " ", gap, flags=re.IGNORECASE)
    return bool(re.fullmatch(r"[\s,;:!?+()\[\]{}=\u00b1\u2213\u221e\u00b2\u00b3\u00a9\u01922-]*", gap))


def _parse_san(board: chess.Board, san: str) -> chess.Move | None:
    try:
        return board.parse_san(san)
    except (ValueError, AssertionError):
        # A PDF can print a check marker inconsistently. The underlying move
        # is still safe to map when the unmarked SAN is uniquely legal.
        if san.endswith(("+", "#")):
            try:
                return board.parse_san(san[:-1])
            except (ValueError, AssertionError):
                return None
        return None


def _stable_id(*parts: object, length: int = 24) -> str:
    material = "\x1f".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:length]


def _page_value(page: object, name: str, default=None):
    return page.get(name, default) if isinstance(page, dict) else getattr(page, name, default)


def _chunk_for_move(chunks_by_page: dict[int, list[object]], page_number: int, san: str) -> str | None:
    candidates = chunks_by_page.get(page_number, [])
    if not candidates:
        return None
    normalized_san = san.rstrip("+#")
    ranked: list[tuple[int, int, str]] = []
    for index, chunk in enumerate(candidates):
        text = normalize_book_notation(_page_value(chunk, "text", ""))
        score = 10 if normalized_san and normalized_san in text else 0
        score += 2 if _page_value(chunk, "contains_chess_notation", False) else 0
        ranked.append((score, -index, str(_page_value(chunk, "chunk_id", ""))))
    ranked.sort(reverse=True)
    return ranked[0][2] or None


def _candidate_anchor(
    token: OpeningMoveToken,
    current: OpeningLineNode,
    anchors_by_ply: dict[int, dict[str, OpeningLineNode]],
    chapter_id: str | None,
    page_number: int,
) -> tuple[OpeningLineNode | None, float, str]:
    expected_ply = token.expected_ply
    if expected_ply is None:
        return current, 0.98, "continuation"
    if current.ply == expected_ply and _parse_san(current.board, token.san):
        return current, 0.98, "current"

    candidates: list[tuple[int, OpeningLineNode]] = []
    for anchor in anchors_by_ply.get(expected_ply, {}).values():
        if not _parse_san(anchor.board, token.san):
            continue
        score = 0
        if chapter_id and anchor.chapter_id == chapter_id:
            score += 50
        distance = abs(page_number - anchor.source_pdf_page)
        score += max(0, 30 - distance * 3)
        if anchor.source_pdf_page <= page_number:
            score += 5
        candidates.append((score, anchor))
    if not candidates:
        return None, 0.0, "unrooted"
    candidates.sort(key=lambda item: (item[0], item[1].source_pdf_page, item[1].node_id), reverse=True)
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        return None, 0.0, "ambiguous"
    confidence = 0.92 if candidates[0][0] >= 50 else 0.84
    return candidates[0][1], confidence, "anchored"


def _path_nodes(leaf: OpeningLineNode) -> list[OpeningLineNode]:
    nodes: list[OpeningLineNode] = []
    current: OpeningLineNode | None = leaf
    while current is not None and current.parent is not None:
        nodes.append(current)
        current = current.parent
    nodes.reverse()
    return nodes


def extract_opening_book_lines(
    book: dict,
    pages: Sequence[object],
    chunks: Sequence[object],
) -> tuple[list[OpeningLineRecord], dict]:
    """Extract every safely rooted legal line available in one opening book."""

    initial_board = chess.Board()
    root = OpeningLineNode(node_id=0, parent=None, board=initial_board)
    anchors_by_ply: dict[int, dict[str, OpeningLineNode]] = defaultdict(dict)
    anchors_by_ply[0][root.fen_key] = root
    nodes: list[OpeningLineNode] = [root]
    chunks_by_page: dict[int, list[object]] = defaultdict(list)
    for chunk in chunks:
        chunks_by_page[int(_page_value(chunk, "pdf_page_start", 0))].append(chunk)

    stats = {
        "book_id": book["id"],
        "pages_with_notation": 0,
        "move_tokens": 0,
        "accepted_tokens": 0,
        "unrooted_tokens": 0,
        "ambiguous_tokens": 0,
        "illegal_tokens": 0,
        "unresolved": [],
    }
    carry_node = root
    previous_page = 0
    previous_chapter: str | None = None

    for page in sorted(pages, key=lambda item: int(_page_value(item, "pdf_page", 0))):
        if not _page_value(page, "contains_chess_notation", False):
            continue
        page_number = int(_page_value(page, "pdf_page", 0))
        chapter_id = _page_value(page, "chapter_id")
        printed_page = _page_value(page, "printed_page")
        text = normalize_book_notation(_page_value(page, "clean_text", _page_value(page, "text", "")))
        tokens = tokenize_opening_moves(text)
        if not tokens:
            continue
        stats["pages_with_notation"] += 1
        stats["move_tokens"] += len(tokens)
        if page_number != previous_page + 1 or (chapter_id and previous_chapter and chapter_id != previous_chapter):
            carry_node = root
        current = carry_node
        stack: list[tuple[OpeningLineNode, OpeningLineNode | None]] = []
        previous_token_end = 0

        for token in tokens:
            gap = text[previous_token_end : token.start]
            for delimiter in re.findall(r"[()\[\]]", gap):
                if delimiter in "([":
                    stack.append((current, current.parent))
                    if current.parent is not None:
                        current = current.parent
                elif stack:
                    current, _ = stack.pop()

            if token.move_number is None and not _move_separator_only(gap):
                previous_token_end = token.end
                continue

            anchor, confidence, reason = _candidate_anchor(
                token, current, anchors_by_ply, chapter_id, page_number
            )
            if anchor is None:
                stats[f"{reason}_tokens"] += 1
                if len(stats["unresolved"]) < 80:
                    stats["unresolved"].append(
                        {"pdf_page": page_number, "san": token.san, "reason": reason}
                    )
                previous_token_end = token.end
                continue
            move = _parse_san(anchor.board, token.san)
            if move is None:
                stats["illegal_tokens"] += 1
                if len(stats["unresolved"]) < 80:
                    stats["unresolved"].append(
                        {"pdf_page": page_number, "san": token.san, "reason": "illegal"}
                    )
                previous_token_end = token.end
                continue

            before = anchor.board.copy(stack=False)
            normalized_san = before.san(move)
            after = before.copy(stack=False)
            after.push(move)
            node = OpeningLineNode(
                node_id=len(nodes),
                parent=anchor,
                board=after,
                san=normalized_san,
                uci=move.uci(),
                source_pdf_page=page_number,
                source_printed_page=int(printed_page) if printed_page is not None else None,
                source_chunk_id=_chunk_for_move(chunks_by_page, page_number, normalized_san),
                source_offset=token.start,
                chapter_id=chapter_id,
                confidence=confidence,
            )
            anchor.children.append(node)
            nodes.append(node)
            anchors_by_ply[node.ply].setdefault(node.fen_key, node)
            current = node
            carry_node = node if not stack else carry_node
            stats["accepted_tokens"] += 1
            previous_token_end = token.end

        previous_page = page_number
        previous_chapter = chapter_id

    records: list[OpeningLineRecord] = []
    seen: set[tuple[str, int, str | None]] = set()
    for leaf in nodes[1:]:
        if leaf.children:
            continue
        path = _path_nodes(leaf)
        if not path:
            continue
        uci_line = " ".join(node.uci for node in path)
        dedupe_key = (uci_line, leaf.source_pdf_page, leaf.source_chunk_id)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        board = chess.Board()
        moves: list[OpeningLineMove] = []
        for index, node in enumerate(path):
            before = board.copy(stack=False)
            move = chess.Move.from_uci(node.uci)
            if move not in board.legal_moves:
                moves = []
                break
            san = board.san(move)
            board.push(move)
            moves.append(
                OpeningLineMove(
                    move_index=index,
                    ply=index + 1,
                    san=san,
                    uci=node.uci,
                    fen_before=before.fen(en_passant="legal"),
                    fen_before_key=normalize_fen_key(before),
                    fen_after=board.fen(en_passant="legal"),
                    fen_after_key=normalize_fen_key(board),
                    source_pdf_page=node.source_pdf_page,
                    source_printed_page=node.source_printed_page,
                    source_chunk_id=node.source_chunk_id,
                    confidence=node.confidence,
                )
            )
        if not moves:
            continue
        page_text = next(
            (
                normalize_book_notation(_page_value(page, "clean_text", _page_value(page, "text", "")))
                for page in pages
                if int(_page_value(page, "pdf_page", 0)) == leaf.source_pdf_page
            ),
            "",
        )
        complete_game = len(moves) >= 20 and bool(RESULT_RE.search(page_text))
        line_kind = "illustrative_game" if complete_game or len(moves) >= 36 else "variation"
        pgn = chess.Board().variation_san([chess.Move.from_uci(move.uci) for move in moves])
        line_id = _stable_id(book["id"], uci_line, leaf.source_pdf_page, leaf.source_offset)
        records.append(
            OpeningLineRecord(
                line_id=line_id,
                book_id=book["id"],
                chapter_id=leaf.chapter_id,
                line_kind=line_kind,
                pgn=pgn,
                san_line=" ".join(move.san for move in moves),
                uci_line=uci_line,
                move_count=len(moves),
                first_pdf_page=min(move.source_pdf_page for move in moves),
                last_pdf_page=max(move.source_pdf_page for move in moves),
                source_chunk_id=leaf.source_chunk_id,
                confidence=min(move.confidence for move in moves),
                complete_game=complete_game,
                moves=tuple(moves),
            )
        )

    records.sort(key=lambda line: (line.book_id, line.first_pdf_page, line.pgn, line.line_id))
    stats.update(
        {
            "lines": len(records),
            "variations": sum(line.line_kind == "variation" for line in records),
            "illustrative_games": sum(line.line_kind == "illustrative_game" for line in records),
            "complete_games": sum(line.complete_game for line in records),
            "mapped_line_moves": sum(len(line.moves) for line in records),
            "unique_positions": len(
                {move.fen_before_key for line in records for move in line.moves}
                | {move.fen_after_key for line in records for move in line.moves}
            ),
            "acceptance_rate": (
                round(stats["accepted_tokens"] / stats["move_tokens"], 4)
                if stats["move_tokens"]
                else 0
            ),
        }
    )
    return records, stats


def opening_line_to_dict(line: OpeningLineRecord) -> dict:
    return {
        "line_id": line.line_id,
        "book_id": line.book_id,
        "chapter_id": line.chapter_id,
        "line_kind": line.line_kind,
        "pgn": line.pgn,
        "san_line": line.san_line,
        "uci_line": line.uci_line,
        "move_count": line.move_count,
        "first_pdf_page": line.first_pdf_page,
        "last_pdf_page": line.last_pdf_page,
        "source_chunk_id": line.source_chunk_id,
        "confidence": round(line.confidence, 4),
        "complete_game": line.complete_game,
        "moves": [
            {
                "move_index": move.move_index,
                "ply": move.ply,
                "san": move.san,
                "uci": move.uci,
                "fen_before": move.fen_before,
                "fen_before_key": move.fen_before_key,
                "fen_after": move.fen_after,
                "fen_after_key": move.fen_after_key,
                "source_pdf_page": move.source_pdf_page,
                "source_printed_page": move.source_printed_page,
                "source_chunk_id": move.source_chunk_id,
                "confidence": round(move.confidence, 4),
            }
            for move in line.moves
        ],
    }


def opening_lines_to_pgn(lines: Iterable[OpeningLineRecord], books_by_id: dict[str, dict]) -> str:
    games: list[str] = []
    for line in lines:
        book = books_by_id[line.book_id]
        headers = [
            f'[Event "{book["title"].replace(chr(34), chr(39))}"]',
            f'[Site "PDF pages {line.first_pdf_page}-{line.last_pdf_page}"]',
            '[Date "????.??.??"]',
            '[Round "-"]',
            f'[White "Book line {line.line_id}"]',
            f'[Black "{book["author"].replace(chr(34), chr(39))}"]',
            '[Result "*"]',
            f'[BookId "{line.book_id}"]',
            f'[LineKind "{line.line_kind}"]',
        ]
        games.append("\n".join(headers) + "\n\n" + line.pgn + " *\n")
    return "\n".join(games)
