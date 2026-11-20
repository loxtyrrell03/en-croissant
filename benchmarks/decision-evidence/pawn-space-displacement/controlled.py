"""Inspect an adaptation that scores the same pawn push after both root moves."""
import argparse
import json
from pathlib import Path
import sys

import chess
import chess.engine

def read(path):
    return json.loads(path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("nominations", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("engine_helpers", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.engine_helpers.resolve()))
    from gather import initial, searched
    inputs = {row["id"]: row for row in read(args.frames)}
    observations = []
    for case in read(args.nominations):
        row = inputs[case["id"]]
        board = initial(row)
        roots = row.get("comparisonCandidates") or row["candidates"]
        better = roots[0]
        played = next(line for line in roots if line["pvUci"][0] == row["playedMoveUci"])
        for event in case["events"]:
            if not event["twice"] or event["through"] != 6:
                continue
            replies = []
            for line in (better, played):
                reached = board.copy()
                root = reached.parse_uci(line["pvUci"][0])
                reached.push(root)
                candidate = chess.Move.from_uci(event["pawn"])
                if not reached.is_legal(candidate):
                    break
                budget_comparison = []
                for budget in (1400000, 3200000):
                    with chess.engine.SimpleEngine.popen_uci(args.engine) as engine:
                        engine.configure({"Threads": 1, "Hash": 64})
                        found = searched(engine, reached, budget, 1, [candidate.uci()])
                    if not found:
                        continue
                    info = found[0]
                    budget_comparison.append(dict(
                        info, budget=budget,
                        san=board.variation_san([root, *map(chess.Move.from_uci, info["pvUci"][:9])]),
                    ))
                replies.append(dict(root=line["pvUci"][0], rootCp=line["cp"], replies=budget_comparison))
            observations.append(dict(id=row["id"], source=row.get("site"), event=event, compared=replies))
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(observations,out,indent=2)
        out.write("\n")

if __name__ == "__main__":
    main()
