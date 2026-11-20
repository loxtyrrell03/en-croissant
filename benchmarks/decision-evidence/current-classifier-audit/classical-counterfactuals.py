"""Recheck selected misses with matched searches of the exact live choices."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys

import chess.engine

from classical_score import digest, exact_index, read, write

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


# Nominated from the sealed reference and the first comparison's misses.
# These are diagnostic cases. They have no role in the held-out scores.
CASES = (
    ("openedBishopCheck", "00aa89b4d2df6c904503", ("f4g5", "f7f6"), ("b3g8", "g5f4")),
    ("captureOrder", "0dc9a0af698ebf750c12", ("g2g4", "e7g5"), ("f5g6", "g4h5")),
    ("removeOriginalDefender", "00aa62121c2fecb25a1d", ("g3f2", "h6h5"), ("f2e3", "b2b6")),
    ("sameReplyAfterMistake", "011ee7b47d52c0273595", ("g5h4", "e7h7"), ("h5f6", "d1c1")),
    ("sameReplyAfterBetter", "011ee7b47d52c0273595", ("d1c1", "e7h7"), ("h5f6", "g5f6")),
    ("captureAfterKingSupport", "0004dc640efac6bd5b14", ("g4g3",), ("h8h2", "d2e3")),
    ("captureWithoutKingSupport", "0004dc640efac6bd5b14", ("g4f5",), ("h8h2", "d2e3")),
)


def evaluate(task):
    title, row, prefix, roots, binary, nodes = task
    board = initial(row)
    checkpoint = board.copy()
    for move in prefix:
        checkpoint.push_uci(move)
    with chess.engine.SimpleEngine.popen_uci(binary) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        variants = searched(engine, checkpoint, nodes, count=2, fixed=roots)
    if set(line["pvUci"][0] for line in variants) != set(roots):
        raise ValueError(f"Missing exact branch after {title}")
    return dict(
        name=title, id=row["id"], site=row["site"], rootFen=board.fen(), checkpointFen=checkpoint.fen(),
        prefixUci=prefix, prefixSan=board.variation_san([chess.Move.from_uci(move) for move in prefix]),
        requestedNodes=nodes,
        compared=[dict(line, san=checkpoint.variation_san([
            chess.Move.from_uci(move) for move in line["pvUci"][:10]
        ])) for line in variants],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("stockfish", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--nodes", type=int, default=4_800_000)
    args = parser.parse_args()
    sample = exact_index(read(args.sample))
    if digest(args.sample) != read(args.reference)["sampleSha256"]:
        raise ValueError("Selection differs from the sealed review.")
    jobs = [(tag, sample[key], prefix, roots, str(args.stockfish), args.nodes) for tag, key, prefix, roots in CASES]
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(evaluate, jobs))
    write(args.output, dict(referenceSha256=digest(args.reference), engineSha256=digest(args.stockfish),
                            cases=results))


if __name__ == "__main__":
    main()
