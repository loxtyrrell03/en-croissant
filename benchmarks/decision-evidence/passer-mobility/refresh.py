"""Prospective refresh for cached games with an advanced pawn and incomplete frames."""

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
import json
from pathlib import Path

import chess
import chess.engine

from experiment import board_key, comparison, group, initial, load, passed, progress, searched


def choose(rows, per_rank):
    strata = {4: [], 5: []}
    for row in rows:
        if comparison(row):
            continue
        root = initial(row)
        side = not root.turn
        ranks = [progress(square, side) for square in root.pieces(chess.PAWN, side)
                 if progress(square, side) in strata and passed(root, square, side)]
        if ranks:
            strata[max(ranks)].append(row)
    sample, used, boards = [], set(), set()
    for rank in (5, 4):
        seed = "passer-mobility-prospective-v1:"
        ordered = sorted(strata[rank], key=lambda row: sha256((seed + row["id"]).encode()).digest())
        selected = 0
        for row in ordered:
            game, key = group(row), board_key(row)
            if game in used or key in boards:
                continue
            used.add(game)
            boards.add(key)
            sample.append((rank, row))
            selected += 1
            if selected >= per_rank:
                break
    return sample, {rank + 1: len(items) for rank, items in strata.items()}


def frame(result, board):
    return [dict(row, fen=board.fen()) for row in result]


def refresh(task):
    rank, row, path, nodes = task
    source = initial(row)
    retained = {key: row[key] for key in ("id", "fen", "playedMoveUci", "site", "event", "history") if key in row}
    retained.update(game=group(row), originalPasserRank=rank + 1, candidates=[])
    played = row["playedMoveUci"]
    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        engine.configure({"Hash": 32, "Threads": 1})
        leading = searched(engine, source, 600_000)
        retained["candidates"] = frame(leading, source)
        if not leading:
            return dict(retained, refresh="missing-preview")
        best = leading[0]["pvUci"][0]
        if best == played:
            return dict(retained, refresh="played-leads-preview")
        pair = searched(engine, source, nodes, fixed=[best, played])
        retained["comparisonCandidates"] = frame(pair, source)
        if len(pair) != 2 or pair[0]["pvUci"][0] != best:
            return dict(retained, refresh="preferred-choice-changed")
        if pair[0]["cp"] is None or pair[1]["cp"] is None or pair[0]["cp"] - pair[1]["cp"] < 90:
            return dict(retained, refresh="no-finite-paired-loss")
        replies = []
        for move in (best, played):
            reached = source.copy()
            reached.push_uci(move)
            replies.append(dict(moveUci=move, lines=frame(searched(engine, reached, nodes), reached)))
        retained["replyProbes"] = replies
        return dict(retained, refresh="stable" if comparison(retained) else "unconfirmed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("inputs", type=Path, nargs="+")
    parser.add_argument("--exclude", type=Path, nargs="*", default=[])
    parser.add_argument("--skip-sampled", type=Path)
    parser.add_argument("--per-rank", type=int, default=12)
    parser.add_argument("--nodes", type=int, default=2_400_000)
    args = parser.parse_args()
    sample, eligible = choose(load(args.inputs, args.exclude).values(), args.per_rank)
    if args.skip_sampled:
        seen = {item["id"] for item in json.loads(args.skip_sampled.read_bytes())}
        sample = [(rank, row) for rank, row in sample if row["id"] not in seen]
    print("Eligible by rank", eligible, "and selected", len(sample), flush=True)
    tasks = [(rank, row, str(args.engine), args.nodes) for rank, row in sample]
    with ProcessPoolExecutor(max_workers=5) as pool:
        outcomes = list(pool.map(refresh, tasks))
    print(dict(Counter(row["refresh"] for row in outcomes)))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(outcomes, stream, indent=2)


if __name__ == "__main__":
    main()
