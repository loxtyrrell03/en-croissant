"""Check two mixed-scope misses after opening the Candidates reference."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


PAIRED_ROOTS = {
    "09649d1822ef052c427d": ["c6e7", "e6d5"],
    "4070dd5a11a1b22087cc": ["g7g5", "g7g6", "f7f6"],
}


def inspect(binary, case, nodes):
    board = initial(case)
    roots = PAIRED_ROOTS[case["id"]]
    with chess.engine.SimpleEngine.popen_uci(binary) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        results = searched(engine, board, nodes, len(roots), roots)
        if {line["pvUci"][0] for line in results} != set(roots):
            raise ValueError(f"Missing exact root choices for {case['id']}.")
        variants = []
        for line in results:
            after = board.copy()
            after.push_uci(line["pvUci"][0])
            replies = searched(engine, after, nodes, 2)
            for response in replies:
                response["san"] = san(after, response)
            variants.append(dict(line, san=san(board, line), replies=replies))
    return dict(id=case["id"], site=case["site"], fen=board.fen(), requestedNodes=nodes, variants=variants)


def san(board, line):
    return board.variation_san([chess.Move.from_uci(move) for move in line["pvUci"][:12]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("selection", "engine", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    picked = {item["id"]: item for item in json.loads(args.selection.read_bytes()) if item["id"] in PAIRED_ROOTS}
    if picked.keys() != PAIRED_ROOTS.keys():
        raise ValueError("Selection differs from the annotated benchmark.")
    tasks = [(case, nodes) for case in picked.values() for nodes in (4_800_000, 8_000_000)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        result = list(executor.map(lambda pair: inspect(str(args.engine), *pair), tasks))
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(dict(engineSha256=sha256(args.engine.read_bytes()).hexdigest(), cases=result), out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
