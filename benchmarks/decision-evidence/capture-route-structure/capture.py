"""Record a common shortlist and independent searches of the frozen paired choices."""

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys
from time import perf_counter

import chess.engine

from freeze import write

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import initial, searched


BUDGETS = {
    "app": (2_400_000, 1_400_000, 1_400_000),
    "reference": (6_000_000, 4_800_000, 3_200_000),
}


def capture(task):
    case, executable, stage = task
    board = initial(case)
    root_nodes, pair_nodes, reply_nodes = BUDGETS[stage]
    started = perf_counter()
    pairs = case["pairs"]
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 64})

        def read(position, nodes, count, roots=None):
            return [dict(line, fen=position.fen())
                    for line in searched(engine, position, nodes, count, roots)]

        candidates = read(board, root_nodes, 3)
        scout_roots = [line["pvUci"][0] for line in candidates]
        # Research searches every frozen pair at the higher budget. The ordinary
        # candidate can only see pairs with a check already in its shortlist.
        selected_pairs = pairs if stage == "reference" else [pair for pair in pairs if pair[0] in scout_roots]
        paired = []
        for pair in selected_pairs:
            if all(uci in scout_roots for uci in pair) and stage == "app":
                lines = [line for line in candidates if line["pvUci"][0] in pair]
                paired.append(dict(pair=pair, lines=lines, targeted=False))
            else:
                paired.append(dict(pair=pair, lines=read(board, pair_nodes, 2, pair), targeted=True))

        # Reuse each reached-position search across pairs. The shared search
        # helper clears Stockfish's hash before each independent search.
        origins = dict.fromkeys([*scout_roots[:2], case["playedMoveUci"],
                                *(uci for pair in selected_pairs for uci in pair)])
        probes = []
        for uci in origins:
            reached = board.copy()
            reached.push_uci(uci)
            if not reached.is_game_over():
                lines = read(reached, reply_nodes, 2)
                if lines:
                    probes.append(dict(moveUci=uci, lines=lines))
    return dict(case, candidates=candidates, pairFrames=paired, replyProbes=probes,
                milliseconds=round((perf_counter() - started) * 1000))


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
    jobs = [(case, str(args.engine), args.stage) for case in cases]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = []
        for result in pool.map(capture, jobs):
            results.append(result)
            if len(results) % 8 == 0:
                print(args.stage, args.split, len(results), flush=True)
    write(args.output, results)


if __name__ == "__main__":
    main()
