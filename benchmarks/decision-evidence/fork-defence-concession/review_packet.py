"""Printable engine evidence for review without either classifier's output."""

import argparse
from pathlib import Path

import chess

from collect import payoff, fork_squares


def variations(board, frame, depth=9):
    cursor = board.copy(stack=False)
    baseline = payoff.material(cursor, cursor.turn)
    actor = cursor.turn
    san = []
    for uci in frame["pvUci"][:depth]:
        move = cursor.parse_uci(uci)
        text = cursor.san(move)
        cursor.push(move)
        change = payoff.material(cursor, actor) - baseline
        san.append(f"{text}({change})" if change != (san[-1][1] if san else 0) else text)
        san[-1] = (san[-1], change)
    return f'{frame["depth"]} at {frame["cp"] if frame["mate"] is None else "M" + str(frame["mate"])} ' + " ".join(item[0] for item in san)


def render(source):
    for row in payoff.read(source)["cases"]:
        board = chess.Board(row["fen"])
        move = board.parse_uci(row["move"])
        targets = fork_squares(board, move)
        print(row["id"], row["stratum"], board.san(move), ",".join(chess.square_name(sq) for sq in targets))
        for line in row["paired"]:
            print("  R", variations(board, line))
        board.push(move)
        for line in row["withReplies"][0]["lines"]:
            print("  D", variations(board, line))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    render(args.input)
