"""Read the higher-budget pawn opportunity before viewing classifier changes."""

import argparse
import json
from pathlib import Path

import chess


def read(path):
    return json.loads(path.read_bytes())


def takes_loose(board, move):
    return (board.is_legal(move) and board.is_capture(move) and
            board.piece_type_at(move.to_square) == chess.PAWN and not move.promotion and
            not board.is_check() and not board.gives_check(move) and
            not board.attackers(not board.turn, move.to_square))


def trace(board, root, variation):
    position = board.copy(stack=False)
    san = []
    for move in map(chess.Move.from_uci, variation[:10]):
        if not position.is_legal(move):
            raise ValueError("Invalid reference continuation")
        san.append(position.san(move))
        if len(san) == 1 and (position.is_capture(move) or position.gives_check(move) or move.promotion):
            return "forcing start", san
        if move == root and takes_loose(position, move):
            return "deferred", san
        if (move.from_square, move.to_square) == (root.to_square, root.from_square):
            return "pawn captures the collector", san
        if position.turn != board.turn and move.from_square == root.to_square:
            return "pawn moves", san
        if position.turn == board.turn and move.from_square == root.from_square:
            return "collector moves", san
        if move.to_square in (root.from_square, root.to_square):
            return "occupant changes", san
        position.push(move)
    return "unresolved", san


def review(row):
    board = chess.Board(row["fen"])
    candidates = row["candidates"]
    exact = []
    for line in candidates:
        move = chess.Move.from_uci(line["pvUci"][0])
        if not takes_loose(board, move) or line["cp"] is None or line.get("mate") is not None:
            continue
        options = []
        for comparison in candidates:
            if (comparison is line or comparison["cp"] is None or comparison["depth"] != line["depth"]
                    or comparison.get("mate") is not None):
                continue
            pattern, san = trace(board, move, comparison["pvUci"])
            options.append(dict(root=comparison["pvUci"][0], scoreCp=comparison["cp"], pattern=pattern,
                                san=san, uci=comparison["pvUci"][:len(san)]))
        nearby = [opt for opt in options if abs(opt["scoreCp"] - line["cp"]) <= 150 and opt["scoreCp"] >= 300]
        plausible = [opt for opt in nearby if opt["pattern"] != "forcing start"]
        repeated = next((opt for opt in plausible if opt["pattern"] == "deferred"), None)
        result = "deferred" if repeated and line["cp"] >= 300 else "unclear"
        if (len(options) >= 2 and line["cp"] - max(opt["scoreCp"] for opt in options) >= 100
                and all(opt["pattern"] == "pawn moves" and len(opt["san"]) == 2 for opt in options)):
            result = "immediate opportunity"
        exact.append(dict(move=line["pvUci"][0], san=board.san(move), scoreCp=line["cp"],
                          nearQuiet=len(plausible), deferred=repeated, assessment=result, alternatives=options))
    return dict(id=row["id"], site=row["site"], stratum=row["stratum"], candidates=exact)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    reviews = [review(row) for row in read(args.frames)]
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(reviews, out, indent=2)
        out.write("\n")
    for row in reviews:
        exact = [(item["san"], item["scoreCp"], item["assessment"]) for item in row["candidates"]]
        if exact:
            print(row["id"], row["stratum"], exact)


if __name__ == "__main__":
    main()
