"""Gather paired and independent searches for each move on a short shortlist."""

import argparse
import concurrent.futures
import importlib.util
import json
from pathlib import Path

import chess


SPEC = importlib.util.spec_from_file_location(
    "nomination", Path(__file__).with_name("decision-evidence-quick-nomination.py"),
)
nomination = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(nomination)
sha = nomination.verification.sha


def check_board(task):
    row, cached, executable, shortlist_only = task
    original = row["frames"]["original"]["lines"]
    shortlist = cached["observed"].get("six90k", {}).get("lines", [])
    board = chess.Board(row["fen"])
    top = {line["pvUci"][0] for line in original}
    extra = [line["pvUci"][0] for line in shortlist if line["pvUci"][0] not in top]
    if len(extra) != len(set(extra)) or any(board.parse_uci(move) not in board.legal_moves for move in extra):
        raise ValueError(f"Invalid candidate list: {row['id']}")
    if next(iter(extra), None) != cached["choices"].get("six90k"):
        raise ValueError(f"Baseline nomination mismatch: {row['id']}")
    result = {key: row[key] for key in ("id", "fen", "sourceGroup", "event")} | dict(
        original=original, shortlist=shortlist,
    )
    if shortlist_only:
        return result
    result["searches"] = {
        move: cached["verification"].get(move) or nomination.verification.verify(
            (row["fen"], original[0]["pvUci"][0], move, executable),
        )
        for move in extra
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--batch", nargs=3, action="append", required=True,
                        metavar=("ROOTS", "QUICK_SEARCHES", "CACHE_OR_DASH"))
    parser.add_argument("--manifests", type=Path, required=True)
    parser.add_argument("--shortlist-only", action="store_true")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new output path outside the checkout")
    metadata = {}
    for manifest in args.manifests.rglob("tournament-sample.json"):
        for row in json.loads(manifest.read_bytes())["cases"]:
            key = (row["id"], row["fen"])
            value = {field: row[field] for field in ("sourceGroup", "event", "stratum")}
            if key in metadata and metadata[key] != value:
                raise ValueError(f"Conflicting sample metadata: {key[0]}")
            metadata[key] = value
    engine_sha = sha(args.engine.read_bytes())
    inputs, tasks, seen_ids, seen_boards = [], [], set(), set()
    for root_path, quick_path, cache in args.batch:
        root_raw, quick_raw = Path(root_path).read_bytes(), Path(quick_path).read_bytes()
        rows = nomination.load_rows(json.loads(root_raw), Path(cache) if cache != "-" else None, engine_sha)
        quick = json.loads(quick_raw)
        if (quick["rootSha256"] != sha(root_raw) or quick["engineSha256"] != engine_sha
                or quick["profiles"].get("six90k") != [6, 90_000]):
            raise ValueError("Nomination does not match the root search, engine and profile")
        by_id = {row["id"]: row for row in quick["results"]}
        if len(by_id) != len(rows) or by_id.keys() != {row["id"] for row in rows}:
            raise ValueError("Root and nomination coverage differ")
        inputs.append({"rootSha256": sha(root_raw), "quickSha256": sha(quick_raw)})
        for row in rows:
            cached = by_id[row["id"]]
            cache_sha = cached.get("cachedRootSha256")
            if (cache != "-" or cache_sha is not None) and row["cachedRootSha256"] != cache_sha:
                raise ValueError(f"Root changed: {row['id']}")
            info = metadata[row["id"], row["fen"]]
            key = " ".join(chess.Board(row["fen"]).fen().split()[:4])
            if row["id"] in seen_ids or key in seen_boards:
                raise ValueError(f"Repeated position: {row['id']}")
            seen_ids.add(row["id"])
            seen_boards.add(key)
            tasks.append((row | info, cached, str(args.engine.resolve()), args.shortlist_only))
    if not tasks:
        raise ValueError("No boards to check")
    results = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(check_board, tasks):
            results.append(result)
            if len(results) % 20 == 0:
                print(f"Checked {len(results)}/{len(tasks)} boards", flush=True)
    nomination.verification.search.root_search.atomic_json(args.output, dict(
        protocol=1, engineSha256=engine_sha, inputs=inputs, results=results,
    ))


if __name__ == "__main__":
    main()
