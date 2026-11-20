"""Identify cached puzzle positions with an exclusively quiet mate-in-two start."""
import argparse
import json
from pathlib import Path

import chess

from sample import forced_two, verify_start, wins_next, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    cases = json.loads(args.corpus.read_bytes())["cases"]
    chosen = []
    for case in cases:
        if len(case["line"]) != 3:
            continue
        board = chess.Board(case["fen"])
        end = board.copy()
        try:
            for uci in case["line"]:
                end.push_uci(uci)
        except ValueError:
            continue
        attack = chess.Move.from_uci(case["line"][0])
        if (end.is_checkmate() and not board.gives_check(attack) and not wins_next(board)
            and not forced_two(board, False) and verify_start(board, attack)):
            chosen.append(case)
    write(args.output, chosen)
    print(len(chosen), "quiet starts")


if __name__ == "__main__":
    main()
