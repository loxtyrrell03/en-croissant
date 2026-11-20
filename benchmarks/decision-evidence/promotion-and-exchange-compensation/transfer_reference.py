"""Recheck only nominated transfer cases with a deeper independent search."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import argparse
import json

from reference import check, engines, root_board


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for field in ("frames","screen","stockfish","output"):
        p.add_argument(field,type=Path)
    args=p.parse_args()
    frames={r["id"]:r for r in json.loads(args.frames.read_bytes())}
    jobs=[]
    for row in json.loads(args.screen.read_bytes()):
        variants=row.get("promotionSingle") or row.get("exchangeUncompared")
        if not variants:
            continue
        root=frames[row["id"]]
        preferred=root["candidates"][0]["pvUci"][0]
        arms=[([],9_600_000,3,None),([preferred],7_200_000,4,None)]
        for line in variants["linesUci"]:
            promotion=next((i for i,uci in enumerate(line) if len(uci)==5),None)
            if promotion is not None:
                board=root_board(root)
                for uci in line[:promotion]:
                    board.push_uci(uci)
                arms.append((line[:promotion],3_600_000,min(3,board.legal_moves.count()),None))
        jobs.extend((row["id"],root,arm,str(args.stockfish)) for arm in arms)
    try:
        with ThreadPoolExecutor(5) as pool:
            result=list(pool.map(lambda job:check(*job),jobs))
    finally:
        for engine in engines:
            engine.quit()
    with args.output.open("x",encoding="utf-8") as stream:
        json.dump(dict(engineSha256=sha256(args.stockfish.read_bytes()).hexdigest(),probes=result),stream,indent=2)
    for row in result:
        print(row["problem"]," ".join(row["san"]),[(l["cp"],v) for l,v in
              zip(row["lines"],row["variants"],strict=True)],flush=True)


if __name__=="__main__":
    main()
