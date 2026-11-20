"""Supply the shared root/reply inputs to both workers in a second comparison."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys

import chess.engine

from freeze import read, write

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defence-after-attack"))
from gather import initial, searched


def close(root, reply):
    if root["mate"] is not None and reply["mate"] is not None:
        return root["mate"] * reply["mate"] < 0
    return root["cp"] is not None and reply["cp"] is not None and abs(root["cp"] + reply["cp"]) <= 90


def gather(row, executable, top_only):
    board = initial(row)
    if not row["candidates"]:
        return row
    leader = row["candidates"][0]
    played = row["playedMoveUci"]
    choices = [leader]
    comparison = []
    probes = []
    with chess.engine.SimpleEngine.popen_uci(executable, timeout=45) as engine:
        engine.configure({"Threads":1,"Hash":64})
        if not top_only and played != leader["pvUci"][0]:
            comparison = searched(engine, board, 2_400_000, count=2, fixed=[played, leader["pvUci"][0]])
            choices += [line for line in comparison if line["pvUci"][0] == played]
        for line in choices:
            move = line["pvUci"][0]
            after = board.copy(stack=True)
            after.push_uci(move)
            lines = searched(engine, after, 1_000_000, count=3)
            if not lines or lines[0]["depth"] < 16 or not close(line, lines[0]):
                lines = searched(engine, after, 4_000_000, count=3) or lines
            if lines:
                probes.append(dict(moveUci=move, lines=[dict(candidate, fen=after.fen()) for candidate in lines]))
    return dict(row, replyProbes=probes,
                comparisonCandidates=[dict(candidate, fen=row["fen"]) for candidate in comparison])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("engine")
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--top-only", action="store_true")
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda row: gather(row,args.engine,args.top_only), read(args.input)))
    write(args.output,results)
    print("shared reply frames",len(results), flush=True)
