"""Freeze capture candidates on disjoint games and board/mirror keys."""

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess


VALUES = dict(zip(range(1, 7), (100, 320, 330, 500, 900, 0)))


def board_key(board):
    return min(board.epd(), board.mirror().epd())


def sampling_stratum(row):
    board = chess.Board(row["fen"])
    side = board.turn
    running = 0
    trace = []
    for uci in row["line"][:8]:
        try:
            move = board.parse_uci(uci)
        except ValueError:
            return None

        target = board.piece_at(move.to_square)
        before = board.copy(stack=False)
        direction = 1 if board.turn == side else -1
        if target:
            running += direction * VALUES[target.piece_type]
        elif board.is_en_passant(move):
            running += direction * 100
        if move.promotion:
            running += direction * (VALUES[move.promotion] - 100)
        board.push(move)
        trace.append((before, move, target, running))

    for index, (before, move, target, _) in enumerate(trace[:5]):
        if not target or target.piece_type not in (chess.BISHOP, chess.PAWN) or before.turn != side:
            continue
        finish = index
        for _, reply, victim, _ in trace[index + 1:]:
            if reply.to_square != move.to_square or not victim:
                break
            finish += 1
        rest = trace[finish:finish + 3]
        if len(rest) < 3 or any(step[3] != rest[0][3] for step in rest):
            continue
        previous = trace[index - 1][3] if index else 0
        difference = rest[0][3] - previous
        if target.piece_type == chess.BISHOP:
            bishops = before.pieces(chess.BISHOP, target.color)
            if not (bishops & chess.BB_LIGHT_SQUARES and bishops & chess.BB_DARK_SQUARES):
                continue
            feature = "bishop"
        else:
            if index != 0:
                continue
            pawns = before.pieces(chess.PAWN, target.color)
            file_mask = chess.BB_FILES[chess.square_file(move.to_square)]
            if len(pawns & file_mask) != 1:
                continue
            feature = "pawn"

        if abs(difference) <= 50 or difference >= 90:
            return feature + ("-gain" if difference >= 90 else "-trade")
    return None


def read(path):
    return json.loads(Path(path).read_bytes())


def freeze(corpus, exclusions, development_path, heldout_path):
    excluded = [row for path in exclusions for row in read(path)]
    games = {row.get("game") for row in excluded}
    boards = {board_key(chess.Board(row["fen"])) for row in excluded}
    selection = []
    for row in read(corpus)["cases"]:
        if row["game"] in games or board_key(chess.Board(row["fen"])) in boards:
            continue
        stratum = sampling_stratum(row)
        if stratum:
            selection.append(dict(row, selection=stratum))

    for out, width, development in ((development_path, 5, True), (heldout_path, 18, False)):
        if out == "-":
            continue
        rows = []
        counts = Counter()

        def order(row):
            training = row["split"] == "train"
            stable_hash = sha256(("separate-effects-v1:" + row["id"]).encode()).hexdigest()
            return training != development, stable_hash

        for item in sorted(selection, key=order):
            key = board_key(chess.Board(item["fen"]))
            if item["game"] in games or key in boards or counts[item["selection"]] >= width:
                continue
            games.add(item["game"])
            boards.add(key)
            counts[item["selection"]] += 1
            rows.append(item)
        with Path(out).open("x", encoding="utf-8") as stream:
            json.dump(rows, stream, separators=(",", ":"))
        print(out, len(rows), dict(counts), flush=True)


if __name__ == "__main__":
    corpus, development, heldout, *exclusions = sys.argv[1:]
    freeze(corpus, exclusions, development, heldout)
