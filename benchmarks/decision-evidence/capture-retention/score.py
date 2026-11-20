"""Score capture-settlement experiments on matched reports."""

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median
import sys


def load(path):
    return json.loads(path.read_bytes())


def index(path):
    rows = load(path)
    table = {row["id"]: row for row in rows}
    if len(table) != len(rows):
        raise ValueError(f"Duplicate IDs in {path}")
    return table


def compare_reports(before, after):
    if before.keys() != after.keys():
        raise ValueError("Report sets use different IDs")
    changed = {}
    for key in before:
        left, right = before[key]["report"], after[key]["report"]
        if left is None or right is None:
            if left != right:
                raise ValueError(f"Report availability changed for {key}")
            continue
        for scope in ("position", "moves", "mistakeStatus"):
            if left[scope] != right[scope]:
                raise ValueError(f"{scope} report changed for {key}")
        if left["mistake"] != right["mistake"]:
            old, new = left["mistake"], right["mistake"]
            changed[key] = {
                "before": old["category"],
                "after": new["category"],
                "previousTacticalReasons": old["tactical"]["reasons"],
                "tacticalReasons": new["tactical"]["reasons"],
                "positionalEvidenceChanged": old["positional"] != new["positional"],
            }
    times = {
        name: round(median(row["ms"] for row in rows.values() if row["report"]), 2)
        for name, rows in (("before", before), ("after", after))
    }
    return {"requests": len(before), "changed": changed, "medianWorkerMs": times}


def compare_routes(before, after):
    if before.keys() != after.keys():
        raise ValueError("Route sets use different IDs")
    actions = Counter()
    changed = {}
    for key in before:
        old, new = before[key]["verdict"], after[key]["verdict"]
        if old != new:
            change = "added" if old is None else "removed" if new is None else "edited"
            actions[change] += 1
            changed[key] = [v["explanation"] if v else None for v in (old, new)]
    return {"requests": len(before), "changeCounts": actions, "changedReasons": changed}


def main(lab, prior, output):
    base = index(lab / "capture-retention-base.json")
    routes = index(lab / "capture-archive-base.json")
    old = index(prior / "alternate-capture-payoff/archive-product.json")
    receipt = {
        "baseline": "d7634bb9",
        "candidate": "Decision Evidence v50",
        "replays": {
            arm: compare_reports(base, index(lab / f"capture-retention-{arm}.json"))
            for arm in ("late", "tracked", "product")
        },
        "archiveWorker": compare_reports(old, index(lab / "archival-product-product.json")),
        "archiveRouteExperiment": {
            arm: compare_routes(routes, index(lab / f"capture-archive-{arm}.json"))
            for arm in ("late", "tracked", "product")
        },
        "inputSha256": {
            name: sha256(path.read_bytes()).hexdigest() for name, path in {
                "worker": lab / "capture-retention-input.json",
                "comparisons": prior / "allowed-route-mistakes/inputs.json",
                "archive": prior / "reply-coverage-audit/full-pair-input.json",
                "deeperControls": lab / "existing-captures-deeper.json",
            }.items()
        },
    }
    with output.open("x", encoding="utf-8") as fh:
        json.dump(receipt, fh, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main(*(Path(arg) for arg in sys.argv[1:]))
