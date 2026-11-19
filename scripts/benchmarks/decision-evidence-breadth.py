"""Measure candidate breadth at the same node budget and at a larger budget.

Uses the root cache's actual final requested node budget per board. Search
frames and exact FENs are preserved before any labels or classifier are used.
All generated engine evidence stays outside the checkout.
"""

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

WIDTH = 8
MAX_NODES = 9_600_000
HASH = 64


def sha(data):
    return hashlib.sha256(data).hexdigest()


def measure(task):
    cohort, row, cache, executable, engine_sha = task
    root_bytes = (cache / f"{row['id']}.json").read_bytes()
    root = json.loads(root_bytes)
    identity = root["identity"]
    board = chess.Board(row["fen"])
    if (
        root["id"] != row["id"] or identity["fen"] != board.fen()
        or identity["engine_sha256"] != engine_sha
        or identity["threads"] != 1 or identity["hash_mb"] != HASH
    ):
        raise ValueError(f"Root cache mismatch for {row['id']}")
    nodes = root["rootAttempts"][-1]["nodes"]
    bigger = min(MAX_NODES, 4 * nodes)
    legal = board.legal_moves.count()
    frames = {
        "original": {
            "lines": root["deep"],
            "attempt": {
                "requestedNodes": nodes,
                "depth": root["deep"][0]["depth"],
                "milliseconds": root["deep"][0]["searchMs"],
            },
        },
    }
    profiles = {
        "equalWide": (min(WIDTH, legal), nodes),
        "deepNarrow": (min(3, legal), bigger),
        "deepWide": (min(WIDTH, legal), bigger),
    }
    searched = {(min(3, legal), nodes): frames["original"]}
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": HASH})
        for label, settings in profiles.items():
            if settings not in searched:
                lines, attempt = search.search_replies(engine, board, *settings)
                searched[settings] = dict(lines=lines, attempt=attempt)
            frames[label] = searched[settings]
    return dict(
        cohort=cohort, id=row["id"], fen=board.fen(), legal=legal,
        playedMoveUci=row["playedMoveUci"], cachedRootSha256=sha(root_bytes),
        frames=frames,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cohort", action="append", required=True, nargs=3,
                        metavar=("NAME", "SAMPLE", "ROOT_CACHE"))
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new results path outside the checkout")
    engine_sha = sha(args.engine.read_bytes())
    tasks, cohorts = [], {}
    seen = set()
    for name, sample, cache in args.cohort:
        sample_bytes = Path(sample).read_bytes()
        rows = [row for row in json.loads(sample_bytes)["cases"] if row["split"] == "validation"]
        if not rows or name in cohorts:
            raise ValueError("Provide distinct nonempty cohorts")
        cohorts[name] = dict(sampleSha256=sha(sample_bytes), positions=len(rows))
        for row in rows:
            board = chess.Board(row["fen"])
            board_key = tuple(board.fen().split()[:4])
            if board_key in seen:
                raise ValueError(f"Overlapping board: {row['id']}")
            seen.add(board_key)
            tasks.append((name, row, Path(cache), str(args.engine.resolve()), engine_sha))
    rows = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for row in pool.map(measure, tasks):
            rows.append(row)
            if len(rows) % 10 == 0:
                print(f"Measured {len(rows)}/{len(tasks)} boards", flush=True)
    search.root_search.atomic_json(
        args.output,
        dict(protocol=1, engineSha256=engine_sha, threads=1, hashMB=HASH,
             width=WIDTH, maximumRootNodes=MAX_NODES, cohorts=cohorts, rows=rows),
    )


if __name__ == "__main__":
    main()
