"""Unrestricted reply checks for the archived mixed training references."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from pathlib import Path
import json
import sys
from time import perf_counter

sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from gather import root_board
from search import engines, search


def inspect(row, exe):
    board = root_board(row)
    moves = [board.parse_uci(row["candidates"][0]["pvUci"][0]), board.parse_uci(row["playedMoveUci"])]
    if moves[0] == moves[1]:
        return {"id":row["id"],"excluded":"same-move"}
    pair = search(board, exe, 5_000_000, 2, moves)
    alternatives = []
    for move in moves:
        reached = board.copy()
        reached.push(move)
        if not reached.legal_moves.count():
            alternatives.append({"moveUci":move.uci(),"terminal":True})
            continue
        unconstrained = search(reached,exe,6_000_000,min(3,reached.legal_moves.count()))
        alternatives.append(dict(moveUci=move.uci(),branches=unconstrained))
    return dict(id=row["id"],fen=row["fen"],pair=pair,alternatives=alternatives)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("engine",type=Path)
    args=parser.parse_args()
    cases=json.loads(args.input.read_bytes())
    start=perf_counter()
    try:
        with args.output.open("x",encoding="utf-8") as file, ThreadPoolExecutor(5) as pool:
            for i,item in enumerate(pool.map(lambda row: inspect(row,str(args.engine)), cases),1):
                file.write(json.dumps(item,separators=(",",":"))+"\n")
                file.flush()
                if i%4==0:print(i,round(perf_counter()-start,1),flush=True)
    finally:
        for worker in engines:
            worker.quit()

if __name__=="__main__":
    main()
