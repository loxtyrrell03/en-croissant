"""Search the nominated reply and optionally the exact capture after the stronger choice."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

import chess

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "reply-search-allocation"))
from search import engines, search


def found_board(row, prefix):
    history = row.get("history")
    board = chess.Board(history["fen"] if history else row["fen"])
    if history:
        for uci in history["moves"]:
            board.push_uci(uci)
    if board.fen() != row["fen"]:
        raise ValueError("Game history does not reach the exact comparison board")
    board.push_uci(prefix)
    return board


def probe(data, exe, root, nodes):
    unsafe = found_board(root, data["alternative"])
    assert unsafe.fen() == data["replyFen"]
    other = search(unsafe, exe, nodes, min(3, unsafe.legal_moves.count()))
    if not other["lines"]:
        return data["id"], None
    result = {"reply": other["lines"][0], "queries": [other]}
    if data.get("controlFen"):
        safer = found_board(root, data["preferred"])
        assert safer.fen() == data["controlFen"]
        local = search(safer, exe, nodes, 1, [safer.parse_uci(data["replyUci"])])
        if local["lines"]:
            result["control"] = local["lines"][0]
        result["queries"].append(local)
    return data["id"], result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("inputs", "nominations", "engine", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--nodes", type=int, default=1_400_000)
    args = parser.parse_args()
    inputs = {row["id"]: row for row in json.loads(args.inputs.read_bytes())}
    chosen = json.loads(args.nominations.read_bytes())
    try:
        with ThreadPoolExecutor(6) as pool:
            result = dict(pool.map(
                lambda row: probe(row, str(args.engine), inputs[row["id"]], args.nodes), chosen
            ))
    finally:
        for worker in engines:
            worker.quit()
    with args.output.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(result, file, indent=2)
        file.write("\n")


if __name__ == "__main__":
    main()
