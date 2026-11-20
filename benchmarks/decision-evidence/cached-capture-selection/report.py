"""Score exact recorded questions and send alternate nominations for blind engine review."""

import argparse
from collections import Counter
from pathlib import Path
import sys

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defender-capture-order"))
from freeze import read, write
from summary import key, san


ARMS = ("principal", "cached", "agreement", "generated")


def attempt(row, arm):
    return row.get("attempt") if arm == "principal" else row["selections"][arm]


def alternatives(app, original):
    keys = {(row["id"], key(row["candidate"])) for row in original}
    selected = []
    for row in app:
        for arm in ARMS:
            if (proposed := attempt(row, arm)) and proposed["label"] == "guard-causal":
                candidate = proposed["proposal"]
                identity = (row["id"], key(candidate))
                if identity not in keys:
                    keys.add(identity)
                    selected.append({name: row[name] for name in ("id", "fen", "site", "group", "history", "recorded", "category")}
                                    | {"candidate": candidate})
    return selected


def measure(app, originals, alternatives):
    index = {row["id"]: row for row in originals}
    labels = {(row["id"], key(row["candidate"])): row for row in [*originals, *alternatives]}
    metrics = {arm: Counter() for arm in ARMS}
    per_game = []
    for row in app:
        recorded = index.get(row["id"])
        decisions = {}
        for arm in ARMS:
            stats = metrics[arm]
            chosen = attempt(row, arm)
            if chosen:
                stats["optionalSearches"] += 1
                stats["optionalNodes"] += max((line["nodes"] for line in chosen["lines"]), default=0)
                if row["category"] == "ordinary":
                    stats["ordinarySearches"] += 1
            positive = bool(chosen and chosen["label"] == "guard-causal")
            exact = bool(positive and recorded and chosen["proposal"] == recorded["candidate"])
            if recorded and recorded["label"] == "positive":
                stats["truePositive" if exact else "falseNegative"] += 1
            if recorded and recorded["label"] == "order-harmless":
                stats["falsePositive" if exact else "trueNegative"] += 1
            status = None
            deeper = None
            if positive:
                deeper = labels[row["id"], key(chosen["proposal"])]
                status = deeper["label"]
                stats["definiteCalls" if status == "positive" else
                      "falseCalls" if status == "order-harmless" else "indeterminateCalls"] += 1
            if chosen:
                decisions[arm] = dict(
                    proposal=chosen["proposal"], shallow=chosen["label"], deep=status,
                    lines=san(row, chosen), deeper=san(row, deeper) if deeper else None)
        per_game.append(dict(id=row["id"], group=row["group"], site=row["site"], category=row["category"],
            recorded=recorded["label"] if recorded else None, candidateCount=len(row["pool"]), decisions=decisions))
    return dict(metrics={arm: dict(score) for arm, score in metrics.items()},
        reference=dict(Counter(x["label"] for x in originals)), options=dict(Counter(len(x["pool"]) for x in app)),
        rows=per_game)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    alt = sub.add_parser("review-questions")
    report = sub.add_parser("report")
    for cmd in (alt, report):
        for name in ("frames", "reference", "output"):
            cmd.add_argument(name, type=Path)
    report.add_argument("extra", type=Path)
    args = parser.parse_args()
    frames, reference = read(args.frames), read(args.reference)
    result = (alternatives(frames, reference) if args.mode == "review-questions"
              else measure(frames, reference, read(args.extra)))
    write(args.output, result)
    print(result["metrics"] if args.mode == "report" else len(result))
