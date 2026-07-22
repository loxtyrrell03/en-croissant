#!/usr/bin/env python3
"""Generate Southall opponent style reports from existing prep PGNs.

The reports are written back into each player's Southall Files-side folder.
They use the verified app-side combined OTB PGNs from the Southall manifest,
the existing Chess.com opening comparison audit, and optional Stockfish
sampling for practical mistake-pattern evidence.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import chess
import chess.engine
import chess.pgn
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


DEFAULT_PREP_ROOT = Path(
    r"C:\Users\loxty\Documents\EnCroissant\Southall Congress 260620 U2400 player games"
)
DEFAULT_STOCKFISH = Path(
    r"C:\Users\loxty\.codex\worktrees\027f\chessmistaketrainer\stockfish-windows-x86-64-avx2.exe"
)

EVENT_NAME = "Southall Congress 260620 U2400"
REPORT_DATE = "2026-06-19"

THEME = {
    "ink": colors.HexColor("#1B1D23"),
    "muted": colors.HexColor("#59606D"),
    "line": colors.HexColor("#D9DEE7"),
    "soft": colors.HexColor("#F4F7FB"),
    "accent": colors.HexColor("#1F6F78"),
    "accent2": colors.HexColor("#8A5A16"),
    "danger": colors.HexColor("#A23B3B"),
    "good": colors.HexColor("#2F6B43"),
}


@dataclass
class GameRecord:
    headers: dict[str, str]
    moves: list[chess.Move]
    san_moves: list[str]
    target_color: chess.Color
    target_name: str

    @property
    def date(self) -> str:
        return self.headers.get("Date", "????.??.??")

    @property
    def event(self) -> str:
        return self.headers.get("Event", "?")

    @property
    def white(self) -> str:
        return self.headers.get("White", "?")

    @property
    def black(self) -> str:
        return self.headers.get("Black", "?")

    @property
    def result(self) -> str:
        return self.headers.get("Result", "*")

    @property
    def eco(self) -> str:
        return self.headers.get("ECO", "?") or "?"

    @property
    def opening(self) -> str:
        return self.headers.get("Opening", "") or ""

    @property
    def side(self) -> str:
        return "White" if self.target_color == chess.WHITE else "Black"

    @property
    def opponent(self) -> str:
        return self.black if self.target_color == chess.WHITE else self.white

    @property
    def ply_count(self) -> int:
        return len(self.moves)

    @property
    def title(self) -> str:
        return f"{self.date} {self.white} - {self.black} {self.result}"


def eprint(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def parse_date_key(value: str) -> tuple[int, int, int]:
    parts = re.split(r"[.\-]", value or "")
    parsed: list[int] = []
    for item in parts[:3]:
        if item.isdigit() and not set(item) == {"?"}:
            parsed.append(int(item))
        else:
            parsed.append(0)
    while len(parsed) < 3:
        parsed.append(0)
    return tuple(parsed[:3])  # type: ignore[return-value]


def date_display(value: str) -> str:
    if not value or value.startswith("????"):
        return "unknown date"
    return value.replace("-", ".")


def result_score(result: str, target_color: chess.Color) -> float | None:
    if result == "1-0":
        return 1.0 if target_color == chess.WHITE else 0.0
    if result == "0-1":
        return 0.0 if target_color == chess.WHITE else 1.0
    if result == "1/2-1/2":
        return 0.5
    return None


def pct(part: int | float, whole: int | float) -> str:
    if not whole:
        return "0%"
    return f"{100.0 * part / whole:.1f}%"


def fmt_cp(value: float | int | None) -> str:
    if value is None or math.isnan(float(value)):
        return "-"
    return f"{value:+.2f}" if abs(float(value)) < 10 else f"{float(value) / 100.0:+.2f}"


def list_top(counter: Counter[str], limit: int = 6) -> list[dict[str, Any]]:
    total = sum(counter.values())
    rows = []
    for item, count in counter.most_common(limit):
        rows.append({"item": item, "count": count, "pct": round(100.0 * count / total, 1) if total else 0})
    return rows


def game_movetext_key(moves: list[chess.Move]) -> str:
    return " ".join(move.uci() for move in moves)


def normalized_date_token(value: str) -> str:
    year, month, day = parse_date_key(value)
    if year:
        return f"{year:04d}.{month:02d}.{day:02d}"
    return re.sub(r"[^0-9?]+", ".", value or "")


def dedupe_key(headers: dict[str, str], moves: list[chess.Move]) -> tuple[str, str, str]:
    date = normalized_date_token(headers.get("Date", ""))
    result = headers.get("Result", "")
    movetext = game_movetext_key(moves)
    return (date, result, movetext)


def read_game_records(pgn_path: Path, target_name: str) -> tuple[list[GameRecord], int]:
    records: list[GameRecord] = []
    raw_count = 0
    seen: set[tuple[str, str, str]] = set()
    target_key = normalize_name(target_name)
    with pgn_path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        while True:
            game = chess.pgn.read_game(handle)
            if game is None:
                break
            raw_count += 1
            headers = {str(k): str(v) for k, v in game.headers.items()}
            white_key = normalize_name(headers.get("White", ""))
            black_key = normalize_name(headers.get("Black", ""))
            if white_key == target_key:
                target_color = chess.WHITE
            elif black_key == target_key:
                target_color = chess.BLACK
            else:
                continue

            board = game.board()
            moves: list[chess.Move] = []
            san_moves: list[str] = []
            for move in game.mainline_moves():
                try:
                    san_moves.append(board.san(move))
                    board.push(move)
                    moves.append(move)
                except Exception:
                    break
            key = dedupe_key(headers, moves)
            if key in seen:
                continue
            seen.add(key)
            records.append(GameRecord(headers, moves, san_moves, target_color, target_name))
    return records, raw_count


def read_prep_lines(folder: Path) -> list[dict[str, str]]:
    lines: list[dict[str, str]] = []
    for path in sorted(folder.glob("*prep.pgn")):
        with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
            game = chess.pgn.read_game(handle)
        if game is None:
            continue
        board = game.board()
        sans: list[str] = []
        comments: list[str] = []
        node = game
        for move in game.mainline_moves():
            sans.append(board.san(move))
            board.push(move)
        node = game
        while node.variations:
            node = node.variation(0)
            if node.comment:
                comments.append(re.sub(r"\s+", " ", node.comment).strip())
        orientation = game.headers.get("Orientation", "")
        lines.append(
            {
                "file": path.name,
                "orientation": orientation,
                "line": " ".join(sans) if sans else "(no moves saved)",
                "comments": " ".join(comments[:3]),
            }
        )
    return lines


def opening_phase_stats(records: list[GameRecord]) -> dict[str, Any]:
    side_counts = Counter(record.side for record in records)
    result_counts: dict[str, Counter[str]] = {"White": Counter(), "Black": Counter(), "All": Counter()}
    scores: dict[str, list[float]] = {"White": [], "Black": [], "All": []}
    eco_letters: Counter[str] = Counter()
    eco_codes: Counter[str] = Counter()
    opening_names: Counter[str] = Counter()
    white_first: Counter[str] = Counter()
    black_responses: Counter[str] = Counter()
    white_prefixes: Counter[str] = Counter()
    black_prefixes: Counter[str] = Counter()
    lengths: list[int] = []
    opposite_castles = 0
    early_queen_trades = 0
    unknown_results = 0

    for record in records:
        lengths.append(record.ply_count)
        score = result_score(record.result, record.target_color)
        if score is None:
            unknown_results += 1
        else:
            label = "win" if score == 1.0 else "draw" if score == 0.5 else "loss"
            result_counts[record.side][label] += 1
            result_counts["All"][label] += 1
            scores[record.side].append(score)
            scores["All"].append(score)

        eco = record.eco if record.eco and record.eco != "?" else "?"
        eco_codes[eco] += 1
        eco_letters[eco[0] if eco and eco != "?" else "?"] += 1
        if record.opening:
            family = re.split(r"[:|,]", record.opening)[0].strip()
            opening_names[family or record.opening] += 1
        else:
            opening_names["Unknown"] += 1

        if record.san_moves:
            if record.target_color == chess.WHITE:
                white_first[record.san_moves[0]] += 1
                white_prefixes[" ".join(record.san_moves[:6])] += 1
            if len(record.san_moves) >= 2 and record.target_color == chess.BLACK:
                black_responses[" ".join(record.san_moves[:2])] += 1
                black_prefixes[" ".join(record.san_moves[:6])] += 1

        castle_sides: dict[chess.Color, str] = {}
        queen_trade_ply: int | None = None
        board = chess.Board()
        for ply, move in enumerate(record.moves, start=1):
            if board.is_castling(move):
                castle_sides[board.turn] = "queen" if chess.square_file(move.to_square) < 4 else "king"
            board.push(move)
            if queen_trade_ply is None:
                white_queens = len(board.pieces(chess.QUEEN, chess.WHITE))
                black_queens = len(board.pieces(chess.QUEEN, chess.BLACK))
                if white_queens + black_queens < 2:
                    queen_trade_ply = ply
        if castle_sides.get(chess.WHITE) and castle_sides.get(chess.BLACK):
            if castle_sides[chess.WHITE] != castle_sides[chess.BLACK]:
                opposite_castles += 1
        if queen_trade_ply is not None and queen_trade_ply <= 24:
            early_queen_trades += 1

    def score_line(side: str) -> dict[str, Any]:
        side_scores = scores[side]
        total = len(side_scores)
        return {
            "games": total,
            "score_pct": round(100.0 * sum(side_scores) / total, 1) if total else None,
            "wins": result_counts[side]["win"],
            "draws": result_counts[side]["draw"],
            "losses": result_counts[side]["loss"],
        }

    return {
        "count": len(records),
        "sideCounts": dict(side_counts),
        "unknownResults": unknown_results,
        "scores": {"All": score_line("All"), "White": score_line("White"), "Black": score_line("Black")},
        "ecoLetters": list_top(eco_letters),
        "ecoCodes": list_top(eco_codes, 8),
        "openingFamilies": list_top(opening_names, 8),
        "whiteFirst": list_top(white_first, 8),
        "blackResponses": list_top(black_responses, 10),
        "whitePrefixes": list_top(white_prefixes, 8),
        "blackPrefixes": list_top(black_prefixes, 8),
        "avgPly": round(statistics.mean(lengths), 1) if lengths else 0,
        "medianPly": round(statistics.median(lengths), 1) if lengths else 0,
        "oppositeCastles": opposite_castles,
        "earlyQueenTrades": early_queen_trades,
    }


def choose_engine_sample(records: list[GameRecord], max_games: int) -> list[GameRecord]:
    if len(records) <= max_games:
        return sorted(records, key=lambda r: parse_date_key(r.date), reverse=True)
    by_recent = sorted(records, key=lambda r: parse_date_key(r.date), reverse=True)
    selected: list[GameRecord] = []
    seen: set[str] = set()

    def add(record: GameRecord) -> None:
        key = record.title + game_movetext_key(record.moves)
        if key not in seen and len(selected) < max_games:
            selected.append(record)
            seen.add(key)

    for record in by_recent[: max_games // 2]:
        add(record)
    for wanted in (0.0, 1.0, 0.5):
        for record in by_recent:
            if result_score(record.result, record.target_color) == wanted:
                add(record)
            if len(selected) >= max_games:
                break
        if len(selected) >= max_games:
            break
    for record in by_recent:
        add(record)
        if len(selected) >= max_games:
            break
    return selected


def score_from_info(info: dict[str, Any]) -> int | None:
    score = info.get("score")
    if score is None:
        return None
    cp = score.pov(chess.WHITE).score(mate_score=10000)
    if cp is None:
        return None
    return max(-1200, min(1200, int(cp)))


def phase_for_ply(ply: int) -> str:
    if ply <= 20:
        return "opening"
    if ply <= 62:
        return "middlegame"
    return "endgame"


def classify_error(board: chess.Board, move: chess.Move, ply: int) -> str:
    if ply <= 20:
        return "opening"
    piece_count = len(board.piece_map())
    if piece_count <= 12 or ply > 70:
        return "endgame"
    if board.is_capture(move) or board.gives_check(move) or move.promotion:
        return "tactics"
    if len(board.pieces(chess.QUEEN, chess.WHITE)) + len(board.pieces(chess.QUEEN, chess.BLACK)) < 2:
        return "queenless play"
    return "coordination"


def run_engine_analysis(
    records: list[GameRecord],
    stockfish_path: Path,
    depth: int,
    max_games: int,
    max_target_moves_per_game: int,
) -> dict[str, Any]:
    sample = choose_engine_sample(records, max_games)
    if not sample:
        return {"available": False, "reason": "no games to analyse"}
    if not stockfish_path.exists():
        return {"available": False, "reason": f"Stockfish not found at {stockfish_path}"}

    limit = chess.engine.Limit(depth=depth)
    cache: dict[str, dict[str, Any]] = {}
    losses: list[float] = []
    losses_by_phase: dict[str, list[float]] = defaultdict(list)
    errors_by_type: Counter[str] = Counter()
    serious = 0
    blunders = 0
    checked_moves = 0
    top_errors: list[dict[str, Any]] = []
    start = time.time()

    def analyse(board: chess.Board) -> dict[str, Any] | None:
        fen = board.fen()
        if fen in cache:
            return cache[fen]
        try:
            info = engine.analyse(board, limit)
        except Exception:
            return None
        cp = score_from_info(info)
        best_move = None
        pv = info.get("pv")
        if pv:
            try:
                best_move = board.san(pv[0])
            except Exception:
                best_move = pv[0].uci()
        cached = {"cp": cp, "best": best_move}
        cache[fen] = cached
        return cached

    with chess.engine.SimpleEngine.popen_uci(str(stockfish_path)) as engine:
        try:
            engine.configure({"Threads": 1, "Hash": 128})
        except Exception:
            pass
        for index, record in enumerate(sample, start=1):
            if index == 1 or index % 10 == 0:
                eprint(f"  Stockfish {record.target_name}: game {index}/{len(sample)}")
            board = chess.Board()
            target_moves_seen = 0
            for ply, move in enumerate(record.moves, start=1):
                is_target_move = board.turn == record.target_color
                if is_target_move and ply >= 9 and target_moves_seen < max_target_moves_per_game:
                    before = analyse(board)
                    try:
                        san_played = board.san(move)
                    except Exception:
                        san_played = move.uci()
                    before_board = board.copy(stack=False)
                    board.push(move)
                    after = analyse(board)
                    target_moves_seen += 1
                    if before and after and before["cp"] is not None and after["cp"] is not None:
                        before_cp = int(before["cp"])
                        after_cp = int(after["cp"])
                        target_before = before_cp if record.target_color == chess.WHITE else -before_cp
                        target_after = after_cp if record.target_color == chess.WHITE else -after_cp
                        loss = max(0, target_before - target_after)
                        losses.append(loss)
                        phase = phase_for_ply(ply)
                        losses_by_phase[phase].append(loss)
                        checked_moves += 1
                        if loss >= 100:
                            serious += 1
                            errors_by_type[classify_error(before_board, move, ply)] += 1
                        if loss >= 200:
                            blunders += 1
                        if loss >= 100:
                            top_errors.append(
                                {
                                    "loss": round(loss / 100.0, 2),
                                    "phase": phase,
                                    "type": classify_error(before_board, move, ply),
                                    "game": record.title,
                                    "ply": ply,
                                    "move": san_played,
                                    "best": before.get("best") or "-",
                                    "evalBefore": round(target_before / 100.0, 2),
                                    "evalAfter": round(target_after / 100.0, 2),
                                    "fen": before_board.fen(),
                                }
                            )
                else:
                    board.push(move)

    elapsed = time.time() - start
    avg_loss = statistics.mean(losses) if losses else 0.0
    phase_rows = []
    for phase in ("opening", "middlegame", "endgame"):
        values = losses_by_phase.get(phase, [])
        phase_rows.append(
            {
                "phase": phase,
                "moves": len(values),
                "avgLoss": round(statistics.mean(values) / 100.0, 2) if values else 0,
                "seriousRate": round(100.0 * sum(1 for v in values if v >= 100) / len(values), 1) if values else 0,
            }
        )
    top_errors.sort(key=lambda item: item["loss"], reverse=True)
    return {
        "available": True,
        "engine": "Stockfish 17.1",
        "depth": depth,
        "sampleGames": len(sample),
        "checkedMoves": checked_moves,
        "avgLoss": round(avg_loss / 100.0, 2),
        "seriousRate": round(100.0 * serious / checked_moves, 1) if checked_moves else 0,
        "blunderRate": round(100.0 * blunders / checked_moves, 1) if checked_moves else 0,
        "phase": phase_rows,
        "errorTypes": list_top(errors_by_type, 6),
        "topErrors": top_errors[:8],
        "elapsedSeconds": round(elapsed, 1),
    }


def first_item(items: list[dict[str, Any]], default: str = "mixed") -> str:
    if not items:
        return default
    return str(items[0]["item"])


def join_top(items: list[dict[str, Any]], limit: int = 4) -> str:
    if not items:
        return "none recorded"
    return ", ".join(f"{row['item']} ({row['pct']}%)" for row in items[:limit])


def infer_style(profile: dict[str, Any]) -> dict[str, list[str] | str]:
    stats = profile["stats"]
    engine = profile.get("engine", {})
    white_first = first_item(stats["whiteFirst"])
    black_main = first_item(stats["blackResponses"])
    early_q = stats["earlyQueenTrades"]
    opposite = stats["oppositeCastles"]
    count = max(1, stats["count"])
    style_bits: list[str] = []

    if white_first == "e4":
        style_bits.append("As White they are direct and 1.e4-led.")
    elif white_first == "d4":
        style_bits.append("As White they are mainly a 1.d4/c4 structure player.")
    elif white_first != "mixed":
        style_bits.append(f"As White their main first move is {white_first}.")
    else:
        style_bits.append("Their White repertoire is mixed in the available sample.")

    if "e4 e5" in black_main:
        style_bits.append("As Black they are comfortable meeting 1.e4 with 1...e5.")
    elif "e4 e6" in black_main:
        style_bits.append("As Black they lean on French structures against 1.e4.")
    elif "e4 c5" in black_main:
        style_bits.append("As Black they are willing to enter Sicilian structures.")
    elif "d4 d5" in black_main:
        style_bits.append("As Black their most visible reply is a solid 1...d5 setup.")
    elif black_main != "mixed":
        style_bits.append(f"As Black their most common early reply in the file is {black_main}.")

    if early_q / count >= 0.22:
        style_bits.append("The file contains many early queen trades, so they do not mind simplified structures.")
    if opposite / count >= 0.10:
        style_bits.append("Opposite-side castling appears often enough that direct attacks are part of the sample.")

    strengths: list[str] = []
    weaknesses: list[str] = []
    strategy: list[str] = []

    if stats["scores"]["All"]["score_pct"] is not None and stats["scores"]["All"]["score_pct"] >= 58:
        strengths.append("They score well in the collected OTB sample; assume they convert familiar positions efficiently.")
    else:
        strengths.append("Their score is respectable but not crushing, so a clean practical game is enough to create chances.")

    strengths.append(f"Repertoire is identifiable: White first moves {join_top(stats['whiteFirst'], 3)}; Black replies {join_top(stats['blackResponses'], 3)}.")
    if stats["medianPly"] >= 70:
        strengths.append("They have enough long games in the file to be comfortable playing past the opening.")
    else:
        strengths.append("They often reach decision points before very long endgames, so opening and early middlegame accuracy matter.")

    if engine.get("available"):
        phase = sorted(engine["phase"], key=lambda row: row["avgLoss"], reverse=True)
        if phase:
            worst = phase[0]
            weaknesses.append(
                f"Stockfish sample shows the most average leakage in the {worst['phase']} ({worst['avgLoss']} pawns per checked move)."
            )
        if engine.get("errorTypes"):
            weaknesses.append(
                "Largest sampled errors cluster around "
                + ", ".join(f"{row['item']} ({row['count']})" for row in engine["errorTypes"][:3])
                + "."
            )
        if engine.get("seriousRate", 0) >= 10:
            weaknesses.append("They still give practical chances: the engine sample found a double-digit serious-error rate.")
        else:
            weaknesses.append("The engine sample did not show many huge gifts, so pressure should be accumulated rather than forced.")
    else:
        weaknesses.append("No engine sample was available; treat weaknesses as repertoire-based rather than tactical certainty.")

    if white_first == "e4":
        strategy.append("With Black, have one forcing answer to 1.e4 ready and know the first branch they usually chooses against it.")
    elif white_first == "d4":
        strategy.append("With Black, prepare a full plan against 1.d4/c4 rather than only a move order; they reach structures they understand.")
    else:
        strategy.append("With Black, use a flexible setup for the first five moves and avoid being move-ordered into a comfort zone.")

    if "e4 e5" in black_main:
        strategy.append("With White, decide before the game whether you want to allow 1...e5 main lines or sidestep into a system line.")
    elif "e4 e6" in black_main:
        strategy.append("With White, be ready for French pawn-chain decisions and do not spend time choosing between Exchange/Advance/Tarrasch at the board.")
    elif "d4 d5" in black_main:
        strategy.append("With White, expect solid ...d5 development; use move-order pressure rather than hoping for an opening collapse.")
    else:
        strategy.append("With White, use the first repeated Black response in the file as your anchor and keep a backup for their second choice.")

    strategy.append("In the game, make them solve concrete move-order problems early, then switch to low-risk pressure if they do not immediately crack.")
    return {
        "style": " ".join(style_bits),
        "strengths": strengths,
        "weaknesses": weaknesses,
        "strategy": strategy,
    }


PLAYER_NOTES: dict[str, dict[str, list[str] | str]] = {
    "Figeac, Aurelien": {
        "style": (
            "Classical, structure-first and experienced. The OTB file is old-heavy with a fresh 2025 London Classic block; "
            "as White he is mainly 1.d4, and as Black he is happiest in French/Nimzo/QGD-type structures."
        ),
        "strengths": [
            "Comfortable in closed central structures where plans matter more than forcing theory.",
            "French and Nimzo-style games show a clear taste for fixed pawn chains and dark-square play.",
            "The recent London games show he is active again, so do not treat the older database years as stale only.",
        ],
        "weaknesses": [
            "The recent sample is small, so his current repertoire may be narrower than the full historical file suggests.",
            "He can be steered into King Indian and dynamic d-pawn positions where he must choose between repeating, clarifying, or taking space.",
            "If the position opens suddenly, the file gives less evidence that he wants a pure tactical race than a strategic squeeze.",
        ],
        "strategy": [
            "Your saved Black prep with the King's Indian main line is well targeted: meet 1.d4 with a real plan, not just a setup.",
            "Use the ...h6/...Ng4 repetition idea as a practical test, but be ready to continue with ...Nbd7, ...Re8, and a timely ...f5 or ...c6 if he avoids the draw.",
            "With White, avoid drifting into his French/Nimzo comfort without a reason; choose a line where you know the pawn breaks and can keep play concrete.",
        ],
    },
    "Onuoha, Obioma": {
        "style": (
            "Direct 1.e4 player with a principled but practical repertoire. The OTB file says open games, Sicilians, French/Caro structures, "
            "and as Black a lot of 1...e5/Petroff plus ...d5 answers to d-pawn systems."
        ),
        "strengths": [
            "Very consistent first move as White: the prep target is 1.e4, not a broad guessing game.",
            "Comfortable in open Sicilian and e4-e5 structures where piece activity matters.",
            "The Chess.com account is high-confidence and active, adding a large practical sample even if blitz/bullet contains experiments.",
        ],
        "weaknesses": [
            "The online sample has experimental extras, so forcing him into less habitual OTB structures can create independent decisions.",
            "When his Black repertoire goes through 1...e5/Petroff, you can choose whether to test memory or sidestep it entirely.",
            "His prep is likely broad but not perfectly unified across OTB and online games; avoid giving him the exact branch he repeats most.",
        ],
        "strategy": [
            "With Black, prepare one robust answer to 1.e4 and a concrete plan against Open Sicilian/Italian-style development.",
            "With White, decide your anti-1...e5 policy before the game: either go straight at the Petroff/e4-e5 files or choose a sideline that keeps pieces on.",
            "He is dangerous when activity is automatic, so make him spend time on pawn-structure choices rather than only piece development.",
        ],
    },
    "Lapidus, Alexey M.": {
        "style": (
            "Young, active and increasingly rounded. The OTB file is 1.e4-heavy as White with recent English junior/event broadcasts, "
            "while his Black games most often use Sicilian answers to 1.e4 plus flexible ...Nf6/...d5 structures against d-pawn systems."
        ),
        "strengths": [
            "Large recent broadcast sample means his current habits are visible and tournament-tested.",
            "Comfortable playing long, technical junior-event games where small initiative changes matter.",
            "The stale Chess.com account still supports the broad identity/repertoire picture, but the OTB games are the main evidence.",
        ],
        "weaknesses": [
            "Because he is active and developing, old account games should not be over-weighted; use recent OTB move orders first.",
            "A flexible Modern/Pirc approach can make him solve fresh problems instead of entering a memorised 1.e4 main line.",
            "He can be pulled away from his Sicilian comfort if the move order asks him to build the centre himself.",
        ],
        "strategy": [
            "Your Black prep with 1...g6 is a sensible practical sidestep. Know the Be3/Qd2, Bc4, and Bf4 branches so the sidestep does not become a time sink.",
            "Your White prep with 1.Nf3 d5 2.c4 c6 keeps options open and can avoid giving him a clean 1.e4 target.",
            "Against him, prioritise move-order discipline: do not let a flexible position turn into a familiar forcing line by accident.",
        ],
    },
    "Mokhber-Garcia, Sebastian": {
        "style": (
            "Very active, sharp and current. This is the biggest OTB sample in the Southall prep, backed by a high-confidence Chess.com account "
            "with a lot of fast-game experimentation."
        ),
        "strengths": [
            "Huge recent sample and very high activity; he is unlikely to be rusty.",
            "Comfortable in tactical 1.e4 positions and practical online-style complications.",
            "He has enough games on both sides to adapt if the opening leaves theory early.",
        ],
        "weaknesses": [
            "The Chess.com sample is noisy: blitz/bullet choices are broad and not all should be trusted as classical repertoire.",
            "High activity can come with automatic moves; structured positions that require patience are a good practical test.",
            "Because his repertoire is broad, specific forcing prep should target repeated OTB lines, not random online experiments.",
        ],
        "strategy": [
            "Do not try to out-randomise him. Choose a sound line, keep time, and make the position ask for calculation on your terms.",
            "With Black, be especially ready for 1.e4 and for him to choose the most active piece setup available.",
            "With White, aim for a structure where your plan is clear by move 10; then make him prove the tactical break actually works.",
        ],
    },
    "Balmond, Tom": {
        "style": (
            "Clear 1.e4 player with Scotch/Italian/Sicilian exposure as White, and a very classical Black repertoire: 1...e5 versus 1.e4, "
            "plus ...d5/Slav-QGD structures against d-pawn openings."
        ),
        "strengths": [
            "The repertoire is coherent across OTB and the high-confidence Chess.com account.",
            "He is comfortable taking space and playing open-piece middlegames from 1.e4.",
            "As Black he often chooses principled central replies rather than passive systems.",
        ],
        "weaknesses": [
            "Because his repertoire is so identifiable, your opening prep can be concrete and narrow.",
            "Scotch/Italian structures can leave early tactical loose ends if you know the exact equalising plan.",
            "He has several younger-player games where momentum mattered; stopping the first initiative is worth a lot.",
        ],
        "strategy": [
            "With Black, prepare directly for 1.e4 and especially Scotch/Italian move orders. Do not improvise the equalising plan at the board.",
            "With White, expect 1...e5 or solid ...d5 systems. Pick a line that asks him to defend rather than simply develop.",
            "If you reach a level middlegame, keep pieces coordinated and avoid unnecessary pawn hooks; make him show a second plan after the first wave.",
        ],
    },
}


def merge_notes(profile: dict[str, Any]) -> dict[str, Any]:
    inferred = infer_style(profile)
    custom = PLAYER_NOTES.get(profile["player"], {})
    merged = {
        "style": custom.get("style", inferred["style"]),
        "strengths": custom.get("strengths", inferred["strengths"]),
        "weaknesses": custom.get("weaknesses", inferred["weaknesses"]),
        "strategy": custom.get("strategy", inferred["strategy"]),
    }
    return merged


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "Title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=THEME["ink"],
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "Subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=THEME["muted"],
            spaceAfter=12,
        ),
        "H1": ParagraphStyle(
            "H1",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=THEME["accent"],
            spaceBefore=10,
            spaceAfter=6,
        ),
        "H2": ParagraphStyle(
            "H2",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=13,
            textColor=THEME["ink"],
            spaceBefore=7,
            spaceAfter=4,
        ),
        "Body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=12.2,
            textColor=THEME["ink"],
            spaceAfter=5,
        ),
        "Small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.6,
            leading=9.6,
            textColor=THEME["muted"],
            spaceAfter=3,
        ),
        "Table": ParagraphStyle(
            "Table",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.6,
            leading=9.3,
            textColor=THEME["ink"],
        ),
        "TableHead": ParagraphStyle(
            "TableHead",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.6,
            leading=9.3,
            textColor=colors.white,
            alignment=TA_CENTER,
        ),
        "Callout": ParagraphStyle(
            "Callout",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=10.2,
            leading=13,
            textColor=THEME["ink"],
            backColor=THEME["soft"],
            borderColor=THEME["line"],
            borderWidth=0.5,
            borderPadding=7,
            spaceAfter=8,
        ),
    }


def para(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(str(text)).replace("\n", "<br/>"), style)


def bullet_list(items: list[str], style: ParagraphStyle) -> ListFlowable:
    return ListFlowable(
        [ListItem(para(item, style), bulletColor=THEME["accent"], leftIndent=8) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=14,
        bulletFontSize=6,
    )


def make_table(rows: list[list[Any]], col_widths: list[float] | None, table_style: ParagraphStyle) -> Table:
    processed = []
    for row_i, row in enumerate(rows):
        processed_row = []
        for cell in row:
            if isinstance(cell, Paragraph):
                processed_row.append(cell)
            else:
                processed_row.append(para(str(cell), table_style if row_i else styles()["TableHead"]))
        processed.append(processed_row)
    table = Table(processed, colWidths=col_widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), THEME["accent"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.35, THEME["line"]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFBFD")]),
            ]
        )
    )
    return table


def score_table_rows(stats: dict[str, Any]) -> list[list[Any]]:
    rows = [["Side", "Games", "Score", "W-D-L"]]
    for side in ("All", "White", "Black"):
        row = stats["scores"][side]
        score = "-" if row["score_pct"] is None else f"{row['score_pct']}%"
        rows.append([side, row["games"], score, f"{row['wins']}-{row['draws']}-{row['losses']}"])
    return rows


def top_rows(items: list[dict[str, Any]], label: str, limit: int = 6) -> list[list[Any]]:
    rows = [[label, "Games", "Share"]]
    for row in items[:limit]:
        rows.append([row["item"], row["count"], f"{row['pct']}%"])
    if len(rows) == 1:
        rows.append(["-", "-", "-"])
    return rows


def prep_line_paragraphs(prep_lines: list[dict[str, str]], style: ParagraphStyle) -> list[Any]:
    story: list[Any] = []
    if not prep_lines:
        story.append(para("No separate white/black helper prep PGNs were found in this player folder.", style))
        return story
    for item in prep_lines:
        orient = f" ({item['orientation']})" if item.get("orientation") else ""
        story.append(para(f"{item['file']}{orient}: {item['line']}", style))
        if item.get("comments"):
            story.append(para(f"Note in prep file: {item['comments']}", styles()["Small"]))
    return story


def build_pdf(profile: dict[str, Any], output_path: Path) -> None:
    s = styles()
    stats = profile["stats"]
    notes = profile["notes"]
    engine = profile.get("engine", {})
    comparison = profile.get("comparison")
    manifest = profile["manifest"]

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=1.35 * cm,
        leftMargin=1.35 * cm,
        topMargin=1.25 * cm,
        bottomMargin=1.15 * cm,
        title=f"Southall style report - {profile['player']}",
        author="Codex / En Croissant prep",
    )

    def footer(canvas, document) -> None:  # type: ignore[no-untyped-def]
        canvas.saveState()
        canvas.setStrokeColor(THEME["line"])
        canvas.setLineWidth(0.4)
        canvas.line(document.leftMargin, 0.78 * cm, A4[0] - document.rightMargin, 0.78 * cm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(THEME["muted"])
        canvas.drawString(document.leftMargin, 0.48 * cm, f"{EVENT_NAME} style report - {REPORT_DATE}")
        canvas.drawRightString(A4[0] - document.rightMargin, 0.48 * cm, f"Page {document.page}")
        canvas.restoreState()

    story: list[Any] = []
    story.append(para(f"Style report: {profile['player']}", s["Title"]))
    latest = manifest.get("latestGame", {})
    latest_text = (
        f"Latest known game: {latest.get('date', '?')} vs {latest.get('opponent', '?')} "
        f"as {latest.get('color', '?')} ({latest.get('result', '?')})"
        if latest
        else "Latest known game: not recorded"
    )
    scope = (
        f"{EVENT_NAME}. OTB source PGNs: {manifest.get('sourcePgnCount', stats['count'])}; "
        f"unique games analysed: {stats['count']} from {date_display(profile['dateRange'][0])} to {date_display(profile['dateRange'][1])}. "
        f"{latest_text}."
    )
    story.append(para(scope, s["Subtitle"]))
    story.append(para(notes["style"], s["Callout"]))

    story.append(para("Prep Snapshot", s["H1"]))
    story.append(
        make_table(
            [
                ["Rating", "FIDE ID", "OTB db games", "Chess.com status"],
                [
                    manifest.get("rating", "?"),
                    manifest.get("fideId", "?"),
                    profile.get("databaseCount", "?"),
                    profile.get("accountSummary", "none"),
                ],
            ],
            [2.0 * cm, 2.7 * cm, 3.0 * cm, 9.2 * cm],
            s["Table"],
        )
    )
    story.append(Spacer(1, 5))
    story.append(make_table(score_table_rows(stats), [3.0 * cm, 2.1 * cm, 2.1 * cm, 3.0 * cm], s["Table"]))

    story.append(para("Repertoire Evidence", s["H1"]))
    rep_table = [
        ["Area", "Most common lines"],
        ["White first moves", join_top(stats["whiteFirst"], 5)],
        ["White line prefixes", join_top(stats["whitePrefixes"], 4)],
        ["Black first replies", join_top(stats["blackResponses"], 5)],
        ["Black line prefixes", join_top(stats["blackPrefixes"], 4)],
        ["Opening families", join_top(stats["openingFamilies"], 5)],
    ]
    story.append(make_table(rep_table, [4.0 * cm, 13.0 * cm], s["Table"]))

    if comparison:
        story.append(para("Online Account Context", s["H2"]))
        story.append(para(comparison.get("calibratedSummary") or comparison.get("openingVerdict") or "No account comparison note.", s["Body"]))

    story.append(para("Stockfish Sample", s["H1"]))
    if engine.get("available"):
        story.append(
            para(
                f"{engine['engine']} depth {engine['depth']} sampled {engine['sampleGames']} games and {engine['checkedMoves']} target moves. "
                f"Average loss was {engine['avgLoss']} pawns; serious-error rate {engine['seriousRate']}%; blunder-rate {engine['blunderRate']}%.",
                s["Body"],
            )
        )
        phase_rows = [["Phase", "Moves", "Avg loss", "Serious"]]
        for row in engine["phase"]:
            phase_rows.append([row["phase"], row["moves"], f"{row['avgLoss']} pawns", f"{row['seriousRate']}%"])
        story.append(make_table(phase_rows, [3.2 * cm, 2.2 * cm, 2.5 * cm, 2.5 * cm], s["Table"]))
        if engine.get("topErrors"):
            story.append(para("Largest sampled swings", s["H2"]))
            error_rows = [["Game", "Move", "Best", "Loss", "Type"]]
            for err in engine["topErrors"][:5]:
                error_rows.append(
                    [
                        err["game"],
                        f"{err['ply']}. {err['move']}",
                        err["best"],
                        f"{err['loss']} pawns",
                        err["type"],
                    ]
                )
            story.append(make_table(error_rows, [7.2 * cm, 2.2 * cm, 2.0 * cm, 2.0 * cm, 2.3 * cm], s["Table"]))
    else:
        story.append(para(f"Stockfish analysis not available: {engine.get('reason', 'unknown reason')}.", s["Body"]))

    story.append(para("Strengths", s["H1"]))
    story.append(bullet_list(list(notes["strengths"]), s["Body"]))
    story.append(para("Weaknesses To Test", s["H1"]))
    story.append(bullet_list(list(notes["weaknesses"]), s["Body"]))
    story.append(para("Your Strategy", s["H1"]))
    story.append(bullet_list(list(notes["strategy"]), s["Body"]))

    story.append(para("Saved Prep Lines In This Folder", s["H1"]))
    story.extend(prep_line_paragraphs(profile.get("prepLines", []), s["Body"]))

    story.append(PageBreak())
    story.append(para("Appendix: Evidence Tables", s["Title"]))
    story.append(para("Top ECO Codes", s["H1"]))
    story.append(make_table(top_rows(stats["ecoCodes"], "ECO", 8), [5.0 * cm, 2.2 * cm, 2.4 * cm], s["Table"]))
    story.append(para("Top Opening Families", s["H1"]))
    story.append(make_table(top_rows(stats["openingFamilies"], "Family", 8), [8.5 * cm, 2.2 * cm, 2.4 * cm], s["Table"]))
    story.append(para("Source Notes", s["H1"]))
    source_counts = manifest.get("sourceCounts", {})
    if source_counts:
        source_rows = [["Original source bucket", "Hits before final dedupe"]]
        for key, value in source_counts.items():
            source_rows.append([key, value])
        story.append(make_table(source_rows, [8.5 * cm, 2.5 * cm], s["Table"]))
    if manifest.get("notes"):
        story.append(para("Prep collection notes", s["H2"]))
        story.append(bullet_list([str(item) for item in manifest["notes"]], s["Small"]))
    story.append(para("Method", s["H1"]))
    method = (
        "Opening and result statistics were calculated from the deduped combined app-side OTB prep PGN. Original source bucket counts are kept only as collection provenance and can exceed the final unique game total. "
        "Stockfish sampling checked target-side moves from move 5 onward in recent and result-diverse OTB games. "
        "Chess.com account comments use the existing Southall opening-comparison audit and are not merged into the OTB statistics unless explicitly stated."
    )
    story.append(para(method, s["Small"]))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def render_pdf_previews(pdf_paths: list[Path], output_dir: Path) -> list[Path]:
    import fitz

    output_dir.mkdir(parents=True, exist_ok=True)
    previews: list[Path] = []
    for pdf_path in pdf_paths:
        doc = fitz.open(str(pdf_path))
        if len(doc) == 0:
            continue
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
        out = output_dir / (pdf_path.stem + " - page 1.png")
        pix.save(str(out))
        previews.append(out)
        doc.close()
    return previews


def report_filename(player: str) -> str:
    safe_player = re.sub(r'[<>:"/\\|?*]+', " ", player).strip().rstrip(".")
    return f"Southall U2400 style report - {safe_player}.pdf"


def build_profiles(args: argparse.Namespace) -> list[dict[str, Any]]:
    prep_root = Path(args.prep_root)
    manifest_path = prep_root / "_manifest.json"
    comparison_path = prep_root / "_chesscom_opening_comparison.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    comparison = json.loads(comparison_path.read_text(encoding="utf-8")) if comparison_path.exists() else {"results": []}
    comparison_by_player = {item["player"]: item for item in comparison.get("results", [])}
    database_counts = manifest.get("databaseCounts", {})
    profiles: list[dict[str, Any]] = []

    stockfish = Path(args.stockfish or os.environ.get("STOCKFISH_EXE") or DEFAULT_STOCKFISH)
    for target in manifest["targets"]:
        player = target["player"]
        eprint(f"Loading {player}")
        pgn_path = Path(target["appOtbSourcePgnPath"])
        records, raw_count = read_game_records(pgn_path, player)
        if not records:
            eprint(f"  no games found for {player}")
            continue
        stats = opening_phase_stats(records)
        dates = sorted([record.date for record in records], key=parse_date_key)
        profile: dict[str, Any] = {
            "player": player,
            "manifest": target,
            "rawParsedGames": raw_count,
            "dateRange": [dates[0], dates[-1]],
            "stats": stats,
            "databaseCount": database_counts.get(player),
            "comparison": comparison_by_player.get(player),
            "prepLines": read_prep_lines(Path(target["folder"])),
        }
        if profile["comparison"]:
            comp = profile["comparison"]
            username = comp.get("username")
            status = comp.get("accountStatus") or comp.get("confidenceAfterOpeningCheck") or "checked"
            if username:
                profile["accountSummary"] = f"{username} - {status}"
            else:
                profile["accountSummary"] = status
        else:
            acct = target.get("accountResearch", {}).get("chessCom", {})
            profile["accountSummary"] = acct.get("confidence", "none")
        profile["engine"] = (
            {"available": False, "reason": "engine disabled by --no-engine"}
            if args.no_engine
            else run_engine_analysis(records, stockfish, args.depth, args.sample_games, args.max_target_moves_per_game)
        )
        profile["notes"] = merge_notes(profile)
        profiles.append(profile)
    return profiles


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prep-root", default=str(DEFAULT_PREP_ROOT))
    parser.add_argument("--stockfish", default=str(DEFAULT_STOCKFISH))
    parser.add_argument("--depth", type=int, default=8)
    parser.add_argument("--sample-games", type=int, default=56)
    parser.add_argument("--max-target-moves-per-game", type=int, default=30)
    parser.add_argument("--no-engine", action="store_true")
    parser.add_argument("--skip-pdf", action="store_true")
    args = parser.parse_args()

    profiles = build_profiles(args)
    prep_root = Path(args.prep_root)
    analysis_path = prep_root / "_style_report_analysis.json"
    analysis_path.write_text(json.dumps({"generatedAt": REPORT_DATE, "profiles": profiles}, indent=2), encoding="utf-8")
    eprint(f"Wrote {analysis_path}")

    pdf_paths: list[Path] = []
    if not args.skip_pdf:
        for profile in profiles:
            folder = Path(profile["manifest"]["folder"])
            output_path = folder / report_filename(profile["player"])
            eprint(f"Writing {output_path}")
            build_pdf(profile, output_path)
            pdf_paths.append(output_path)
        preview_dir = Path("tmp") / "pdfs" / "southall-style-report-previews"
        previews = render_pdf_previews(pdf_paths, preview_dir)
        (preview_dir / "preview-files.txt").write_text("\n".join(str(path) for path in previews), encoding="utf-8")
        eprint(f"Rendered {len(previews)} first-page previews under {preview_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
