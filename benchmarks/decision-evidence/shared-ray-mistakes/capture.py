"""Capture paired played-move frames and a matched opponent reply."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

import chess.engine

from freeze import load_index
from ray_review import evaluated, prefix, view

# Reuse the exact finite-node Stockfish frame collection used by the existing audits.
sys.path.append(str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


def collect(binary, row, stage):
    board = initial(row)
    app = stage == "app"
    root_nodes, reply_nodes = (2_400_000, 1_400_000) if app else (7_200_000, 5_000_000)
    measured = []
    with chess.engine.SimpleEngine.popen_uci(binary, timeout=45) as engine:
        engine.configure({"Threads": 1, "Hash": 64})

        def search(position, nodes, width, fixed=None):
            lines = searched(engine, position, nodes, count=width, fixed=fixed)
            measured.append(max((line["nodes"] for line in lines), default=0))
            return [{"fen": position.fen(), **line} for line in lines]

        root = search(board, root_nodes, 3)
        played = row["recorded"][0]
        best = root[0]["pvUci"][0] if root else None
        comparison = search(board, root_nodes, 2, [best, played]) if best and best != played else []
        if not root or any(not line["pvUci"] for line in comparison):
            raise ValueError(f"Missing root frame for {row['id']}")
        replies = []
        paired = (len(comparison) == 2 and comparison[0]["pvUci"][0] == best and
                  all(line["cp"] is not None for line in comparison))
        if paired and comparison[0]["cp"] - comparison[1]["cp"] >= (75 if app else 60):
            for line in comparison:
                move = line["pvUci"][0]
                child = prefix(board, [move])
                response = search(child, reply_nodes, 3)
                if app and response and (response[0]["depth"] < 16 or response[0]["cp"] is None or
                                         abs(line["cp"] + response[0]["cp"]) > 90):
                    response = search(child, 4_000_000, 3) or response
                if response:
                    replies.append(dict(moveUci=move, lines=response))
        result = dict(row, candidates=root, comparisonCandidates=comparison,
                      playedMoveUci=played, replyProbes=replies)
        if (context := evaluated(result)):
            _, _, _, opponent, _, _ = context
            reply = opponent["pvUci"][0]
            matching = next((line for line in view(result, best)
                             if line["pvUci"][0] == reply), None)
            if not matching:
                child = prefix(board, [best])
                found = search(child, 1_000_000 if app else 5_000_000, 1, [reply])
                matching = found[0] if found else None
            if matching:
                result["sharedReply"] = dict(betterMoveUci=best, playedMoveUci=played, line=matching)
        return dict(result, engineNodes=measured)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument("section", choices=["development", "reserve", "enrichedDevelopment", "enrichedReserve"])
    parser.add_argument("stage", choices=["app", "deep"])
    parser.add_argument("engine")
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, default=7)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    rows = load_index(args.sample)[args.section]
    past = {row["id"]: row for row in load_index(args.previous)} if args.previous else {}

    def generate(row):
        old = past.get(row["id"])
        if old and all(row[key] == old[key] for key in ("fen", "history")) and row["recorded"][:2] == old["recorded"][:2]:
            return dict(old, **row)
        return collect(args.engine, row, args.stage)

    with ThreadPoolExecutor(max_workers=args.workers) as executor, \
         args.output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write("[\n")
        for index, row in enumerate(executor.map(generate, rows)):
            if index:
                stream.write(",\n")
            stream.write(json.dumps(row, separators=(",", ":")))
            stream.flush()
            if (index+1) % 12 == 0 or index+1 == len(rows):
                print(args.section, args.stage, index+1, len(rows), flush=True)
        stream.write("\n]\n")


if __name__ == "__main__":
    main()
