"""Re-run candidate lines and retain separately searched exact boards."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess

from examine import HERE, evaluate

sys.path.insert(0, str(HERE.parent / "reply-search-allocation"))
from search import engines, search


def checked(row, nominations, engine):
    board = chess.Board(row["fen"])
    if history := row.get("history"):
        board = chess.Board(history["fen"])
        for uci in history["moves"]:
            board.push_uci(uci)
    if board.fen() != row["fen"]:
        raise ValueError(row["id"])
    roots = search(board, engine, 4800000, min(3, board.legal_moves.count()))["lines"]
    probes = []
    for line in roots:
        move = line["pvUci"][0]
        if move not in nominations:
            continue
        child = board.copy()
        child.push_uci(move)
        if not child.is_game_over(claim_draw=True):
            replies = search(child, engine, 2800000, min(3, child.legal_moves.count()))["lines"]
            probes.append({"moveUci": move, "lines": replies})
    changed = dict(row, candidates=roots, replyProbes=probes)
    return {
        "id": row["id"], "site": row.get("site"), "fen": row["fen"],
        "candidates": roots, "replyProbes": probes, "confirmation": evaluate(changed),
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ("lab", "inputs", "engine", "output"):
        cli.add_argument(name, type=Path)
    cli.add_argument("--explicit", type=Path)
    args = cli.parse_args()
    data = json.loads(args.inputs.read_bytes())
    cases = []
    for source, group in data.items():
        path = args.explicit or (args.lab / source)
        rows = {row["id"]: row for row in json.loads(path.read_bytes())}
        for item in group["cases"]:
            candidates = {r["move"] for r in item["effects"] if r["used"]}
            if candidates:
                cases.append((rows[item["id"]], candidates))
    try:
        with ThreadPoolExecutor(6) as pool:
            results = list(pool.map(lambda case: checked(*case, str(args.engine)), cases))
    finally:
        for worker in engines:
            worker.quit()
    result = {
        "engineSha256": sha256(args.engine.read_bytes()).hexdigest(), "cases": results,
        "proposed": len(cases), "confirmed": sum(any(c["linked"] for c in row["confirmation"]) for row in results),
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(result, out, separators=(",", ":"))
        out.write("\n")
    print("confirmed", result["confirmed"], "of", result["proposed"], flush=True)


if __name__ == "__main__":
    main()
