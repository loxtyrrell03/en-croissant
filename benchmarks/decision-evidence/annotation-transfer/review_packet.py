"""Show the outside note and legal lines to a reviewer, without worker output."""

import argparse
import json
from pathlib import Path

import chess


def read(path):
    return json.loads(path.read_bytes())


def variation(board, line, length=8):
    return board.variation_san([chess.Move.from_uci(uci) for uci in line["pvUci"][:length]])


def short(line):
    return f"{line['cp']}" if line["mate"] is None else f"M{line['mate']}"


def selected(frame):
    return next((line for line in frame.get("comparisonCandidates", frame["candidates"])
                 if line["pvUci"][0] == frame["playedMoveUci"]), None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "reference", "notes"):
        parser.add_argument(name, type=Path)
    parser.add_argument("split", choices=("development", "reserve"))
    parser.add_argument("--from", dest="start", type=int, default=1)
    parser.add_argument("--to", type=int, default=100)
    args = parser.parse_args()
    deep = {row["id"]: row for row in read(args.reference)}
    notes = read(args.notes)
    for number, app in enumerate((row for row in read(args.app) if row["split"] == args.split), 1):
        if not args.start <= number <= args.to:
            continue
        ref = deep[app["id"]]
        board = chess.Board(ref["fen"])
        played = ref["playedMoveUci"]
        choice = selected(ref)
        pair = ref.get("comparisonCandidates", ref["candidates"])
        better, original = pair[0], ref["candidates"][0]
        indicated = board.san(chess.Move.from_uci(played))
        print(f"{number}. {ref['id']} | {indicated} | {ref['stratum']} | {ref['site']}")
        print(notes[ref["id"]][:330])
        print("  better", short(original), variation(board, original))
        if choice and choice is not original:
            print("  exact", short(choice), variation(board, choice), f"(paired leader {short(better)})")
        opponent = next((probe["lines"] for probe in ref["replyProbes"] if probe["moveUci"] == played), [])
        child = board.copy(stack=False)
        child.push_uci(played)
        for response in opponent[:2]:
            print("  reply", short(response), variation(child, response, 6))


if __name__ == "__main__":
    main()
