"""Search the stronger checkpoint first and pay for the weaker search only when useful."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json
import sys
from time import perf_counter
import chess

sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from search import engines,search
from nominate import initial
from review import value
from review import shared_consequence


def evaluate(row,exe,nodes):
    start=initial(row)
    good,bad=start.copy(),start.copy()
    for reached,key in ((good,"better"),(bad,"played")):
        for move in [row[key],*row["path"]]:
            reached.push_uci(move)
        if reached.fen()!=row[key+"Fen"]:raise ValueError("Checkpoint does not match")
    check=search(good,exe,nodes,min(3,good.legal_moves.count()))
    a=check["lines"]
    if len(a)<2:return dict(row,status="no-runner-up",good=check)
    leading=a[0]["pvUci"][0]
    if leading not in row["moves"]:
        return dict(row,status="other-defence",good=check)
    strongest,other=value(a[0]),value(a[1])
    if a[0]["depth"]<16 or abs(strongest-row["betterCp"])>120 or strongest-other<90:
        return dict(row,status="insufficient-contrast",good=check)
    reply=search(bad,exe,nodes,min(3,bad.legal_moves.count()))
    b=reply["lines"]
    record=dict(row,resource=leading,resourceSan=row["moves"][leading]["san"],
                obstruction=row["moves"][leading]["kind"],good=check,bad=reply)
    if not b or b[0]["depth"]<16 or abs(value(b[0])-row["playedCp"])>150 or strongest-value(b[0])<90:
        return dict(record,status="played-checkpoint-conflicts")
    event=shared_consequence(a[0],b[0],a[1])
    return dict(record,status="supported" if event else "no-shared-tactical-consequence",eventProof=event)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("input",type=Path)
    p.add_argument("output",type=Path)
    p.add_argument("engine",type=Path)
    p.add_argument("--nodes",type=int,default=1400000)
    args=p.parse_args()
    rows=json.loads(args.input.read_bytes())
    outcomes=Counter()
    try:
        with args.output.open("x",encoding="utf8") as f, ThreadPoolExecutor(5) as pool:
            f.write(json.dumps({"nodesEach":args.nodes,"engineSha256":sha256(args.engine.read_bytes()).hexdigest()})+"\n")
            for item in pool.map(lambda r:evaluate(r,str(args.engine),args.nodes), rows):
                outcomes[item["status"]]+=1
                f.write(json.dumps(item,separators=(",",":"))+"\n")
                f.flush()
    finally:
        for engine in engines:engine.quit()
    print(outcomes,flush=True)
