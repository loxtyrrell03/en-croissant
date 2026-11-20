"""Assemble held-back game frames and independently recheck proposed causes."""

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
from pathlib import Path
import sys

import chess
import chess.engine

sys.path.append(str(Path(__file__).resolve().parent.parent / "defence-after-attack"))
from gather import group, initial, read, searched

CORPORA = {
    "archive": ("reply-coverage-audit/full-pair-input.json",),
    "deep": ("evidence-ceiling-v38/depth-input.json",),
    "classical": ("compared-motif-identity/reserve.json", "discovered-target-identity/classical.json",
                  "blocked-defensive-resource/reserve-frames.jsonl", "paired-causal-probe/classical-reserve-frames.jsonl"),
    "puzzle": ("mixed-mistake-contrast/complete-puzzle-reserve-frames.jsonl",),
}


def cache(research):
    seen = set()
    for cohort, sources in CORPORA.items():
        for file in sources:
            for row in read(research / file):
                if row["id"] not in seen:
                    seen.add(row["id"])
                    yield dict(row, cohort=cohort)


def board_key(row):
    board = chess.Board(row["fen"])
    return min(board.epd(), board.mirror().epd())


def on_board(lines, board):
    return [dict(line, fen=board.fen()) for line in lines]


def check(task):
    row, engine_path, nodes = task
    board = initial(row)
    pair = row.get("comparisonCandidates") or row["candidates"]
    best, played, attack = pair[0]["pvUci"][0], row["playedMoveUci"], row["recordedAttack"]
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        engine.configure({"Hash": 64, "Threads": 1})
        matched = on_board(searched(engine, board, nodes, fixed=[best, played]), board)
        probes = []
        for move in (best, played):
            reached = board.copy()
            reached.push_uci(move)
            probes.append(dict(moveUci=move, lines=on_board(searched(engine, reached, nodes), reached)))
        stronger = board.copy()
        stronger.push_uci(best)
        move = chess.Move.from_uci(attack)
        control = None
        if stronger.is_legal(move):
            control = on_board(searched(engine, stronger, nodes, fixed=[attack]), stronger)
    return dict(row, candidates=matched, comparisonCandidates=matched, replyProbes=probes,
                controlledAttack=control)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("cache", "check"))
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--engine", type=Path)
    parser.add_argument("--nodes", type=int, default=4_800_000)
    args = parser.parse_args()
    if args.mode == "cache":
        rows = list(cache(args.source))
    else:
        if not args.engine:
            parser.error("check requires --engine")
        with ProcessPoolExecutor(max_workers=5) as pool:
            rows = list(pool.map(check, [(row, str(args.engine), args.nodes) for row in read(args.source)]))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(rows, stream, separators=(",", ":"))
    print(dict(Counter(item["cohort"] for item in rows)), hashlib.sha256(args.output.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
