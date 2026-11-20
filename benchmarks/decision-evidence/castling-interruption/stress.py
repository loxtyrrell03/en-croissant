"""Nominate rare, high-impact cases using a cheap fixed-budget root preview."""

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys

import chess.engine

from freeze import board_key, collect, digest, write

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


PREVIEW = (90_000, 120_000)
def scout(engine, case):
    board = initial(case)
    roots = searched(engine, board, PREVIEW[0], 3)
    if not roots or roots[0]["cp"] is None:
        return None
    possible = next((line for line in roots if line["pvUci"][0] in case["castles"]), None)
    if not possible or possible["cp"] is None or roots[0]["cp"] - possible["cp"] > 45:
        return None
    castle, played = possible["pvUci"][0], case["playedMoveUci"]
    pair = searched(engine, board, PREVIEW[1], 2, [castle, played])
    if len(pair) != 2 or pair[0]["pvUci"][0] != castle or any(line["cp"] is None for line in pair):
        return None
    gap = pair[0]["cp"] - pair[1]["cp"]
    if gap >= 60:
        return dict(case, preview=dict(castle=castle, gapCp=gap))
    return None


def search_batch(task):
    executable, cases = task
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 16})
        return [result for case in cases if (result := scout(engine, case))]


def pool(items, forbidden_games, forbidden_boards, cap):
    result = []
    games, keys = set(forbidden_games), set(forbidden_boards)
    for shape in ("checked-king-move", "quiet-king-move"):
        seen = 0
        for row in sorted(items, key=lambda item: item["id"]):
            if row["shape"] != shape or row["game"] in games:
                continue
            key = board_key(chess.Board(row["fen"]))
            if key in keys:
                continue
            result.append(row)
            games.add(row["game"])
            keys.add(key)
            seen += 1
            if seen == cap:
                break
    return result


def select(records, limit):
    picked = []
    counts = Counter()
    for row in sorted(records, key=lambda item: (-item["preview"]["gapCp"], item["id"])):
        if counts[row["event"]] >= 4:
            continue
        counts[row["event"]] += 1
        picked.append(row)
        if len(picked) == limit:
            break
    return picked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("prior", "engine", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--development", type=Path, nargs="+", required=True)
    parser.add_argument("--reserve", type=Path, nargs="+", required=True)
    parser.add_argument("--workers", type=int, default=7)
    args = parser.parse_args()
    earlier = [row for group in json.loads(args.prior.read_bytes()).values() for row in group]
    games = {row["game"] for row in earlier}
    boards = {board_key(chess.Board(row["fen"])) for row in earlier}
    development, dev_sources = collect(args.development)
    reserve, reserve_sources = collect(args.reserve)
    future = {row["event"] for row in reserve.values()}
    nested = {
        "development": [row for row in development.values() if row["event"] not in future],
        "reserve": list(reserve.values()),
    }
    selected, scanned, positives = {}, {}, {}
    with ProcessPoolExecutor(max_workers=args.workers) as workers:
        for scope, rows in nested.items():
            candidates = pool(rows, games, boards, 380)
            batches = [(str(args.engine), candidates[index::args.workers]) for index in range(args.workers)]
            hits = [row for batch in workers.map(search_batch, batches) for row in batch]
            selected[scope] = select(hits, 24)
            games.update(row["game"] for row in selected[scope])
            boards.update(board_key(chess.Board(row["fen"])) for row in selected[scope])
            scanned[scope], positives[scope] = len(candidates), len(hits)
            print(scope, scanned[scope], positives[scope], len(selected[scope]), flush=True)
    write(args.output, selected)
    write(args.output.with_suffix(".manifest.json"), dict(
        priorSha256=digest(args.prior.read_bytes()), engineSha256=digest(args.engine.read_bytes()),
        selectionSha256=digest(args.output.read_bytes()), previewNodes=PREVIEW,
        scanned=scanned, qualified=positives, sources=dict(development=dev_sources, reserve=reserve_sources),
    ))


if __name__ == "__main__":
    main()
