"""Score the position axes, preserving unknown labels as their own counts."""
import argparse
import json
from pathlib import Path
import statistics

METHODS = ("baseline", "geometry", "active", "confirmed", "contrast")
AXES = ("tactical", "positional", "mixed")
COUNTS = (
    ("truePositive", True, True), ("falsePositive", False, True),
    ("falseNegative", True, False), ("trueNegative", False, False),
    ("uncertainCalled", None, True), ("uncertainAbstained", None, False),
)


def joint(tactical, positional):
    if tactical is False or positional is False:
        return False
    if tactical is None or positional is None:
        return None
    return True


def score(rows, method):
    pairs = {axis: [] for axis in AXES}
    for row in rows:
        label, baseline = row["label"], row["baseline"]
        tactical = baseline["tactical"]["support"] == "supported"
        positional = baseline["positional"]["support"] == "supported"
        if method != "baseline":
            positional = positional or row["candidate"][method] is not None
        pairs["tactical"].append((label["tactical"], tactical))
        pairs["positional"].append((label["positional"], positional))
        pairs["mixed"].append((joint(label["tactical"], label["positional"]), tactical and positional))
    return {axis: {key: pairs[axis].count((expected, predicted)) for key, expected, predicted in COUNTS}
            for axis in AXES}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("runs", type=Path, nargs="+")
    args = parser.parse_args()
    compared = {}
    for run in args.runs:
        rows = json.loads(run.read_bytes())
        compared[run.stem] = {
            "positions": len(rows),
            "candidateMedianMs": statistics.median(row["milliseconds"] for row in rows),
            "engineNodesAdded": 0,
            "methods": {method: score(rows, method) for method in METHODS},
        }
    with args.output.open("x", encoding="utf8", newline="\n") as output:
        json.dump(compared, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
