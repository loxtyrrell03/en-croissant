from collections import Counter,defaultdict
from pathlib import Path
from statistics import median
import json,sys

from defuses import paired_defence

def read(path):
    raw=Path(path).read_text(encoding="utf-8")
    return json.loads(raw) if raw.startswith("[") else [json.loads(x) for x in raw.splitlines()]

def index(path):
    rows=read(path)
    result={x["id"]:x for x in rows}
    if len(rows)!=len(result):
        raise ValueError("Duplicate rows")
    return result

frozen,worker,checked=(index(file) for file in sys.argv[1:4])
assert frozen.keys()==worker.keys()
assert checked.keys()<=frozen.keys()
scored=defaultdict(Counter)
changed=defaultdict(list)
time=defaultdict(list)
for id_,row in frozen.items():
    scope="puzzles" if row["event"]=="lichess-puzzles" else "classical"
    status=row["status"]
    report=(worker[id_]["report"] or {}).get("mistake")
    already=bool(report and report.get("tactical",{}).get("support")=="supported")
    review=checked.get(id_)
    proof=review and review.get("proof")
    verified=bool(proof and proof.get("proved"))
    defence=review and paired_defence(row["fen"],review["witness"])
    co={}
    for arm,signal in (
        ("repeated",bool(review)),("restricted",verified),
        ("cheapDefence",bool(defence)),("bothChoices",verified and bool(defence))
    ):
        count=scored[(scope,arm)]
        count[status]+=1
        if signal:
            count[status+"Detected"]+=1
            if report and not already:
                count[status+"NewTactical"]+=1
                changed[(scope,arm)].append([id_,status,report.get("category")])
            if not report:
                count[status+"WithoutMistakeReport"]+=1
        if proof and (arm=="restricted" or (arm=="bothChoices" and defence)):
            for f in ("capture","other"):
                if proof.get(f):
                    count["extraSearches"]+=1
                    count["extraNodes"]+=proof[f]["nodes"]
                    co[arm]=co.get(arm,0)+proof[f]["elapsedMs"]
    for arm,ms in co.items():
        time[(scope,arm)].append(ms)
    if already:
        scored[(scope,"incumbent")][status+"Tactical"]+=1

result={}
for key,counts in scored.items():
    scope,arm=key
    entry=dict(counts)
    if time[key]:
        entry["medianExtraTimeMs"]=round(median(time[key]),3)
    if changed[key]:
        entry["newTactical"]=changed[key]
    result.setdefault(scope,{})[arm]=entry
print(json.dumps(result,indent=2))
