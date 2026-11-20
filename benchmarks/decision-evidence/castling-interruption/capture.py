"""Capture ordinary engine frames and the exact castling counterfactuals."""

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys
from time import perf_counter

import chess.engine

from freeze import write

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import finite, initial, searched


BUDGETS = {
    "app": (2_400_000, 2_400_000, 1_400_000, 1_800_000),
    "reference": (6_000_000, 4_800_000, 3_200_000, 4_800_000),
}


def play(board, *moves):
    reached = board.copy()
    for move in moves:
        reached.push_uci(move)
    return reached


def index(lines):
    return {line["pvUci"][0]: line for line in lines}


def capture(task):
    case, binary, stage = task
    board = initial(case)
    root_budget, pair_budget, reply_budget, late_budget = BUDGETS[stage]
    started = perf_counter()
    played = case["playedMoveUci"]
    castles = case["castles"]
    cost = []
    with chess.engine.SimpleEngine.popen_uci(binary) as engine:
        engine.configure({"Threads": 1, "Hash": 64})

        def search(name, position, nodes, width=2, choices=None):
            begin = perf_counter()
            lines = searched(engine, position, nodes, width, choices)
            cost.append(dict(name=name, requestedNodes=nodes, milliseconds=round((perf_counter() - begin) * 1000)))
            return [dict(line, fen=position.fen()) for line in lines]

        candidates = search("root", board, root_budget, 3)
        top = candidates[0]["pvUci"][0]
        pair = search("pair", board, pair_budget, len(castles) + 1, [*castles, played])
        root = index(candidates)
        choice = index(pair)
        castle = next((line["pvUci"][0] for line in pair if line["pvUci"][0] in castles), None)
        result = dict(case, candidates=candidates, allExactChoices=pair, replies=[], queries=cost)
        if not castle or played not in choice:
            return result
        better = choice[castle]
        weak = choice[played]
        if castle == top:
            result["comparisonCandidates"] = [line for line in pair if line["pvUci"][0] in {castle, played}]
        if any(not finite(line) for line in (better, weak, candidates[0])):
            return result
        if castle not in root or candidates[0]["cp"] - root[castle]["cp"] > 35 or better["cp"] - weak["cp"] < 70:
            return result

        after_delay = play(board, played)
        after_castle = play(board, castle)
        attack = search("delay-reply", after_delay, reply_budget, 3)
        safe = search("castle-reply", after_castle, reply_budget, 3)
        result["replyProbes"] = [
            dict(moveUci=move, lines=lines) for move, lines in [(castle, safe), (played, attack)] if lines
        ]
        if not attack or not safe or not finite(attack[0]) or not finite(safe[0]):
            return result
        hit = attack[0]["pvUci"][0]
        if len(weak["pvUci"]) < 3 or weak["pvUci"][1] != hit or len(attack[0]["pvUci"]) < 2:
            return result
        if abs(weak["cp"] + attack[0]["cp"]) > 90 or abs(better["cp"] + safe[0]["cp"]) > 90:
            return result

        move = chess.Move.from_uci(hit)
        if after_castle.is_legal(move):
            cached = index(safe).get(hit)
            same = [cached] if cached else search("same-reply", after_castle, reply_budget, 1, [hit])
            result["sameAfterCastle"] = same
        else:
            result["sameReplyIllegal"] = True

        threatened = play(after_delay, hit)
        late = [move.uci() for move in threatened.generate_castling_moves()]
        if late:
            responses = list(dict.fromkeys([weak["pvUci"][2], attack[0]["pvUci"][1], *late]))
            continuation = search("late-pair", threatened, late_budget, len(responses), responses)
            after_late = []
            for move_uci in late:
                lines = search("late-reply", play(threatened, move_uci), reply_budget, 2)
                after_late.append(dict(moveUci=move_uci, lines=lines))
            result["late"] = dict(choices=continuation, castles=late, replyProbes=after_late)
    return dict(result, milliseconds=round((perf_counter() - started) * 1000))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=BUDGETS)
    parser.add_argument("selection", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--split", choices=("development", "reserve", "calibration"), required=True)
    parser.add_argument("--workers", type=int, default=7)
    args = parser.parse_args()
    cases = json.loads(args.selection.read_bytes())[args.split]
    tasks = [(case, str(args.engine), args.stage) for case in cases]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        rows = []
        for row in pool.map(capture, tasks):
            rows.append(row)
            if len(rows) % 10 == 0:
                print(args.stage, args.split, len(rows), flush=True)
    write(args.output, rows)


if __name__ == "__main__":
    main()
