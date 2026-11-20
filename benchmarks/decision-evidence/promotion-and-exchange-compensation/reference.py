"""Search the two development examples and the reached promotion boards."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import argparse
import json
import sys
import chess

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/reply-search-allocation"))
from gather import root_board
from search import engines, search


PROBES = {
    "buongoma": [
        ([], 4_000_000, 3, None),
        ([], 12_000_000, 2, ["d2d5", "e2f3"]),
        (["d2d5"], 5_000_000, 3, None),
        (["e2f3"], 5_000_000, 3, None),
    ],
    "amateur-u1700": [
        ([], 5_000_000, 3, None),
        (["a6a7"], 6_000_000, 4, None),
        (["a6a7", "g6f5"], 3_600_000, 3, None),
        (["a6a7", "g4g3", "f2g3", "d6g3"], 3_600_000, 3, None),
    ],
}


def check(problem, row, arm, executable):
    prefix, nodes, ranks, allowed = arm
    board = root_board(row)
    transcript = []
    for uci in prefix:
        move = board.parse_uci(uci)
        transcript.append(board.san(move))
        board.push(move)
    choices = [board.parse_uci(uci) for uci in allowed] if allowed is not None else None
    result = search(board, executable, nodes, ranks, choices)
    variants = [board.variation_san([chess.Move.from_uci(uci) for uci in line["pvUci"][:12]])
                for line in result["lines"]]
    return dict(problem=problem, id=row["id"], prefix=prefix, san=transcript,
                board=board.fen(), variants=variants, **result)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for field in ("archive", "stockfish", "output"):
        p.add_argument(field,type=Path)
    args = p.parse_args()
    records = json.loads(args.archive.read_bytes())
    names = {"buongoma":"94a4f0c091c3a703", "amateur-u1700":"b7b765ea84af4f87"}
    jobs = []
    for problem, arms in PROBES.items():
        row = next(r for r in records if names[problem] in r["id"])
        jobs.extend((problem,row,arm,str(args.stockfish)) for arm in arms)
    try:
        with ThreadPoolExecutor(6) as pool:
            observed = list(pool.map(lambda job:check(*job),jobs))
    finally:
        for engine in engines:
            engine.quit()
    with args.output.open("x",encoding="utf-8") as out:
        json.dump(dict(engineSha256=sha256(args.stockfish.read_bytes()).hexdigest(),
                       probes=observed),out,indent=2)
    for row in observed:
        print(row["problem"]," ".join(row["san"]),[(l["cp"],v) for l,v in
              zip(row["lines"],row["variants"],strict=True)],flush=True)


if __name__ == "__main__":
    main()
