"""Collect independent replies for the candidate breadth experiment."""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path

import chess
import chess.engine

spec = importlib.util.spec_from_file_location(
    "reply_search", Path(__file__).with_name("decision-evidence-probes.py"),
)
search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(search)


def agrees(target, reply):
    if target["mate"] is not None:
        return reply["mate"] is not None and target["mate"] * reply["mate"] < 0
    return target["cp"] is not None and reply["cp"] is not None and abs(
        target["cp"] + reply["cp"]
    ) <= 90


def probe(task):
    request, executable = task
    board = chess.Board(request["fen"])
    board.push_uci(request["moveUci"])
    if board.is_game_over():
        return dict(request, depths=[])
    ranks = min(3, board.legal_moves.count())
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        lines, attempt = search.search_replies(engine, board, ranks, 1_000_000)
        depths = [dict(lines=lines, attempt=attempt)]
        if request["bestTargets"] and (
            lines[0]["depth"] < 16
            or not all(agrees(target, lines[0]) for target in request["bestTargets"])
        ):
            lines, attempt = search.search_replies(engine, board, ranks, 4_000_000)
            depths.append(dict(lines=lines, attempt=attempt))
    return dict(request, depths=depths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("requests", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new results path outside the checkout")
    raw = args.requests.read_bytes()
    manifest = json.loads(raw)
    engine_sha = hashlib.sha256(args.engine.read_bytes()).hexdigest()
    if manifest["protocol"] != 1 or engine_sha != manifest["engineSha256"]:
        raise ValueError("Search engine or request protocol differs")
    tasks = [(item, args.engine.resolve()) for item in manifest["requests"]]
    keys = {(item["id"], item["moveUci"]) for item, _ in tasks}
    if len(keys) != len(tasks):
        raise ValueError("Duplicate reply request")
    rows = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for row in pool.map(probe, tasks):
            rows.append(row)
            if len(rows) % 20 == 0:
                print(f"Verified {len(rows)}/{len(tasks)} nominated replies", flush=True)
    search.root_search.atomic_json(
        args.output,
        dict(protocol=1, requestSha256=hashlib.sha256(raw).hexdigest(),
             engineSha256=engine_sha, rows=rows),
    )


if __name__ == "__main__":
    main()
