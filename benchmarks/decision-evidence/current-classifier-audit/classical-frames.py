"""Capture matched app inputs and independent deeper frames for the blind review."""
import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys
from time import perf_counter

import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


BUDGETS = {"app": (2_400_000, 1_400_000), "reference": (5_400_000, 3_200_000)}


def run(task):
    case, exe, stage, previous_candidate = task
    board = initial(case)
    root_nodes, reply_nodes = BUDGETS[stage]
    readings = []

    def frame(engine, position, nodes, count, fixed=None):
        result = searched(engine, position, nodes, count, fixed)
        readings.append(dict(requestedNodes=nodes, deepestCompleteNodes=max(
            (row["nodes"] for row in result), default=0,
        )))
        return [dict(line, fen=position.fen()) for line in result]

    started = perf_counter()
    with chess.engine.SimpleEngine.popen_uci(exe) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        candidates = frame(engine, board, root_nodes, 3 if stage == "app" else 4)
        if not candidates:
            raise ValueError(f"No root frame for {case['id']}")
        good = candidates[0]["pvUci"][0]
        played = case["playedMoveUci"]
        comparison = frame(engine, board, root_nodes, 2, [good, played]) if good != played else []
        roots = [line["pvUci"][0] for line in candidates[:2]]
        targets = dict.fromkeys([*roots, played, *( [previous_candidate] if previous_candidate else [])])
        replies = []
        for uci in targets:
            reached = board.copy()
            reached.push_uci(uci)
            lines = [] if reached.is_game_over() else frame(engine, reached, reply_nodes, 2)
            if lines:
                replies.append(dict(moveUci=uci, lines=lines))
    return dict(case, candidates=candidates, replyProbes=replies,
                **({"comparisonCandidates": comparison} if comparison else {}),
                search=dict(stage=stage, frames=readings, milliseconds=round((perf_counter() - started) * 1000)))


def read(path):
    return json.loads(path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=BUDGETS)
    parser.add_argument("input", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--app-frames", type=Path)
    parser.add_argument("--workers", type=int, default=7)
    args = parser.parse_args()
    if (args.stage == "reference") != bool(args.app_frames):
        parser.error("The reference stage requires the first-stage exact candidate with --app-frames.")
    first = {r["id"]: r for r in read(args.app_frames)} if args.app_frames else {}
    cases = read(args.input)
    if first and set(first) != {r["id"] for r in cases}:
        raise ValueError("First-stage frames do not match the frozen games.")
    jobs = [(case, str(args.engine), args.stage, first[case["id"]]["candidates"][0]["pvUci"][0] if first else None)
            for case in cases]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        rows = []
        for row in pool.map(run, jobs):
            rows.append(row)
            if len(rows) % 12 == 0:
                print(args.stage, len(rows), flush=True)
    with args.output.open("x", encoding="utf8") as out:
        json.dump(rows, out, separators=(",", ":"))
        out.write("\n")


if __name__ == "__main__":
    main()
