"""Check a concrete defensive resource on either side of the same attack."""

import argparse
import json
from pathlib import Path
import sys

import chess
import chess.engine

from freeze import digest, write

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


def play(board, sans):
    reached = board.copy()
    for san in sans:
        reached.push_san(san)
    return reached


def timing(engine, board, nodes):
    reached_early = play(board, ("O-O-O", "Qe8", "g4", "Qa4"))
    reached_late = play(board, ("Bd2", "Qe8", "O-O-O", "Qa4"))
    resource = reached_early.parse_san("Bh3")
    if reached_late.is_legal(resource):
        raise ValueError("The timing comparison no longer changes the bishop move's legality")

    def lines(position, moves=None):
        roots = [position.parse_san(san).uci() for san in moves] if moves else None
        return [dict(line, san=position.variation_san([
            chess.Move.from_uci(uci) for uci in line["pvUci"][:10]
        ])) for line in searched(engine, position, nodes, len(roots) if roots else 2, roots)]

    return dict(
        nodes=nodes, comparedResource=resource.uci(),
        early=dict(fen=reached_early.fen(), full=lines(reached_early),
                   exact=lines(reached_early, ("Bh3", "Re1", "c4", "Kb1"))),
        late=dict(fen=reached_late.fen(), full=lines(reached_late),
                  exact=lines(reached_late, ("g4", "Re1", "c4", "Kb1"))),
        lateG4Reply=lines(play(reached_late, ("g4",))),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("calibration", "engine", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    [row] = json.loads(args.calibration.read_bytes())["calibration"]
    with chess.engine.SimpleEngine.popen_uci(str(args.engine)) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        frames = [timing(engine, initial(row), nodes) for nodes in (4_800_000, 8_000_000)]
    write(args.output, dict(site=row["site"], id=row["id"], engineSha256=digest(args.engine.read_bytes()), frames=frames))


if __name__ == "__main__":
    main()
