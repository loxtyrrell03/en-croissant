"""Compare geometric, score-only, and two- or three-search proof variants."""
import json
from pathlib import Path
import sys
from collections import Counter

from review import compare,line,value,shared_consequence

def compact(row,require_consequence=True):
    first, second, *_ = [*row["good"]["lines"],None,None]
    worst = line(row["bad"])
    top,missing,blocked = [value(x) for x in (first,second,worst)]
    if (top is None or missing is None or blocked is None or
        first["pvUci"][0]!=row["resource"] or min(x["depth"] for x in (first,second,worst))<16 or
        abs(top-row["betterCp"])>120 or abs(blocked-row["playedCp"])>150 or
        first["depth"]!=second["depth"] or top-max(missing,blocked)<90):
        return None
    event=shared_consequence(first,worst,second)
    return dict(event=event,gain=[top-blocked,top-missing]) if event or not require_consequence else None

if __name__=="__main__":
    for file in map(Path,sys.argv[1:]):
        rows=[json.loads(ln) for ln in file.read_text().splitlines()[1:]]
        results=Counter()
        print(file.name,len(rows),flush=True)
        for row in rows:
            masks=[compare(row),compact(row,False),compact(row)]
            reports=[bool(masks[0]),bool(masks[0] and masks[0]["consequence"]),bool(masks[1]),bool(masks[2])]
            for k,c in zip(("three-scores","three-proof","two-scores","two-proof"),reports,strict=True):
                results[k]+=int(c)
            if any(reports):
                print(row["id"], "".join("Y" if flag else "." for flag in reports))
                if masks[0]:print("  ",masks[0])
                if masks[2]:print("  ",masks[2])
        print(dict(results))
