"""Evaluate both reached boards and take the nominated resource away in a third search."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json
from time import perf_counter
import sys

import chess
sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from search import engines,search

from nominate import initial

def review(row,exe,nodes):
    board=initial(row)
    boards=[]
    for arm in ("better","played"):
        position=board.copy(stack=True)
        position.push_uci(row[arm])
        for uci in row["path"]:
            position.push_uci(uci)
        if position.fen()!=row[arm+"Fen"]:
            raise ValueError("Checkpoint identity mismatch for " + row["id"])
        boards.append(position)
    good,bad=boards
    move=good.parse_uci(row["resource"])
    valid_without=[m for m in good.legal_moves if m!=move]
    # Only legal checked lines at the exact reached boards are comparable.
    good_result=search(good,exe,nodes,min(3,good.legal_moves.count()))
    bad_result=search(bad,exe,nodes,min(3,bad.legal_moves.count())) if bad.legal_moves.count() else {"lines":[]}
    control=search(good,exe,nodes,min(2,len(valid_without)),valid_without) if valid_without else {"lines":[]}
    return dict(good=good_result,bad=bad_result,excludedResource=control,**row)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("nominations",type=Path)
    p.add_argument("output",type=Path)
    p.add_argument("engine",type=Path)
    p.add_argument("--nodes",type=int,default=2_400_000)
    args=p.parse_args()
    data=args.nominations.read_bytes()
    rows=json.loads(data)
    start=perf_counter()
    try:
        with args.output.open("x",encoding="utf-8") as f, ThreadPoolExecutor(5) as pool:
            f.write(json.dumps({"nodesEach":args.nodes,"engineSha256":sha256(args.engine.read_bytes()).hexdigest(),
                    "nominationsSha256":sha256(data).hexdigest()})+"\n")
            for n,proof in enumerate(pool.map(lambda row:review(row,str(args.engine),args.nodes),rows),1):
                f.write(json.dumps(proof,separators=(",",":"))+"\n")
                f.flush()
                if n%5==0:
                    print(n,round(perf_counter()-start,1),flush=True)
    finally:
        for engine in engines:
            engine.quit()
    print("Reviewed",len(rows),"checkpoints",flush=True)

if __name__=="__main__":
    main()
