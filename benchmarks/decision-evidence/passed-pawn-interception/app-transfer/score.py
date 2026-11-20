"""Compare matching decision worker reports and score the specific new diagnosis."""
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path
from statistics import median
import json

def index(path, lines=False):
    raw=Path(path).read_text(encoding="utf8")
    records=[json.loads(line) for line in raw.splitlines()] if lines else json.loads(raw)
    indexed={r["id"]:r for r in records}
    if len(indexed)!=len(records):
        raise ValueError(f"Duplicate IDs in {path}")
    return indexed

def compare(before,after,reference):
    if before.keys()!=after.keys() or not reference.keys()<=before.keys():
        raise ValueError("Mismatched replay IDs")
    changes=[]
    scopes=("fen","position","moves","mistakeStatus")
    allowed={"category","tactical","tacticalEpisode"}
    for id_,old in before.items():
        a=old["report"]; b=after[id_]["report"]
        if (a is None)!=(b is None):
            raise ValueError(f"Report availability changed at {id_}")
        if not a:continue
        if any(a[key]!=b[key] for key in scopes):
            raise ValueError(f"Position, candidate move or mistake eligibility changed at {id_}")
        a,b=a["mistake"],b["mistake"]
        if a==b:continue
        if (not a or not b or a["tactical"]["support"]=="supported"
            or b["tactical"]["support"]!="supported"
            or b.get("tacticalEpisode",{}).get("kind")!="forcing-attack"):
            raise ValueError(f"Overwrote an existing diagnosis at {id_}")
        if {k:v for k,v in a.items() if k not in allowed}!={k:v for k,v in b.items() if k not in allowed}:
            raise ValueError(f"Non-tactical facts changed at {id_}")
        changes.append(dict(id=id_,status=reference.get(id_,{}).get("status","unreviewed"),
                            before=a["category"],after=b["category"],evidence=b["tactical"]["reasons"]))
    return {
        "requests":len(before),
        "valid":sum(r["report"] is not None for r in before.values()),
        "reference":Counter(r["status"] for r in reference.values()),
        "changes":changes,
        "changed":Counter(c["status"] for c in changes),
        "workerMedianMs":{"before":round(median(r["ms"] for r in before.values()),3),
                          "after":round(median(r["ms"] for r in after.values()),3)},
    }

if __name__=="__main__":
    p=ArgumentParser(description=__doc__)
    p.add_argument("before")
    p.add_argument("after")
    p.add_argument("reference")
    a=p.parse_args()
    print(json.dumps(compare(index(a.before),index(a.after),index(a.reference,lines=True)),indent=2))
