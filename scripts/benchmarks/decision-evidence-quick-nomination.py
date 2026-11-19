"""Compare short Stockfish searches for selecting one extra move.

Nomination sees only the board and the original three candidates. It uses
the same paired search and independent reply as the wide-search experiment.
"""

import argparse
import concurrent.futures
import importlib.util
import json
from pathlib import Path

import chess
import chess.engine

spec = importlib.util.spec_from_file_location(
    "verification", Path(__file__).with_name("decision-evidence-human-candidates.py"),
)
verification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verification)

PROFILES = {"three60k": (3, 60_000), "six90k": (6, 90_000), "eight180k": (8, 180_000)}


def inspect(task):
    row, previous, executable, profiles = task
    fen = row["fen"]
    board = chess.Board(fen)
    original = {line["pvUci"][0] for line in row["frames"]["original"]["lines"]}
    best = row["frames"]["original"]["lines"][0]["pvUci"][0]
    legal = board.legal_moves.count()
    old = previous["verification"] if previous else {}
    choices, observed, checked = {}, {}, {}
    if len(original) < legal:
        with chess.engine.SimpleEngine.popen_uci(executable) as engine:
            engine.configure({"Threads": 1, "Hash": 64})
            for name, (width, budget) in profiles.items():
                lines, attempt = verification.search.search_replies(
                    engine, board, min(width, legal), budget,
                )
                observed[name] = {"lines": lines, "attempt": attempt}
                move = next((line["pvUci"][0] for line in lines if line["pvUci"][0] not in original), None)
                choices[name] = move
    for move in dict.fromkeys(choices.values()):
        if move is not None:
            checked[move] = old.get(move) or verification.verify((fen, best, move, executable))
    return {"id": row["id"], "cachedRootSha256": row.get("cachedRootSha256"),
            "choices": choices, "observed": observed, "verification": checked}


def load_rows(roots, cache, engine_sha):
    if cache is None:
        if roots["engineSha256"] != engine_sha:
            raise ValueError("Search engine differs from the existing analysis")
        return roots["rows"]
    rows = []
    for case in roots["cases"]:
        if case["split"] != "validation":
            continue
        raw = (cache / (case["id"] + ".json")).read_bytes()
        root = json.loads(raw)
        if (root["id"] != case["id"] or root["identity"]["fen"] != case["fen"]
            or root["identity"]["engine_sha256"] != engine_sha):
            raise ValueError(f"Root cache identity mismatch: {case['id']}")
        rows.append(dict(case, cachedRootSha256=verification.sha(raw),
                         frames={"original": {"lines": root["deep"]}}))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--old-candidates", type=Path)
    parser.add_argument("--root-cache", type=Path, help="Read a sample manifest and its ordinary Stockfish roots")
    parser.add_argument("--profile", choices=PROFILES)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new output path outside the checkout")
    raw = args.roots.read_bytes()
    engine_sha = verification.sha(args.engine.read_bytes())
    rows = load_rows(json.loads(raw), args.root_cache, engine_sha)
    ids = {row["id"] for row in rows}
    if not rows or len(ids) != len(rows):
        raise ValueError("Each evaluated board needs a distinct identity")
    by_id, old_bytes = {}, None
    if args.old_candidates:
        old_bytes = args.old_candidates.read_bytes()
        old = json.loads(old_bytes)
        if (old["rootSha256"] != verification.sha(raw) or old["engineSha256"] != engine_sha
            or (old["rootNodes"], old["replyNodes"]) != (1_200_000, 1_000_000)):
            raise ValueError("Existing candidate searches use a different benchmark")
        by_id = {row["id"]: row for row in old["results"]}
        if by_id.keys() != ids:
            raise ValueError("Root and verification coverage differ")
    profiles = {args.profile: PROFILES[args.profile]} if args.profile else PROFILES
    tasks = [(row, by_id.get(row["id"]), str(args.engine.resolve()), profiles) for row in rows]
    results = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for row in pool.map(inspect, tasks):
            results.append(row)
            if len(results) % 20 == 0:
                print(f"Nominated and checked {len(results)}/{len(tasks)} boards", flush=True)
    verification.search.root_search.atomic_json(args.output, {
        "protocol": 1, "rootSha256": verification.sha(raw),
        "oldCandidateSha256": verification.sha(old_bytes) if old_bytes else None,
        "engineSha256": engine_sha, "profiles": profiles, "results": results,
    })


if __name__ == "__main__":
    main()
