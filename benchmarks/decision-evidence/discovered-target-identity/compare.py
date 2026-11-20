from collections import Counter
from hashlib import sha256
from pathlib import Path
import argparse
import json
from statistics import median


def align(a, b):
    if [item["id"] for item in a] != [item["id"] for item in b]:
        raise ValueError("The reports did not replay matched inputs")
    return zip(a, b, strict=True)


def witness_id(row):
    return row["fen"], row["at"], tuple(row["line"][:row["capture"]])


def compact(report, scope):
    if not report or not report.get(scope):
        return None
    assessment = report[scope]
    return tuple([assessment["category"], assessment["tactical"]["support"],
                  assessment["positional"]["support"]])


def compare(root, name):
    def get(kind):
        return json.loads((root/(name+"-"+kind+".json")).read_bytes())

    a,b = map(get, ("before", "final"))
    for row in a + b:
        if row["report"]:
            row["report"].pop("version", None)
    x,y = (get("audit-"+stage) for stage in ("before", "final"))
    old, new = {witness_id(row):row for row in x}, {witness_id(row):row for row in y}
    changes = {}
    for scope in ("position","mistake"):
        changes[scope] = [dict(id=left["id"], before=compact(left["report"],scope),
                               after=compact(right["report"],scope))
                          for left,right in align(a,b)
                          if compact(left["report"],scope) != compact(right["report"],scope)]
    unequal = [(left["id"],left["report"],right["report"]) for left,right in align(a,b)
               if left["report"] != right["report"]]
    validity = {
        "received": len(a),
        "classified": sum(bool(row["report"]) for row in b),
        "old": dict(Counter(row["issue"] for row in x)),
        "new": dict(Counter(row["issue"] for row in y)),
        "added": dict(Counter((row["capture"]-row["at"]) for key,row in new.items() if key not in old)),
        "removedIntact": sum(row["issue"]=="intact" for key,row in old.items() if key not in new),
        "reportChanges": len(unequal),
        "scopeChanges": {key:len(value) for key,value in changes.items()},
        "decisionMedianMs": [round(median(row["duration"] for row in collection),3) for collection in (a,b)],
        "inputsSha256": sha256((root/(name+".json")).read_bytes()).hexdigest(),
    }
    if name == "puzzles":
        groups = {
            row["id"]:row["cohort"] for row in json.loads((root/"puzzles.json").read_bytes())
        }
        validity["puzzlesWithAnyDiscovery"] = {
            stage: dict(Counter(groups[row["id"]] for row in rows if row["discoveries"]))
            for stage, rows in (("before", a), ("after", b))
        }
    for key, rows in (("removed", [old[k] for k in old.keys()-new.keys()]),
                      ("added", [new[k] for k in new.keys()-old.keys()]),
                      ("changed-categories", changes), ("changed-full", unequal)):
        (root/(name+"-"+key+".json")).write_text(json.dumps(rows,indent=2),encoding="utf-8")
    return validity


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compare the source and candidate replay.")
    parser.add_argument("directory",type=Path)
    parser.add_argument("cohorts",nargs="+")
    args = parser.parse_args()
    output = {name:compare(args.directory,name) for name in args.cohorts}
    print(json.dumps(output,indent=2))
