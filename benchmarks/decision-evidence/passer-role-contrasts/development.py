"""Read known review labels only after generating legal plan witnesses."""

import argparse
from collections import Counter
from pathlib import Path

from pawn_plans import compare
from freeze import read, write


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("frames", "reference", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    refs = {row["id"]: row for row in read(args.reference)["cases"]}
    outcomes = []
    for row in read(args.frames):
        result = compare(row)
        gold = refs[row["id"]]
        exact = result["moves"].get(gold["move"]["uci"])
        outcomes.append(dict(result, id=row["id"], site=row["site"],
            positional=gold["position"]["positional"], tactical=gold["position"]["tactical"],
            exactPositional=gold["move"]["positional"], exactTactical=gold["move"]["tactical"], exact=bool(exact)))
    write(args.output, outcomes)
    print("position", Counter(row["positional"] for row in outcomes if row["position"]))
    print("exact", Counter(row["exactPositional"] for row in outcomes if row["exact"]))
    for row in outcomes:
        if row["position"] or row["exact"]:
            proof = row["position"] or next(iter(row["moves"].values()))
            print(row["id"], proof["pawn"], [(x["move"], x["rootAction"], x["role"]) for x in proof["branches"]],
                  row["positional"], row["tactical"], row["exact"])
