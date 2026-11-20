"""Check every transfer positive with a stronger, separate Stockfish search."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import argparse
import json
import sys

import chess

from assets import extract, reached, reference
from experiment import HERE, load_module


NODES = 3_600_000


def audit(row, executable, frame_tools, search):
    assets = [item for item in extract(row, frame_tools.family(row["event"])) if item.target]
    if not assets:
        return []
    board = reached(row)
    moves = [board.parse_uci(row[field]) for field in ("candidate", "playedMoveUci")]
    roots = search.search(board, executable, NODES, 2, moves)
    results = []
    for branch, move in zip(("better", "played"), moves, strict=True):
        matching = [item for item in assets if item.branch == branch]
        if not matching:
            continue
        child = matching[0].child
        replies = search.search(child, executable, NODES, 2)
        paired = [line for line in roots["lines"] if line["pvUci"][0] == move.uci()]
        for item in matching:
            target = reference(child, item.square, paired[0]["pvUci"][1:] if paired else [], replies["lines"])
            results.append({
                "case": item.id, "site": row["site"], "fen": board.fen(),
                "branch": branch, "move": move.uci(), "square": chess.square_name(item.square),
                "originalTarget": True, "strongerTarget": target, "roots": roots, "replies": replies,
            })
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("directory", "executable", "output"):
        p.add_argument(name, type=Path)
    args = p.parse_args()
    frame_tools = load_module("deep_witness_frames", HERE.parent / "neural-deep-witness" / "frames.py")
    search = sys.modules["search"]
    result = {"engineSha256": sha256(args.executable.read_bytes()).hexdigest(), "nodesPerQuery": NODES}
    frozen = json.loads((HERE / "protocol.json").read_text(encoding="utf-8"))["inputs"]
    for split in ("test", "reserve"):
        path = args.directory / f"{split}.jsonl"
        if sha256(path.read_bytes()).hexdigest() != frozen[path.name]:
            raise ValueError(f"Frozen input has changed: {path.name}")
    try:
        with ThreadPoolExecutor(5) as pool:
            for split in ("test", "reserve"):
                rows = frame_tools.records(args.directory / f"{split}.jsonl")
                runs = pool.map(lambda row: audit(row, str(args.executable), frame_tools, search), rows)
                result[split] = [item for run in runs for item in run]
    finally:
        for engine in search.engines:
            engine.quit()
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(result, out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
