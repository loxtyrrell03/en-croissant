"""Check recorded exchange offers as alternatives when the engine leads elsewhere."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import argparse
import json

from reference import engines,root_board,search


def prepare(row, executable):
    first=row["candidates"][0]
    recorded=row["playedMoveUci"]
    if first["pvUci"][0]==recorded:
        return dict(row,testedMoveUci=recorded,status="recorded-leads")
    position=root_board(row)
    requested=[position.parse_uci(uci) for uci in (first["pvUci"][0],recorded)]
    paired=search(position,executable,2_400_000,2,requested)
    lines=paired["lines"]
    if len(lines)!=2 or any(line["cp"] is None for line in lines):
        return dict(row,status="pair-unavailable",requestedPair=paired)
    offered=next(line for line in lines if line["pvUci"][0]==recorded)
    if offered["cp"]<80 or lines[0]["cp"]-offered["cp"]>80:
        return dict(row,status="outside-equal-budget-comparison",requestedPair=paired)
    joined=dict(row,candidates=lines,testedMoveUci=recorded,status="competitive")
    position.push_uci(recorded)
    reply=search(position,executable,2_400_000,min(3,position.legal_moves.count()))
    joined["replyProbes"]=[{"moveUci":recorded,"lines":reply["lines"]}]
    return joined


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for field in ("frames","engine","output"):
        p.add_argument(field,type=Path)
    a=p.parse_args()
    sample=[row for row in json.loads(a.frames.read_bytes()) if row["stratum"]=="exchange"]
    try:
        with ThreadPoolExecutor(5) as pool:
            result=list(pool.map(lambda row:prepare(row,str(a.engine)),sample))
    finally:
        for running in engines:
            running.quit()
    with a.output.open("x",encoding="utf-8") as stream:
        json.dump(result,stream,separators=(",",":"))
    from collections import Counter
    print(dict(Counter(row["status"] for row in result)),sha256(a.output.read_bytes()).hexdigest(),flush=True)


if __name__=="__main__":
    main()
