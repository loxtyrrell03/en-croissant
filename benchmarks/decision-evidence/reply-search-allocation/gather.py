"""Capture the ordinary root and best-move reply at the incumbent budgets."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
from time import perf_counter

import chess
from search import engines, search


def root_board(row):
    if not row.get("history"):
        return chess.Board(row["fen"])
    board = chess.Board(row["history"]["fen"])
    for move in row["history"]["moves"]:
        board.push_uci(move)
    if board.fen() != row["fen"]:
        raise ValueError(f"Illegal history in {row['id']}")
    return board


def root_stage(row, executable):
    board = root_board(row)
    ranks = min(3, board.legal_moves.count())
    if not ranks:
        raise ValueError(f"No legal choices in {row['id']}")
    attempts = []
    for nodes in (600_000, 2_400_000, 9_600_000):
        attempt = search(board, executable, nodes, ranks)
        attempts.append(dict(nodes=nodes, headDepth=attempt["lines"][0]["depth"] if attempt["lines"] else None))
        if not attempt["lines"]:
            break
        best = attempt["lines"][0]
        lines = attempt["lines"]
        if best["depth"] >= 18 or best["mate"] is not None:
            break
    return dict(row, candidates=lines, rootSearches=attempts, sourceFile="prospective-sample.json")


def reply_stage(row, executable):
    board = root_board(row)
    best = row["candidates"][0]
    board.push_uci(best["pvUci"][0])
    ranks = min(3, board.legal_moves.count())
    if not ranks:
        return row
    lines = []
    for nodes in (1_000_000, 4_000_000):
        attempt = search(board, executable, nodes, ranks)
        if not attempt["lines"]:
            break
        lines = attempt["lines"]
        reply = lines[0]
        if reply["depth"] >= 16 and (
            (reply["cp"] is not None and best["cp"] is not None and abs(reply["cp"] + best["cp"]) <= 90)
            or (reply["mate"] is not None and best["mate"] is not None and reply["mate"] * best["mate"] < 0)
        ):
            break
    return dict(row, replyProbes=[{"moveUci": best["pvUci"][0], "lines": lines}])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("--best-reply", action="store_true")
    args = parser.parse_args()
    rows = json.loads(args.sample.read_bytes())
    phase = reply_stage if args.best_reply else root_stage
    start = perf_counter()
    try:
        with ThreadPoolExecutor(5) as pool:
            writes = pool.map(lambda row: phase(row, str(args.engine)), rows)
            result = []
            for i, item in enumerate(writes, 1):
                result.append(item)
                if i % 20 == 0:
                    print(f"{i}/{len(rows)} in {perf_counter()-start:.1f}s", flush=True)
        with args.output.open("x", encoding="utf-8") as file:
            json.dump(result, file, separators=(",", ":"))
        print(sha256(args.output.read_bytes()).hexdigest(), flush=True)
    finally:
        for runner in engines:
            runner.quit()


if __name__ == "__main__":
    main()
