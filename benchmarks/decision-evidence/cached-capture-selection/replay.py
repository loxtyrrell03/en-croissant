"""Gather the exact pair nominated by the application replay."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys

import chess.engine

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defender-capture-order"))
from capture_order import Candidate
from freeze import read, write
from trials import APP_ORDER, check_order, initial, searched


def assess(row, query, engine):
    candidate = Candidate(**query["proposal"])
    for original in [row.get("attempt"), *row["selections"].values()]:
        if original and original["proposal"] == query["proposal"]:
            return dict(query, lines=original["lines"])
    with chess.engine.SimpleEngine.popen_uci(engine, timeout=45) as stockfish:
        stockfish.configure({"Threads": 1, "Hash": 64})

        def search(board, nodes, count, roots, *, reason):
            return [dict(line, fen=board.fen()) for line in searched(stockfish, board, nodes, count, roots)]

        result = check_order(search, initial(row), candidate, APP_ORDER)
    return dict(query, lines=result["lines"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("comparisons", type=Path)
    parser.add_argument("nominations", type=Path)
    parser.add_argument("engine")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = {row["id"]: row for row in read(args.comparisons)}
    with ThreadPoolExecutor(max_workers=6) as pool:
        probes = list(pool.map(lambda query: assess(rows[query["id"]], query, args.engine), read(args.nominations)))
    write(args.output, probes)
    print(len(probes))
