"""Keep only changed reports and compare their cited pawn with the blind reference."""

import argparse
from collections import Counter
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defender-capture-order"))
from freeze import read, write


def compare(run, frames, truth):
    cases = {row["id"]: row for row in frames}
    labels = {row["id"]: row for row in truth["cases"]}
    changes = [row for row in run if row.get("position") or row["moves"]]
    counts = {key: Counter() for key in ("position","move")}
    unknown = Counter()

    def note(row, scope, plan):
        pawn = re.search(r"passed pawn on ([a-h][1-8])", plan["description"])[1]
        label = labels.get(row["id"], {}).get(scope if scope == "position" else "move")
        if label is None:
            unknown[scope] += 1
        elif pawn in label:
            counts[scope]["agreesWithBlindReview"] += 1
        else:
            counts[scope]["contradictsBlindReview"] += 1

    for row in changes:
        if row.get("position"):
            note(row,"position",row["position"])
        top = cases[row["id"]]["candidates"][0]["pvUci"][0]
        for move in row["moves"]:
            if move["moveUci"] == top:
                note(row,"move",move["sharedPassedPawn"])
            else:
                counts["move"]["otherExactChoice"] += 1
        row["site"] = cases[row["id"]]["site"]
    return dict(positions=len(run), positionChanges=sum(bool(row.get("position")) for row in changes),
        moveChanges=sum(len(row["moves"]) for row in changes), blind=dict(counts), undetermined=unknown,
        changes=changes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "replay", "truth", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    report = compare(read(args.replay), read(args.app), read(args.truth))
    write(args.output, report)
    print({k:v for k,v in report.items() if k!="changes"})
