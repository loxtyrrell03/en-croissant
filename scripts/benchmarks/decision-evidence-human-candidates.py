"""Compare human-move nominations with wider Stockfish candidate discovery.

Maia supplies legal move identities only. Its scores are never used as chess
evaluation, as ground truth, or by the classifier.
"""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time

import chess
import chess.engine

spec = importlib.util.spec_from_file_location(
    "reply_search", Path(__file__).with_name("decision-evidence-probes.py"),
)
search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(search)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def propose(engine, row):
    board = chess.Board(row["fen"])
    started = time.perf_counter()
    suggested = engine.analyse(
        board, chess.engine.Limit(nodes=1), multipv=min(8, board.legal_moves.count()),
    )
    ranked = [item["pv"][0].uci() for item in suggested]
    if len(ranked) != len(set(ranked)) or len(ranked) != min(8, board.legal_moves.count()):
        raise ValueError(f"Incomplete policy ranking for {row['id']}")
    if any(chess.Move.from_uci(move) not in board.legal_moves for move in ranked):
        raise ValueError(f"Illegal policy move for {row['id']}")
    return ranked, (time.perf_counter() - started) * 1000


def root_pair(engine, board, moves):
    engine.configure({"Clear Hash": None})
    frame = search.root_search.CompleteVariations(board, 2, moves)
    started = time.perf_counter()
    nodes = 0
    with engine.analysis(board, chess.engine.Limit(nodes=1_200_000), multipv=2, root_moves=moves) as stream:
        for info in stream:
            nodes = max(nodes, info.get("nodes", 0))
            frame.add(info)
    if frame.best is None:
        raise ValueError("No complete comparison")
    lines = [
        dict(fen=board.fen(), cp=item["score"].pov(board.turn).score(),
             mate=item["score"].pov(board.turn).mate(), depth=item["depth"],
             pvUci=[move.uci() for move in item["pv"]])
        for item in frame.best
    ]
    return lines, dict(nodes=nodes, milliseconds=(time.perf_counter() - started) * 1000)


def verify(task):
    board_fen, best, move, executable = task
    board = chess.Board(board_fen)
    choices = [board.parse_uci(root) for root in (best, move)]
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        pair, attempt = root_pair(engine, board, choices)
        result = dict(pair=pair, attempt=attempt, reply=None)
        good, alternative = pair
        if good["pvUci"][0] != best or good["depth"] < 16:
            return result
        finite_drop = (
            good["cp"] is not None and alternative["cp"] is not None
            and good["cp"] - alternative["cp"] >= 100
        )
        new_mate = good["cp"] is not None and (alternative["mate"] or 0) < 0
        if finite_drop or new_mate:
            board.push(choices[1])
            if not board.is_game_over():
                lines, attempt = search.search_replies(
                    engine, board, min(3, board.legal_moves.count()), 1_000_000,
                )
                result["reply"] = dict(lines=lines, attempt=attempt)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("policy_engine", type=Path)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--elo", type=int, default=1900)
    parser.add_argument("--policy-max-rank", type=int, choices=range(1, 9), default=8)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new results path outside the checkout")
    raw = args.roots.read_bytes()
    source = json.loads(raw)
    if source["engineSha256"] != sha(args.engine.read_bytes()):
        raise ValueError("Stockfish differs from the root experiment")
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    command = [
        str(args.policy_engine.resolve()), "--model", "maia3-5m",
        "--checkpoint-path", str(args.checkpoint.resolve()), "--device", "cpu", "--no-use-amp",
    ]
    tasks = {}
    results = []
    with chess.engine.SimpleEngine.popen_uci(command, timeout=60) as policy:
        policy.configure({"Elo": args.elo, "Temperature": "0"})
        for row in source["rows"]:
            ranked, milliseconds = propose(policy, row)
            original = [line["pvUci"][0] for line in row["frames"]["original"]["lines"]]
            wide = [line["pvUci"][0] for line in row["frames"]["equalWide"]["lines"]]
            choices = {
                "policy": next(
                    (move for move in ranked[:args.policy_max_rank] if move not in original), None,
                ),
                "wide": next((move for move in wide if move not in original), None),
            }
            results.append(dict(id=row["id"], policy=ranked, policyMs=milliseconds, choices=choices, verification={}))
            for move in dict.fromkeys(choices.values()):
                if move is not None:
                    tasks[row["id"], move] = (row["fen"], original[0], move, args.engine.resolve())
    print(f"Nominated {len(tasks)} distinct extra moves on {len(results)} boards", flush=True)
    by_id = {row["id"]: row for row in results}
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index, ((case, move), result) in enumerate(zip(tasks, pool.map(verify, tasks.values())), 1):
            by_id[case]["verification"][move] = result
            if index % 20 == 0:
                print(f"Checked {index}/{len(tasks)} extra moves", flush=True)
    search.root_search.atomic_json(
        args.output,
        dict(protocol=1, rootSha256=sha(raw), engineSha256=source["engineSha256"],
             checkpointSha256=sha(args.checkpoint.read_bytes()), elo=args.elo,
             policyMaxRank=args.policy_max_rank,
             rootNodes=1_200_000, replyNodes=1_000_000, results=results),
    )


if __name__ == "__main__":
    main()
