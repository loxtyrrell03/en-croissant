"""Repeat the normal-budget accepted orders at one larger budget."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import perf_counter

import chess.engine

from capture_order import Candidate
from freeze import read, write
from trials import check_order, initial, searched


def repeat(row, executable):
    board = initial(row)
    candidate = Candidate(**row["proposal"])
    started = perf_counter()
    with chess.engine.SimpleEngine.popen_uci(executable, timeout=45) as engine:
        engine.configure({"Threads":1,"Hash":64})

        def search(position, nodes, width, fixed, *, reason):
            return searched(engine, position, nodes, count=width, fixed=fixed)

        proof = check_order(search, board, candidate, 2_400_000)
    root_cp = next(x["cp"] for x in row["candidates"] if x["pvUci"][0] == candidate.root)
    first = proof["lines"][0] if proof["lines"] else None
    return dict(id=row["id"], proof=proof, ms=round(1000*(perf_counter()-started)),
                rootClose=bool(first and first["cp"] is not None and root_cp is not None and abs(first["cp"]-root_cp)<=90),
                agreedRole=proof.get("guardRole") == row["attempt"]["guardRole"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidates", type=Path)
    parser.add_argument("exe")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    eligible = [row for row in read(args.candidates) if row.get("attempt", {}).get("label") == "guard-causal"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda row: repeat(row,args.exe),eligible))
    write(args.output,results)
    print([(x["id"],x["proof"]["label"],x["rootClose"],x["agreedRole"]) for x in results])
