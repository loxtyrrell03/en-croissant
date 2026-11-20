"""Search plausible counterfactual moves for the frozen puzzle geometries."""
from concurrent.futures import ThreadPoolExecutor
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import sys

import chess

lab=Path(__file__).parent
spec=spec_from_file_location("promotion_bench",lab/"gather.py")
paired=module_from_spec(spec)
spec.loader.exec_module(paired)
from search import engines, search

sample=Path(sys.argv[1])
output=Path(sys.argv[2])
exe=sys.argv[3]
items=json.loads(sample.read_bytes())["rows"]


def trial(row):
    board=chess.Board(row["fen"])
    root=paired.root_stage(row,exe)
    head=root["candidates"][0]
    best=board.parse_uci(head["pvUci"][0])
    if not best.promotion or head["cp"] is None:
        return dict(root,skipped="root-not-finite-promotion")
    candidate=board.parse_uci(row["sourcePath"][2]) if board.is_legal(chess.Move.from_uci(row["sourcePath"][2])) else None
    if candidate is not None and (candidate.promotion or not board.gives_check(candidate)):
        candidate=None
    if candidate is None:
        alternatives=[move for move in board.legal_moves if not move.promotion]
        if not alternatives:
            return dict(root,skipped="all-legal-options-promote")
        found=search(board,exe,700_000,1,alternatives)["lines"]
        if not found:
            return dict(root,skipped="no-finite-control")
        candidate=board.parse_uci(found[0]["pvUci"][0])
    return paired.paired_case(dict(row,playedMoveUci=candidate.uci()),exe)


try:
    with output.open("x",encoding="utf-8") as stream, ThreadPoolExecutor(5) as pool:
        for n,row in enumerate(pool.map(trial,items),1):
            stream.write(json.dumps(row,separators=(",",":"))+"\n")
            stream.flush()
            if n%10==0:print(n,flush=True)
finally:
    for runner in engines:
        runner.quit()
