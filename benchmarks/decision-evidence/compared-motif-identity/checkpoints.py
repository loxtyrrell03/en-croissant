"""Re-search specific legal comparison boards with and without a fixed move."""

import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import importlib
import json
from pathlib import Path
import sys

import chess
import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/benchmarks"))
engine_tools = importlib.import_module("decision-evidence-engine")


def measure(task):
    case, executable, nodes = task
    board = chess.Board(case["fen"])
    for uci in case["prefix"]:
        board.push_uci(uci)
    fixed = case.get("fixed")
    roots = [board.parse_uci(uci) for uci in fixed] if fixed else None
    count = min(3, len(roots) if roots else board.legal_moves.count())
    if count == 0:
        raise ValueError("Terminal checkpoint")
    reducer = engine_tools.CompleteVariations(board, count)
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 32})
        with engine.analysis(board, chess.engine.Limit(nodes=nodes), multipv=count, root_moves=roots) as analysis:
            for row in analysis:
                reducer.add(row)
    lines = [{
        "depth": row["depth"], "cp": row["score"].relative.score(),
        "mate": row["score"].relative.mate(), "nodes": row["nodes"],
        "pvUci": [move.uci() for move in row["pv"]],
        "san": board.variation_san(row["pv"][:12]),
    } for row in reducer.best or []]
    return dict(case, reachedFen=board.fen(), lines=lines)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("engine", type=Path)
    cli.add_argument("input", type=Path)
    cli.add_argument("output", type=Path)
    cli.add_argument("--nodes", type=int, default=2_400_000)
    args = cli.parse_args()
    inputs = json.loads(args.input.read_bytes())
    tasks = [(row, str(args.engine), args.nodes) for row in inputs]
    with ProcessPoolExecutor(max_workers=6) as pool:
        frames = list(pool.map(measure, tasks))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(engineSha256=hashlib.sha256(args.engine.read_bytes()).hexdigest(),
                       requestedNodes=args.nodes, cases=frames), stream, indent=2)
    for frame in frames:
        print(frame["id"], [(line["depth"], line["cp"], line["mate"], line["san"])
                            for line in frame["lines"]], flush=True)


if __name__ == "__main__":
    main()
