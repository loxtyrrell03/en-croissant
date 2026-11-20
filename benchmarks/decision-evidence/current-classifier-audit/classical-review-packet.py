"""Read matched engine frames without consulting any classifier output."""
import argparse
import json
from pathlib import Path
import sys

import chess


def read(path):
    return json.loads(path.read_bytes())


def describe(board, lines):
    for line in lines:
        scale = line["cp"] if line["mate"] is None else f"M{line['mate']}"
        san = board.variation_san([chess.Move.from_uci(move) for move in line["pvUci"][:10]])
        print(f" {str(scale):>5} d{line['depth']:02} {san}")


def packet(app, deeper):
    for key in ("id", "game", "fen", "history", "playedMoveUci"):
        if app[key] != deeper[key]:
            raise ValueError(f"Mismatched {key} across frame sets.")
    board = chess.Board(app["fen"])
    print(f"\n{app['id']} {app['group']} {app['site']}")
    print(board.fen())
    played = app["playedMoveUci"]
    chosen = app["candidates"][0]["pvUci"][0]
    print(f"Review exact candidate {board.san(board.parse_uci(chosen))} and played {board.san(board.parse_uci(played))}")
    for row in (app, deeper):
        print(row["search"]["stage"], "root")
        describe(board, row["candidates"])
        if pair := row.get("comparisonCandidates"):
            print(" Matched actual and leading choice")
            describe(board, pair)
        for probe in row["replyProbes"]:
            reached = board.copy()
            move = reached.parse_uci(probe["moveUci"])
            print(" Responding to", reached.san(move))
            reached.push(move)
            describe(reached, probe["lines"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--count", type=int, default=8)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf8")
    first = read(args.app)
    second = {row["id"]: row for row in read(args.reference)}
    if {row["id"] for row in first} != set(second):
        raise ValueError("The app and reference cohorts differ.")
    for row in first[args.start - 1:args.start - 1 + args.count]:
        packet(row, second[row["id"]])
