"""Capture the normal app frames and an independent wider reference search."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import chess.engine

from pawn_plans import assets
from capture_order import score
from freeze import read, write
from trials import initial, searched, within


def capture(row, engine, mode):
    board = initial(row)
    normal = mode == "app"
    root_nodes, reply_nodes = (2_400_000, 1_000_000) if normal else (5_400_000, 3_200_000)
    sizes = []
    with chess.engine.SimpleEngine.popen_uci(engine, timeout=45) as stockfish:
        stockfish.configure({"Threads": 1, "Hash": 64})

        def search(position, nodes, width, moves=None):
            lines = searched(stockfish, position, nodes,count=width,fixed=moves)
            sizes.append(max((line["nodes"] for line in lines), default=0))
            return [dict(line, fen=position.fen()) for line in lines]

        root = search(board, root_nodes, 3 if normal else 4)
        replies = []
        paired = []
        played = row["recorded"][0]
        if root:
            leading = root[0]["pvUci"][0]
            if normal and played != leading:
                paired = search(board, root_nodes, 2, [leading, played])
            choices = [root[0]]
            if normal:
                choices += [line for line in paired if line["pvUci"][0] == played]
            elif assets(board):
                choices += [line for line in root[1:3] if within(root, line["pvUci"][0], 75)]
            for line in choices:
                move = line["pvUci"][0]
                child = board.copy(stack=True)
                child.push_uci(move)
                found = search(child, reply_nodes, 3)
                if normal and found and (
                    score(found[0]) is None
                    or (line["cp"] is not None and found[0]["cp"] is not None and
                        abs(line["cp"] + found[0]["cp"]) > 90)
                ):
                    found = search(child,4_000_000,3) or found
                if found:
                    replies.append(dict(moveUci=move, lines=found))
    return dict(row, candidates=root, comparisonCandidates=paired, replyProbes=replies,
                playedMoveUci=played, frameNodes=sizes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("app","deep"))
    parser.add_argument("sample", type=Path)
    parser.add_argument("stockfish")
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, default=7)
    args = parser.parse_args()
    cases = read(args.sample)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        captured = []
        for i, row in enumerate(pool.map(lambda row: capture(row,args.stockfish,args.mode), cases), 1):
            captured.append(row)
            if i % 24 == 0:
                print(args.mode, i, len(cases), flush=True)
    write(args.output, captured)
    print(args.mode, Counter(bool(row["candidates"]) for row in captured), flush=True)
