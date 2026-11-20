"""Compare castling immediately, delaying it, and trying it after the actual reply."""

import argparse
import json
from pathlib import Path
import sys

import chess
import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


CASES = (
    ((), ("O-O-O", "Bd2", "Bxd6")),
    (("Bd2",), ("Qe8", "c6", "Re8", "Qd7")),
    (("Bd2", "Qe8"), ("Kd1", "O-O-O", "g4")),
    (("Bd2", "Qe8", "O-O-O"), ()),
    (("O-O-O",), ("Qe8", "c6", "Re8")),
    (("O-O-O", "Qe8"), ()),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("selection", "engine", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    selected = next(row for row in json.loads(args.selection.read_bytes()) if row["id"] == "1c048483ab7d924db0dd")
    starting = initial(selected)
    readings = []
    with chess.engine.SimpleEngine.popen_uci(str(args.engine)) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        for prefixes, candidates in CASES:
            board = starting.copy()
            for san in prefixes:
                board.push_san(san)
            roots = [board.parse_san(san).uci() for san in candidates] if candidates else None
            lines = searched(engine, board, 4_800_000, len(roots) if roots else 3, roots)
            readings.append(dict(after=prefixes, fen=board.fen(), candidateScores=[
                dict(line, san=board.variation_san([chess.Move.from_uci(uci) for uci in line["pvUci"][:12]]))
                for line in lines
            ]))
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(dict(source=selected["site"], id=selected["id"], requestedNodes=4_800_000, frames=readings), out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
