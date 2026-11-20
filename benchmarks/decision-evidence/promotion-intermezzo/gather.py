"""Stockfish comparisons for the played choice and the leading candidate."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json
import sys
from time import perf_counter

import chess
sys.path.insert(0, str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from search import engines, search
from gather import root_board, root_stage, reply_stage


def paired_case(row, exe):
    board = root_board(row)
    root = root_stage(row, exe)
    best = root["candidates"][0]
    best_uci = best["pvUci"][0]
    played_uci = row["playedMoveUci"]
    if best_uci == played_uci:
        return dict(root, skipped="played-leads-root")
    if best["cp"] is None:
        return dict(root, skipped="mate-in-root")
    chosen = [board.parse_uci(uci) for uci in (best_uci, played_uci)]
    budget = root["rootSearches"][-1]["nodes"]
    pair = search(board, exe, budget, 2, chosen)["lines"]
    root["comparisonCandidates"] = pair
    if len(pair) != 2 or pair[0]["pvUci"][0] != best_uci or pair[1]["pvUci"][0] != played_uci:
        return dict(root, skipped="ranking-did-not-repeat")
    if any(line["cp"] is None for line in pair) or pair[0]["cp"] - pair[1]["cp"] < 60:
        return dict(root, skipped="no-60cp-loss")
    replies = []
    for choice in pair:
        req = dict(root, candidates=[choice])
        result = reply_stage(req, exe)
        replies.extend(result.get("replyProbes", []))
    return dict(root, replyProbes=replies)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("engine",type=Path)
    args = parser.parse_args()
    cases = json.loads(args.input.read_bytes())
    start = perf_counter()
    progress = Counter()
    try:
        with args.output.open("x",encoding="utf-8") as stream, ThreadPoolExecutor(5) as pool:
            for index,row in enumerate(pool.map(lambda x: paired_case(x,str(args.engine)), cases),1):
                stream.write(json.dumps(row,separators=(",",":"))+"\n")
                stream.flush()
                progress[row.get("skipped","paired-with-replies")] += 1
                if index%10==0:
                    print(index, round(perf_counter()-start,1),flush=True)
    finally:
        for worker in engines:
            worker.quit()
    print(progress, sha256(args.output.read_bytes()).hexdigest(),flush=True)

if __name__=="__main__":
    main()
