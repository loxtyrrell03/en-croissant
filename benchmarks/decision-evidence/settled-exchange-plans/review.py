"""Search the exact queen-trade and pawn-advance comparison boards."""
import argparse
import json
from pathlib import Path
import sys

import chess

from examine import HERE

sys.path.insert(0, str(HERE.parent / "reply-search-allocation"))
from search import engines, search


def probe(row, prefix, engine, nodes, ranks, restricted=None):
    board = chess.Board(row["history"]["fen"])
    for uci in row["history"]["moves"]:
        board.push_uci(uci)
    if board.fen() != row["fen"]:
        raise ValueError(row["id"])
    for uci in prefix:
        board.push_uci(uci)
    moves = [board.parse_uci(uci) for uci in restricted] if restricted else None
    result = search(board, engine, nodes, min(ranks, board.legal_moves.count()), moves)
    return {"id": row["id"], "fen": board.fen(), "prefix": prefix, "search": result}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    for key in ("engine", "output"):
        cli.add_argument(key, type=Path)
    args = cli.parse_args()
    rows = json.loads((HERE / "fixture.json").read_bytes())
    requests = (
        ("witney", ("h6h8", "d7d8", "h8f6"), 2400000, 4, None),
        ("witney", ("h6h8", "c8b7", "h8f6"), 2400000, 4, None),
        ("witney", ("b1c1",), 2400000, 4, None),
        ("amsterdam", ("f6e5", "d4e5"), 3600000, 2, ("e4e5", "d5d4")),
    )
    try:
        result = [probe(rows[key], prefix, str(args.engine), nodes, width, restricted)
                  for key, prefix, nodes, width, restricted in requests]
    finally:
        for engine in engines:
            engine.quit()
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(result, out, separators=(",", ":"))
        out.write("\n")


if __name__ == "__main__":
    main()
