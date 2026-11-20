"""Extract legal passed-pawn comparisons from frozen Stockfish searches."""
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import json

import chess
import numpy as np


HORIZON = 10
SHALLOW_HORIZON = 4
MAX_REPLY_GAP = 80


def direction(color):
    return 8 if color == chess.WHITE else -8


def relative_rank(square, color):
    return (square if color else chess.square_mirror(square)) // 8


def passed(board, square, color):
    return all(
        abs(chess.square_file(other) - chess.square_file(square)) > 1
        or relative_rank(other, color) <= relative_rank(square, color)
        for other in board.pieces(chess.PAWN, not color)
    )


def trajectory(child, square, moves, horizon):
    """Follow this pawn, including an en-passant capture or a promotion."""
    board = child.copy(stack=False)
    advanced = False
    color = board.color_at(square)
    for uci in moves[:horizon]:
        move = board.parse_uci(uci)
        if not move:
            raise ValueError("A null move is not a legal continuation")
        if board.is_en_passant(move):
            victim = move.to_square - direction(board.turn)
        else:
            victim = move.to_square
        if board.turn != color and victim == square:
            return {"advanced": advanced, "alive": False, "complete": True}
        if move.from_square == square:
            advanced |= board.piece_type_at(square) == chess.PAWN and not board.is_capture(move)
            square = move.to_square
        board.push(move)
    return {
        "advanced": advanced,
        "alive": True,
        "complete": len(moves) >= horizon or board.is_game_over(),
    }


def frame_lines(child, lines):
    if len(lines) < 2:
        return False
    return all(line["pvUci"] and line["fen"] == child.fen() for line in lines[:2]) and (
        lines[0]["pvUci"][0] != lines[1]["pvUci"][0]
    )


def reference(child, square, root_line, lines):
    if not root_line or not frame_lines(child, lines):
        return None
    first, second = lines[:2]
    if (
        first["cp"] is None or second["cp"] is None
        or first["depth"] != second["depth"]
        or not 0 <= first["cp"] - second["cp"] <= MAX_REPLY_GAP
    ):
        return None
    observed = [
        trajectory(child, square, moves, HORIZON)
        for moves in (root_line, first["pvUci"], second["pvUci"])
    ]
    if not all(line["complete"] for line in observed):
        return None
    outcomes = {line["advanced"] and line["alive"] for line in observed}
    return outcomes.pop() if len(outcomes) == 1 else None


def rank_features(child, square, color):
    advance_square = square + direction(color)
    friend, enemy = child.king(color), child.king(not color)
    clear = 0
    for other in range(advance_square, 64 if color else -1, direction(color)):
        if child.piece_at(other):
            break
        clear += 1
    related = [
        other for other in child.pieces(chess.PAWN, color)
        if abs(chess.square_file(other) - chess.square_file(square)) == 1
        and abs(chess.square_rank(other) - chess.square_rank(square)) <= 1
    ]
    return [
        relative_rank(square, color), clear, child.turn == color, child.is_check(),
        min(chess.square_file(square), 7 - chess.square_file(square)),
        chess.square_distance(square, friend), chess.square_distance(square, enemy),
        chess.square_distance(advance_square, friend), chess.square_distance(advance_square, enemy),
        int(child.piece_type_at(advance_square) or 0),
        child.color_at(advance_square) == color, len(related),
        *[len(child.attackers(side, location)) for location in (square, advance_square)
          for side in (color, not color)],
        *[len(child.pieces(piece, side)) for side in (color, not color) for piece in range(1, 6)],
    ]


def shallow_features(child, square, color, lines):
    result = []
    for line in lines[:2]:
        moves = line["pvUci"]
        score = line["cp"]
        if score is None:
            score = 1000 if line["mate"] > 0 else -1000
        observed = trajectory(child, square, moves, SHALLOW_HORIZON)
        result.extend((
            np.clip(score, -1000, 1000) * (1 if child.turn == color else -1),
            line["depth"], observed["advanced"], observed["alive"], observed["complete"],
        ))
    return result


@dataclass
class Asset:
    id: str
    event: str
    game: str
    branch: str
    original: str
    square: int
    color: bool
    child: chess.Board
    board_features: list
    line_features: list
    target: bool | None


def normalized(board):
    return " ".join((board if board.turn else board.mirror()).fen().split()[:4])


def reached(row):
    hist = row["history"]
    board = chess.Board(hist["fen"])
    for uci in hist["moves"]:
        board.push_uci(uci)
    if board.fen() != row["fen"]:
        raise ValueError(f"Recorded board disagrees with its history in {row['id']}")
    return board


def extract(row, event):
    if row.get("skipped") or not row.get("short"):
        return []
    board = reached(row)
    result = []
    for branch, field in (("better", "candidate"), ("played", "playedMoveUci")):
        move = board.parse_uci(row[field])
        child = board.copy()
        child.push(move)
        shallow = row["short"][branch]
        if not frame_lines(child, shallow):
            return []
        reference_root = [
            line["pvUci"][1:] for line in row["deep"]["root"]
            if line["fen"] == board.fen() and line["pvUci"] and line["pvUci"][0] == move.uci()
        ]
        if len(reference_root) != 1:
            raise ValueError(f"Expected one exact paired root for {row['id']} {branch}")
        for color in chess.COLORS:
            for square in child.pieces(chess.PAWN, color):
                if not passed(child, square, color):
                    continue
                origin = move.from_square if square == move.to_square else square
                result.append(Asset(
                    row["id"], event, row["game"], branch, chess.square_name(origin),
                    square, color, child, rank_features(child, square, color),
                    shallow_features(child, square, color, shallow),
                    reference(child, square, reference_root[0], row["deep"][branch]),
                ))
    return result


def check_disjoint(identities):
    for split, parts in enumerate(identities):
        for previous in identities[:split]:
            if any(values & earlier for values, earlier in zip(parts, previous, strict=True)):
                raise ValueError("A game, event, or normalized root/child position crossed splits")


def cohorts(directory, family):
    groups, identities = [], []
    for name in ("train", "test", "reserve"):
        path = Path(directory) / f"{name}.jsonl"
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        if len(rows) != len({row["game"] for row in rows}):
            raise ValueError(f"Repeated source game in {name}")
        group = [asset for row in rows for asset in extract(row, family(row["event"]))]
        groups.append(group)
        boards = {normalized(chess.Board(row["fen"])) for row in rows}
        boards.update(normalized(asset.child) for asset in group)
        identities.append(({row["game"] for row in rows}, {family(row["event"]) for row in rows}, boards))
    check_disjoint(identities)
    return groups


def counts(assets):
    target = Counter(item.target for item in assets)
    return {
        "assets": len(assets), "games": len({item.game for item in assets}),
        "eventFamilies": len({item.event for item in assets}),
        "positive": target[True], "negative": target[False], "uncertain": target[None],
    }
