"""Run the restricted Stockfish checks for the World Junior control."""

import argparse
from hashlib import sha256
import json
from pathlib import Path

import chess
import chess.engine

from prepare import read


def check(frame, engine):
    board = chess.Board(frame["history"]["fen"])
    for uci in frame["history"]["moves"]:
        board.push_uci(uci)
    if board.fen() != frame["fen"]:
        raise ValueError("The original game history does not reach the saved position")
    checks = (
        ("played knight and recapture", ["c6d4", "b5d4"], ["c5d4", "e7f6"]),
        ("pawn choice and the same knight move", ["c5d4"], ["b5d4"]),
    )
    records = []
    with chess.engine.SimpleEngine.popen_uci(str(engine)) as worker:
        worker.configure({"Threads": 1, "Hash": 64})
        for name, prefix, moves in checks:
            reached = board.copy()
            for uci in prefix:
                reached.push_uci(uci)
            for uci in moves:
                worker.configure({"Clear Hash": None})
                info = worker.analyse(
                    reached,
                    chess.engine.Limit(nodes=2_800_000),
                    root_moves=[chess.Move.from_uci(uci)],
                )
                pv = info["pv"]
                white = info["score"].white()
                if pv[0].uci() != uci:
                    raise ValueError("The engine reply ignored its restricted move")
                records.append({
                    "position": name,
                    "fen": reached.fen(),
                    "restrictedMove": uci,
                    "depth": info["depth"],
                    "reportedNodes": info["nodes"],
                    "whiteCentipawns": white.score(),
                    "whiteMate": white.mate(),
                    "lineUci": [move.uci() for move in pv],
                    "lineSan": reached.variation_san(pv[:12]),
                })
    return {"engineSha256": sha256(engine.read_bytes()).hexdigest(), "searches": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    frame = read(Path(__file__).resolve().with_name("world-junior-frames.json"))[0]
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(check(frame, args.engine), stream, indent=2)
        stream.write("\n")
