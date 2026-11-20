from collections import Counter
from pathlib import Path
import itertools, json, sys
import chess
d=Path(sys.argv[1])
rows=[json.loads(i) for i in (d/"deep-review.jsonl").read_text().splitlines()]
for item in rows:
    if "excluded" in item: continue
    good,bad=[c["lines"] for c in item["choices"]]
    if not good or not bad or len(bad)<2: continue
    good0,bad0=good[0],bad[0]
    loss=bad0["cp"]-good0["cp"] if good0["cp"] is not None and bad0["cp"] is not None else None
    if loss is None: continue
    matches=[]
    for target, occupancies in bad0["posts"].items():
        if not occupancies: continue
        for _,group in itertools.groupby(enumerate(occupancies),lambda x:x[1]["ply"]-x[0]):
            subset=[f for _,f in group]
            if len(subset)<4 or subset[0]["ply"]>12:continue
            start, finish=subset[0]["ply"],subset[-1]["ply"]
            if target in good0["posts"] and good0["posts"][target][0]["ply"]<=finish:continue
            if all(f["legalCapture"] for f in subset if f["ply"]%2==0):continue
            matches.append((target, start, finish, subset[0]["guard"], subset[0]["role"],
                           len(bad[1]["posts"].get(target,[])),len(good[1]["posts"].get(target,[]))))
    if not matches:continue
    print(item["id"],item["phase"],item["event"],item["site"],item["fen"],item["pairLoss"],loss,matches)
    for b in (good[0],good[1],bad[0],bad[1]):
        print(b["cp"],b["mate"]," ".join(m["san"] for m in b["variation"][:14]),b["material"][:14])
print("Summary",len(rows),Counter(r.get("excluded","analysis") for r in rows))
