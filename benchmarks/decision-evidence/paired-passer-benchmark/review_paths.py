"""Check the same legal continuation after two choices for manual review."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path

import chess

from search_pairs import engines, reached, search


NODES = 2_400_000


def inspect(row, move_path, engine):
    board = reached(row)
    played = []
    for uci in move_path:
        move = chess.Move.from_uci(uci)
        if not board.is_legal(move):
            return {"prefix": played, "illegalNextMove": uci, "fen": board.fen(),
                    "inCheck": board.is_check()}
        played.append(board.san(move))
        board.push(move)
    if board.is_game_over():
        return {"prefix": played, "fen": board.fen(), "terminal": board.result()}
    probes = search(board, engine, NODES, min(2, board.legal_moves.count()))
    for line in probes["lines"]:
        line["san"] = board.variation_san([chess.Move.from_uci(move) for move in line["pvUci"][:10]])
    return {"prefix": played, "fen": board.fen(), "inCheck": board.is_check(), "probe": probes}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("preview", "requests", "engine", "output"):
        p.add_argument(name, type=Path)
    args = p.parse_args()
    preview = json.loads(args.preview.read_bytes())
    rows = {row["id"]: row for group in preview.values() for row in group}
    requests = json.loads(args.requests.read_bytes())
    tasks = [(rows[case["id"]], path) for case in requests for path in case["paths"]]
    try:
        with ThreadPoolExecutor(5) as pool:
            results = list(pool.map(lambda item: inspect(*item, str(args.engine)), tasks))
    finally:
        for engine in engines:
            engine.quit()
    receipt = {
        "engineSha256": sha256(args.engine.read_bytes()).hexdigest(), "requestedNodes": NODES,
        "paths": [dict(result, case=task[0]["id"], path=task[1]) for task, result in zip(tasks, results, strict=True)],
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(receipt, stream, separators=(",", ":"))
        stream.write("\n")


if __name__ == "__main__":
    main()
