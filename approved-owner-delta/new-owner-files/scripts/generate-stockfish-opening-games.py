#!/usr/bin/env python3
"""Generate Stockfish 18 vs Stockfish 11 opening-practice PGNs.

The script writes one PGN per opening into the En Croissant Files library. It
keeps the requested opening moves fixed, then gives both engines the same fixed
movetime for every generated move.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import queue
import random
import re
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.pgn


REPO_ROOT = Path(__file__).resolve().parents[1]
LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
DEFAULT_TOOLS_DIR = LOCALAPPDATA / "EnCroissantEngineMatches"
DEFAULT_SF18 = (
    DEFAULT_TOOLS_DIR
    / "stockfish18-avx2"
    / "stockfish"
    / "stockfish-windows-x86-64-avx2.exe"
)
DEFAULT_SF11 = DEFAULT_TOOLS_DIR / "sf11pkg" / "package" / "src" / "stockfish.js"
DEFAULT_OUTPUT = Path.home() / "Documents" / "EnCroissant" / "Stockfish 18 games"

BESTMOVE_RE = re.compile(r"^bestmove\s+(\S+)")
MULTIPV_RE = re.compile(r"\bmultipv\s+(\d+)\b")
DEPTH_RE = re.compile(r"\bdepth\s+(\d+)\b")
SCORE_CP_RE = re.compile(r"\bscore\s+cp\s+(-?\d+)\b")
SCORE_MATE_RE = re.compile(r"\bscore\s+mate\s+(-?\d+)\b")
PV_RE = re.compile(r"\bpv\s+(\S+)")


@dataclass(frozen=True)
class OpeningLine:
    variation: str
    san_moves: tuple[str, ...]
    games: int


@dataclass(frozen=True)
class OpeningSuite:
    filename: str
    opening: str
    learning_side: chess.Color
    lines: tuple[OpeningLine, ...]


OPENINGS: tuple[OpeningSuite, ...] = (
    OpeningSuite(
        filename="Reti System - White.pgn",
        opening="Reti System",
        learning_side=chess.WHITE,
        lines=(
            OpeningLine(
                variation="Nf3, d4 and c4 against ...d5",
                san_moves=("Nf3", "d5", "d4", "Nf6", "c4"),
                games=10,
            ),
        ),
    ),
    OpeningSuite(
        filename="Catalan - White.pgn",
        opening="Catalan Opening",
        learning_side=chess.WHITE,
        lines=(
            OpeningLine(
                variation="Open Catalan, accepted with ...dxc4",
                san_moves=("d4", "Nf6", "c4", "e6", "Nf3", "d5", "g3", "dxc4"),
                games=5,
            ),
            OpeningLine(
                variation="Closed Catalan",
                san_moves=(
                    "d4",
                    "Nf6",
                    "c4",
                    "e6",
                    "Nf3",
                    "d5",
                    "g3",
                    "Be7",
                    "Bg2",
                    "O-O",
                    "O-O",
                    "c6",
                ),
                games=5,
            ),
        ),
    ),
    OpeningSuite(
        filename="Slav Quiet Variation - White.pgn",
        opening="Slav Defense",
        learning_side=chess.WHITE,
        lines=(
            OpeningLine(
                variation="Quiet Variation",
                san_moves=("Nf3", "d5", "d4", "c6", "c4", "Nf6", "e3"),
                games=10,
            ),
        ),
    ),
    OpeningSuite(
        filename="Vincent Keymer System - White.pgn",
        opening="Vincent Keymer System",
        learning_side=chess.WHITE,
        lines=(
            OpeningLine(
                variation="Reti-English hybrid with 5.b3 O-O 6.Bb2",
                san_moves=("Nf3", "d5", "c4", "e6", "e3", "Nf6", "Nc3", "Be7", "b3", "O-O", "Bb2"),
                games=10,
            ),
        ),
    ),
    OpeningSuite(
        filename="Modern Defence Main Line - Black.pgn",
        opening="Modern Defence",
        learning_side=chess.BLACK,
        lines=(
            OpeningLine(
                variation="Main Line with 4.f4",
                san_moves=("e4", "g6", "d4", "Bg7", "Nc3", "d6", "f4"),
                games=10,
            ),
        ),
    ),
    OpeningSuite(
        filename="Kings Indian Defence Main Line - Black.pgn",
        opening="King's Indian Defence",
        learning_side=chess.BLACK,
        lines=(
            OpeningLine(
                variation="Main Line, Mar del Plata setup",
                san_moves=(
                    "d4",
                    "Nf6",
                    "c4",
                    "g6",
                    "Nc3",
                    "Bg7",
                    "e4",
                    "d6",
                    "Nf3",
                    "O-O",
                    "Be2",
                    "e5",
                    "O-O",
                    "Nc6",
                    "d5",
                    "Ne7",
                ),
                games=10,
            ),
        ),
    ),
    OpeningSuite(
        filename="Italian Game - Black.pgn",
        opening="Italian Game",
        learning_side=chess.BLACK,
        lines=(
            OpeningLine(
                variation="Giuoco Piano with c3 and d3",
                san_moves=("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3"),
                games=10,
            ),
        ),
    ),
    OpeningSuite(
        filename="Ruy Lopez - Black.pgn",
        opening="Ruy Lopez",
        learning_side=chess.BLACK,
        lines=(
            OpeningLine(
                variation="Morphy Defence after 4...Nf6",
                san_moves=("e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6"),
                games=10,
            ),
        ),
    ),
)


@dataclass
class SearchCandidate:
    move: chess.Move
    score: int
    depth: int
    multipv: int


@dataclass
class SearchResult:
    bestmove: chess.Move
    candidates: list[SearchCandidate]


class UciEngine:
    def __init__(
        self,
        name: str,
        command: list[str],
        *,
        cwd: Path | None = None,
        options: dict[str, str | int] | None = None,
    ) -> None:
        self.name = name
        self.command = command
        self.cwd = cwd
        self.options = options or {}
        self.process: subprocess.Popen[str] | None = None
        self.lines: queue.Queue[str] = queue.Queue()
        self.reader: threading.Thread | None = None

    def start(self) -> None:
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            self.command,
            cwd=str(self.cwd) if self.cwd else None,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creationflags,
        )
        self.reader = threading.Thread(target=self._read_output, daemon=True)
        self.reader.start()
        self.send("uci")
        self.wait_for(lambda line: line == "uciok", timeout=30)
        for key, value in self.options.items():
            self.send(f"setoption name {key} value {value}")
        self.isready()

    def _read_output(self) -> None:
        assert self.process and self.process.stdout
        for raw_line in self.process.stdout:
            line = raw_line.strip()
            if line:
                self.lines.put(line)

    def send(self, command: str) -> None:
        if not self.process or not self.process.stdin:
            raise RuntimeError(f"{self.name} is not running")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def wait_for(self, predicate, *, timeout: float) -> str:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.process and self.process.poll() is not None:
                raise RuntimeError(f"{self.name} exited unexpectedly with code {self.process.returncode}")
            try:
                line = self.lines.get(timeout=0.1)
            except queue.Empty:
                continue
            if predicate(line):
                return line
        raise TimeoutError(f"{self.name} timed out")

    def isready(self) -> None:
        self.send("isready")
        self.wait_for(lambda line: line == "readyok", timeout=30)

    def new_game(self) -> None:
        self.send("ucinewgame")
        self.isready()

    def search(
        self,
        board: chess.Board,
        uci_moves: list[str],
        *,
        movetime_ms: int,
        timeout_extra: float = 15,
    ) -> SearchResult:
        if uci_moves:
            self.send("position startpos moves " + " ".join(uci_moves))
        else:
            self.send("position startpos")
        self.send(f"go movetime {movetime_ms}")

        latest_by_multipv: dict[int, tuple[chess.Move, int, int]] = {}
        deadline = time.monotonic() + timeout_extra + movetime_ms / 1000 * 4
        bestmove: chess.Move | None = None

        while time.monotonic() < deadline:
            if self.process and self.process.poll() is not None:
                raise RuntimeError(f"{self.name} exited unexpectedly with code {self.process.returncode}")
            try:
                line = self.lines.get(timeout=0.1)
            except queue.Empty:
                continue

            candidate = self._parse_candidate(line, board)
            if candidate:
                multipv, move, score, depth = candidate
                latest_by_multipv[multipv] = (move, score, depth)

            match = BESTMOVE_RE.match(line)
            if match:
                move_text = match.group(1)
                if move_text == "0000":
                    raise RuntimeError(f"{self.name} returned no legal move")
                bestmove = chess.Move.from_uci(move_text)
                if bestmove not in board.legal_moves:
                    raise RuntimeError(f"{self.name} returned illegal move {move_text} in {board.fen()}")
                break

        if bestmove is None:
            raise TimeoutError(f"{self.name} did not return bestmove")

        candidates = []
        for multipv, (move, score, depth) in latest_by_multipv.items():
            if move in board.legal_moves:
                candidates.append(SearchCandidate(move=move, score=score, depth=depth, multipv=multipv))
        candidates.sort(key=lambda item: (-item.score, item.multipv))
        return SearchResult(bestmove=bestmove, candidates=candidates)

    def _parse_candidate(self, line: str, board: chess.Board) -> tuple[int, chess.Move, int, int] | None:
        if " pv " not in line:
            return None
        pv_match = PV_RE.search(line)
        if not pv_match:
            return None
        try:
            move = chess.Move.from_uci(pv_match.group(1))
        except ValueError:
            return None
        if move not in board.legal_moves:
            return None

        multipv_match = MULTIPV_RE.search(line)
        depth_match = DEPTH_RE.search(line)
        multipv = int(multipv_match.group(1)) if multipv_match else 1
        depth = int(depth_match.group(1)) if depth_match else 0
        score = parse_score(line)
        if score is None:
            return None
        return multipv, move, score, depth

    def quit(self) -> None:
        if not self.process:
            return
        if self.process.poll() is None:
            try:
                self.send("quit")
            except Exception:
                pass
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None


def parse_score(line: str) -> int | None:
    cp_match = SCORE_CP_RE.search(line)
    if cp_match:
        return int(cp_match.group(1))
    mate_match = SCORE_MATE_RE.search(line)
    if mate_match:
        mate = int(mate_match.group(1))
        sign = 1 if mate > 0 else -1
        return sign * (100000 - min(abs(mate), 1000))
    return None


def opening_board(line: OpeningLine) -> tuple[chess.Board, list[chess.Move], str]:
    board = chess.Board()
    moves: list[chess.Move] = []
    san_played: list[str] = []
    for san in line.san_moves:
        move = board.parse_san(san)
        san_played.append(board.san(move))
        board.push(move)
        moves.append(move)
    return board, moves, " ".join(san_played)


def choose_move(
    result: SearchResult,
    *,
    board: chess.Board,
    rng: random.Random,
    variety_enabled: bool,
    variety_cp: int,
) -> chess.Move:
    if not variety_enabled or not result.candidates:
        return result.bestmove

    best_score = result.candidates[0].score
    candidates = [
        candidate
        for candidate in result.candidates
        if best_score - candidate.score <= variety_cp and candidate.move in board.legal_moves
    ]
    if not candidates:
        return result.bestmove

    weights = []
    for candidate in candidates:
        loss = max(0, best_score - candidate.score)
        weights.append(max(1, variety_cp + 1 - loss))
    return rng.choices([candidate.move for candidate in candidates], weights=weights, k=1)[0]


def make_game(
    suite: OpeningSuite,
    line: OpeningLine,
    *,
    line_game_index: int,
    suite_game_index: int,
    sf18: UciEngine,
    sf11: UciEngine,
    movetime_ms: int,
    max_plies: int,
    multipv: int,
    variety_plies: int,
    variety_cp: int,
    seed: str,
) -> chess.pgn.Game:
    board, opening_moves, san_opening = opening_board(line)
    uci_moves = [move.uci() for move in opening_moves]
    rng = random.Random(f"{seed}:{suite.filename}:{line.variation}:{line_game_index}")

    sf18.new_game()
    sf11.new_game()

    today = dt.date.today().strftime("%Y.%m.%d")
    game = chess.pgn.Game()
    learning_side_name = "White" if suite.learning_side == chess.WHITE else "Black"
    white_name = "Stockfish 18" if suite.learning_side == chess.WHITE else "Stockfish 11"
    black_name = "Stockfish 18" if suite.learning_side == chess.BLACK else "Stockfish 11"

    game.headers["Event"] = "Stockfish 18 Opening Practice"
    game.headers["Site"] = "Local En Croissant"
    game.headers["Date"] = today
    game.headers["Round"] = str(suite_game_index)
    game.headers["White"] = white_name
    game.headers["Black"] = black_name
    game.headers["Result"] = "*"
    game.headers["Opening"] = suite.opening
    game.headers["Variation"] = line.variation
    game.headers["LearningSide"] = learning_side_name
    game.headers["FixedOpening"] = san_opening
    game.headers["TimeControl"] = f"{movetime_ms}ms per generated move"
    game.headers["EngineWhite"] = "Stockfish 18" if suite.learning_side == chess.WHITE else "Stockfish 11 WASM"
    game.headers["EngineBlack"] = "Stockfish 18" if suite.learning_side == chess.BLACK else "Stockfish 11 WASM"
    game.headers["Generator"] = "scripts/generate-stockfish-opening-games.py"
    game.headers["Variety"] = f"MultiPV {multipv}, top moves within {variety_cp} cp for first {variety_plies} generated plies"

    node = game
    replay = chess.Board()
    for move in opening_moves:
        node = node.add_variation(move)
        replay.push(move)

    generated_plies = 0
    termination = "Normal"
    while not board.is_game_over(claim_draw=True) and board.ply() < max_plies:
        engine = sf18 if board.turn == suite.learning_side else sf11
        search = engine.search(board, uci_moves, movetime_ms=movetime_ms)
        move = choose_move(
            search,
            board=board,
            rng=rng,
            variety_enabled=generated_plies < variety_plies,
            variety_cp=variety_cp,
        )
        node = node.add_variation(move)
        board.push(move)
        uci_moves.append(move.uci())
        generated_plies += 1

    if board.is_game_over(claim_draw=True):
        result = board.result(claim_draw=True)
        termination = board.outcome(claim_draw=True).termination.name.replace("_", " ").title()
    else:
        result = "1/2-1/2"
        termination = f"Adjudicated draw after {max_plies} plies"

    game.headers["Result"] = result
    game.headers["Termination"] = termination
    game.headers["GeneratedPlies"] = str(generated_plies)
    return game


def write_game(path: Path, game: chess.pgn.Game) -> None:
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(game.accept(exporter))
        handle.write("\n\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sf18", type=Path, default=DEFAULT_SF18)
    parser.add_argument("--sf11", type=Path, default=DEFAULT_SF11)
    parser.add_argument("--node", default="node")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--movetime-ms", type=int, default=300)
    parser.add_argument("--max-plies", type=int, default=220)
    parser.add_argument("--multipv", type=int, default=4)
    parser.add_argument("--variety-plies", type=int, default=12)
    parser.add_argument("--variety-cp", type=int, default=45)
    parser.add_argument("--seed", default="en-croissant-stockfish-18-practice")
    parser.add_argument("--dry-run-games", type=int, default=0, help="Run only this many games per line.")
    parser.add_argument("--keep-existing", action="store_true", help="Append to existing PGNs instead of replacing them.")
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        help="Only run openings whose filename or opening name contains this text. Can be repeated.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.sf18.exists():
        print(f"Stockfish 18 binary not found: {args.sf18}", file=sys.stderr)
        return 1
    if not args.sf11.exists():
        print(f"Stockfish 11 script not found: {args.sf11}", file=sys.stderr)
        return 1

    selected_suites = list(filter_suites(args.only))
    if not selected_suites:
        print("No openings matched --only filter.", file=sys.stderr)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    if not args.keep_existing:
        for suite in selected_suites:
            target = args.output_dir / suite.filename
            if target.exists():
                target.unlink()

    sf18 = UciEngine(
        "Stockfish 18",
        [str(args.sf18)],
        options={"Threads": 1, "Hash": 64, "MultiPV": args.multipv},
    )
    sf11 = UciEngine(
        "Stockfish 11",
        [args.node, "--no-experimental-fetch", str(args.sf11)],
        cwd=args.sf11.parent,
        options={"Hash": 32, "MultiPV": args.multipv},
    )

    total_games = sum(
        min(line.games, args.dry_run_games or line.games)
        for suite in selected_suites
        for line in suite.lines
    )
    completed = 0
    print(f"Writing {total_games} games to {args.output_dir}", flush=True)
    print(
        f"Config: movetime={args.movetime_ms}ms, max_plies={args.max_plies}, multipv={args.multipv}",
        flush=True,
    )

    try:
        sf18.start()
        sf11.start()

        for suite in selected_suites:
            target = args.output_dir / suite.filename
            suite_game_index = 0
            for line in suite.lines:
                line_games = min(line.games, args.dry_run_games or line.games)
                for line_game_index in range(1, line_games + 1):
                    suite_game_index += 1
                    game = make_game(
                        suite,
                        line,
                        line_game_index=line_game_index,
                        suite_game_index=suite_game_index,
                        sf18=sf18,
                        sf11=sf11,
                        movetime_ms=args.movetime_ms,
                        max_plies=args.max_plies,
                        multipv=args.multipv,
                        variety_plies=args.variety_plies,
                        variety_cp=args.variety_cp,
                        seed=args.seed,
                    )
                    write_game(target, game)
                    completed += 1
                    print(
                        f"[{completed:02d}/{total_games:02d}] {suite.opening} - {line.variation} "
                        f"game {line_game_index}/{line_games}: {game.headers['Result']} "
                        f"({game.headers['GeneratedPlies']} generated plies)",
                        flush=True,
                    )
    finally:
        sf18.quit()
        sf11.quit()

    print("Done.", flush=True)
    return 0


def filter_suites(filters: list[str]) -> tuple[OpeningSuite, ...]:
    if not filters:
        return OPENINGS

    normalized = [item.casefold() for item in filters]
    selected = []
    for suite in OPENINGS:
        haystack = f"{suite.filename} {suite.opening}".casefold()
        if any(item in haystack for item in normalized):
            selected.append(suite)
    return tuple(selected)


if __name__ == "__main__":
    raise SystemExit(main())
