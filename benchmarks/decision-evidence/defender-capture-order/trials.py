"""Evaluate matched capture orders with fixed minimum evidence and node budgets."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
import sys
from time import perf_counter

import chess.engine

from capture_order import Candidate, checkpoint, comparison, nomination, score
from freeze import read, write

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defence-after-attack"))
from gather import initial, searched

APP_ROOT = 2_400_000
APP_ORDER = 1_400_000
REF_ORDER = 5_400_000
ROOT_RELEVANCE = 50


def within(lines, move, tolerance):
    if not lines:
        return None
    best = score(lines[0])
    actual = next((line for line in lines if line["pvUci"][:1] == [move]), None)
    actual_score = score(actual)
    return best - actual_score <= tolerance if best is not None and actual_score is not None else None


def root_frame(search, board, move):
    lines = search(board, REF_ORDER, 1, reason="reference-leader")
    if not lines or lines[0]["pvUci"][:1] == [move]:
        return lines
    return search(board, REF_ORDER, 2, [lines[0]["pvUci"][0], move], reason="reference-root")


def check_order(search, board, candidate, nodes):
    after = checkpoint(board, candidate)
    lines = search(after, nodes, 2, [candidate.remove, candidate.take], reason="order")
    proof = comparison(after, candidate, lines)
    return dict(proposal=asdict(candidate), lines=lines, **proof)


def reference(search, board, case):
    if not case.get("candidate"):
        return dict(label="ordinary-unreviewed")
    candidate = Candidate(**case["candidate"])
    compared = check_order(search, board, candidate, REF_ORDER)
    if compared["label"] != "guard-causal":
        return compared
    repeated = check_order(search, board, candidate, 8_000_000)
    if (repeated["label"] != "guard-causal" or repeated["guardRole"] != compared["guardRole"]):
        return dict(compared, label="unresolved", repeated=repeated)
    roots = root_frame(search, board, candidate.root)
    if within(roots, candidate.root, ROOT_RELEVANCE) is not True:
        return dict(compared, label="root-unverified", repeated=repeated, roots=roots)
    after = board.copy(stack=True)
    after.push_uci(candidate.root)
    replies = root_frame(search, after, candidate.reply)
    if within(replies, candidate.reply, 100) is not True:
        return dict(compared, label="reply-unverified", repeated=repeated, roots=roots, replies=replies)
    branch = root_frame(search, checkpoint(board, candidate), candidate.remove)
    if within(branch, candidate.remove, ROOT_RELEVANCE) is not True:
        return dict(compared, label="better-order-unverified", repeated=repeated, roots=roots, replies=replies, branch=branch)
    return dict(compared, label="positive", repeated=repeated, roots=roots, replies=replies, branch=branch)


def app(search, board, case):
    frames = search(board, APP_ROOT, 3, reason="root")
    result = dict(candidates=frames, playedMoveUci=case["recorded"][0])
    if not frames:
        return result
    # Use only engine-visible choices. The game continuation only defines
    # reference questions, and is unavailable to the candidate selector.
    live = [frames[0], *(line for line in frames[1:] if within(frames, line["pvUci"][0], ROOT_RELEVANCE))]
    proposals = [shape for line in live if (shape := nomination(board, line["pvUci"]))]
    if proposals:
        result["proposal"] = asdict(proposals[0])
        result["attempt"] = check_order(search, board, proposals[0], APP_ORDER)
    return result


def evaluate(board, case, binary, method):
    started = perf_counter()
    cost = []
    with chess.engine.SimpleEngine.popen_uci(binary, timeout=45) as engine:
        engine.configure({"Threads": 1, "Hash": 64})

        def search(position, nodes, width, roots=None, *, reason):
            tick = perf_counter()
            lines = searched(engine, position, nodes, count=width, fixed=roots)
            cost.append(dict(reason=reason, nodes=nodes, completed=max((line["nodes"] for line in lines), default=0),
                             ms=round(1000*(perf_counter()-tick))))
            return [dict(line, fen=position.fen()) for line in lines]

        derived = app(search, board, case) if method == "app" else reference(search, board, case)
    return dict(case, **derived, searches=cost, elapsedMs=round(1000*(perf_counter()-started)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("app", "ref"))
    parser.add_argument("cases", type=Path)
    parser.add_argument("binary")
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, default=7)
    args = parser.parse_args()
    rows = read(args.cases)
    if args.mode == "ref":
        rows = [row for row in rows if row.get("candidate")]
    def run(row):
        return evaluate(initial(row), row, args.binary, args.mode)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = []
        for i, result in enumerate(pool.map(run, rows), start=1):
            results.append(result)
            if i % 16 == 0:
                print(args.mode, i, "/", len(rows), flush=True)
    write(args.output, results)
    print(Counter(x.get("label") or (x.get("attempt") or {}).get("label", "no-proposal") for x in results))
