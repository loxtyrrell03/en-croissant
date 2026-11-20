"""Replay equal-node reply searches from the same verified chess position."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from threading import local
from time import perf_counter
import argparse
import json

import chess
import chess.engine

spec = spec_from_file_location("engine_frames", Path.cwd() / "scripts/benchmarks/decision-evidence-engine.py")
engine_frames = module_from_spec(spec)
spec.loader.exec_module(engine_frames)
state = local()
engines = []
BUDGET = 1_000_000


def engine(exe):
    if not hasattr(state, "engine"):
        worker = chess.engine.SimpleEngine.popen_uci(exe)
        worker.configure({"Threads": 1, "Hash": 64})
        state.engine = worker
        engines.append(worker)
    return state.engine


def child(row, option):
    if row.get("history"):
        board = chess.Board(row["history"]["fen"])
        for move in row["history"]["moves"]:
            board.push_uci(move)
        if board.fen() != row["fen"]:
            raise ValueError(f"Root history did not reach {row['id']}")
    else:
        board = chess.Board(row["fen"])
    board.push_uci(option["moveUci"])
    if board.fen() != option["fen"]:
        raise ValueError(f"Wrong reply board in {row['id']}")
    return board


def search(board, executable, nodes, ranks, allowed=None):
    exact = engine_frames.CompleteVariations(board, ranks, allowed)
    elapsed = perf_counter()
    with engine(executable).analysis(
        board, chess.engine.Limit(nodes=nodes), multipv=ranks, root_moves=allowed, game=object()
    ) as stream:
        last_nodes = 0
        for info in stream:
            last_nodes = max(last_nodes, info.get("nodes", 0))
            exact.add(info)
    elapsed = perf_counter() - elapsed
    return {
        "requestedNodes": nodes,
        "observedNodes": last_nodes,
        "milliseconds": round(elapsed * 1000, 2),
        "lines": [{
            "fen": board.fen(), "cp": item["score"].relative.score(),
            "mate": item["score"].relative.mate(), "depth": item["depth"],
            "nodes": item["nodes"], "pvUci": [move.uci() for move in item["pv"]],
        } for item in exact.best or []],
    }


def measure(row, executable, reference=False):
    arms = []
    for option in row["options"]:
        board = child(row, option)
        nominated = board.parse_uci(option["alternative"]["pvUci"][1])
        if reference:
            searches = {"broad": search(board, executable, 4 * BUDGET, min(4, board.legal_moves.count()))}
            searches["focused"] = search(board, executable, 4 * BUDGET, 1, [nominated])
        else:
            searches = {
                "ordinary": search(board, executable, BUDGET, min(3, board.legal_moves.count())),
                "single": search(board, executable, BUDGET, 1),
                "focused": search(board, executable, BUDGET, 1, [nominated]),
            }
        arms.append(dict(moveUci=option["moveUci"], nominated=nominated.uci(), **searches))
    return dict(id=row["id"], options=arms)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("--reference", action="store_true")
    args = parser.parse_args()
    data = args.input.read_bytes()
    rows = json.loads(data)
    print(f"Searching {len(rows)} positions", flush=True)
    start = perf_counter()
    try:
        with args.output.open("x", encoding="utf-8") as file, ThreadPoolExecutor(5) as pool:
            metadata = {"engineSha256": sha256(args.engine.read_bytes()).hexdigest(),
                        "inputSha256": sha256(data).hexdigest(), "reference": args.reference}
            file.write(json.dumps(metadata) + "\n")
            for index, result in enumerate(pool.map(lambda row: measure(row, str(args.engine), args.reference), rows), 1):
                file.write(json.dumps(result, separators=(",", ":")) + "\n")
                file.flush()
                if index % 10 == 0:
                    print(f"{index} in {perf_counter() - start:.1f}s", flush=True)
    finally:
        for item in engines:
            item.quit()


if __name__ == "__main__":
    main()
