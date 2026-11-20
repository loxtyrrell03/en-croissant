"""Measure verification with the exact test question supplied to the search."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
import json
from pathlib import Path
from statistics import median
from time import perf_counter

import chess.engine

from capture_order import Candidate, nomination
from freeze import read
from trials import APP_ORDER, check_order, initial, searched


def compare(row, engine):
    started = perf_counter()
    board = initial(row)
    candidate = Candidate(**row["candidate"])
    with chess.engine.SimpleEngine.popen_uci(engine, timeout=45) as stockfish:
        stockfish.configure({"Threads": 1, "Hash": 64})

        def search(position, nodes, width, roots, *, reason):
            return searched(stockfish, position, nodes, count=width, fixed=roots)

        result = check_order(search, board, candidate, APP_ORDER)
    return dict(id=row["id"], reference=row["label"], verification=result["label"],
                gapCp=result.get("gap"), defender=result.get("guardRole"),
                ms=round(1000*(perf_counter()-started)))


def visibility(row, common):
    candidate = row["candidate"]
    root = candidate["root"]
    if common.get("proposal") == candidate and common.get("attempt", {}).get("label") == "guard-causal":
        return "detected"
    paths = [line["pvUci"] for line in common["candidates"] if line["pvUci"][0] == root]
    if not paths:
        return "root-absent"
    paths += [[root, *line["pvUci"]] for probe in common["replyProbes"] if probe["moveUci"] == root
              for line in probe["lines"]]
    board = chess.Board(row["fen"])
    for path in paths:
        if (found := nomination(board, path)) and asdict(found) == candidate:
            return "exact-cached"
    if any(path[1:2] == [candidate["reply"]] for path in paths):
        return "reply-without-order"
    return "root-without-reply"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("common", type=Path)
    parser.add_argument("engine")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    reference = read(args.reference)
    common = {row["id"]: row for row in read(args.common)}
    with ThreadPoolExecutor(max_workers=7) as pool:
        comparisons = list(pool.map(lambda row: compare(row, args.engine), reference))
    grouped = Counter((row["reference"], row["verification"]) for row in comparisons)
    rows = [dict(reference=ref, normalBudget=found, count=count)
            for (ref, found), count in sorted(grouped.items())]
    availability = [dict(id=row["id"], visible=visibility(row, common[row["id"]]))
                    for row in reference if row["label"] == "positive"]
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(dict(counts=rows, medianMs=median(row["ms"] for row in comparisons),
                       availablePositivePaths=dict(Counter(row["visible"] for row in availability)),
                       positivePaths=availability, comparisons=comparisons), out, indent=2)
        out.write("\n")
    print(rows)
