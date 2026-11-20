"""Check each nominated defence at the exact board after the pawn advances."""

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys
from time import perf_counter

import chess
import chess.engine


def read(path):
    return json.loads(Path(path).read_bytes())


def verify(job):
    row, check, engine_path, engine_helpers, nodes = job
    sys.path.append(engine_helpers)
    from gather import initial, searched
    board = initial(row)
    for move in check["prefix"]:
        board.push_uci(move)
    if chess.Board(check["fen"]).fen() != board.fen():
        raise ValueError("Checkpoint does not replay to the recorded board")
    move = check["captureUci"]
    board.parse_uci(move)
    start = perf_counter()
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        engine.configure({"Hash": 64, "Threads": 1})
        selected = searched(engine, board, nodes, fixed=[move])
        alternatives = searched(engine, board, nodes)
    return dict(id=row["id"], **check, selected=selected, alternatives=alternatives,
                seconds=round(perf_counter() - start, 3))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("output", "engine", "helpers"):
        parser.add_argument(field, type=Path)
    parser.add_argument("--inputs", nargs="+", type=Path, required=True)
    parser.add_argument("--replays", nargs="+", type=Path, required=True)
    parser.add_argument("--nodes", type=int, default=4_800_000)
    args = parser.parse_args()
    raw = {row["id"]: row for path in args.inputs for row in read(path)}
    jobs = []
    for path in args.replays:
        for case in read(path):
            nomination = case.get("combined")
            if nomination is None or "#" in case["id"]:
                continue
            row = raw[case["id"]]
            jobs.extend((row, check, str(args.engine), str(args.helpers), args.nodes)
                        for check in nomination["checks"])
    print(len(jobs), "exact controls", flush=True)
    with ProcessPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(verify, jobs))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(results, stream, indent=2)


if __name__ == "__main__":
    main()
