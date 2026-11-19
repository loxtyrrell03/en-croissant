"""Prepare independently analysed reply frames for the exact-fork replay."""

import argparse
import concurrent.futures
import importlib
import json
from pathlib import Path

import chess
import chess.engine

payoff = importlib.import_module("decision-evidence-fork-payoff")


def one(task):
    cache, executable, row = task
    stored = payoff.read(cache / (row["id"] + ".json"))
    paired = stored["comparison"]
    exact = next(line for line in paired if line["pvUci"][0] == row["move"])
    if exact["fen"] != row["fen"]:
        raise ValueError("Matched exact move has a different root")
    board = chess.Board(row["fen"])
    board.push_uci(row["move"])
    replies = stored["reply"]
    if any(line["fen"] != board.fen() for line in replies):
        raise ValueError("Stored reply has a different root")
    requested = 0
    if replies and replies[0]["depth"] < 16:
        with chess.engine.SimpleEngine.popen_uci(executable) as engine:
            engine.configure({"Threads": 1, "Hash": 32})
            for limit in (1_200_000, 2_400_000):
                if replies[0]["depth"] >= 16:
                    break
                searched = payoff.search(engine, board, limit)
                requested += limit
                if searched and searched[0]["depth"] >= replies[0]["depth"]:
                    replies = [dict(fen=board.fen(), depth=entry["depth"], cp=entry["cp"], mate=entry["mate"],
                                    pvUci=entry["pv"]) for entry in searched]
    return dict(id=row["id"], fen=row["fen"], move=row["move"], paired=paired,
                withReplies=[dict(moveUci=row["move"], lines=replies)]), requested


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument("root_cache", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=6)
    args = parser.parse_args()
    tasks = [(args.root_cache, str(args.engine.resolve()), row) for row in payoff.read(args.sample)["cases"]]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        rows, budgets = zip(*pool.map(one, tasks), strict=True)
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(rows, file)
    print(json.dumps(dict(positions=len(rows), extraRequestedNodes=sum(budgets))))


if __name__ == "__main__":
    main()
