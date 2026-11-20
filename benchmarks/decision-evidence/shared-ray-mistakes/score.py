"""Summarise the frozen hypotheses only after the blind reference is sealed."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from freeze import load_index
from ray_review import preview


def measure(sealed, predicts):
    correct = Counter()
    for identity, reference in sealed.items():
        observed = identity in predicts
        expected = reference["verdict"]
        if expected == "uncertain":
            correct["uncertainCalls" if observed else "uncertainAbstentions"] += 1
        elif expected == "positive":
            correct["truePositive" if observed else "falseNegative"] += 1
        elif expected == "negative":
            correct["falsePositive" if observed else "trueNegative"] += 1
        else:
            raise ValueError(f"Unknown reference: {expected}")
    correct["outsideReview"] = len(predicts - sealed.keys())
    return dict(correct)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("frames", type=Path, nargs="+")
    args = parser.parse_args()
    rows = [row for path in args.frames for row in load_index(path)]
    reference = load_index(args.reference)
    sealed = {row["id"]: row for row in reference["labels"]}
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows) or not sealed.keys() <= by_id.keys():
        raise ValueError("Reference or benchmark IDs do not match.")
    cases = [case for row in rows if (case := preview(row))]
    baseline = {row["id"]: row["report"] for row in load_index(args.baseline)}
    if set(baseline) != set(by_id):
        raise ValueError("Baseline did not cover the complete frame set.")
    nominations = {
        "geometry": {case["id"] for case in cases},
        **{key: {case["id"] for case in cases if case[key]}
           for key in ("oneLine", "twoSearches", "localExchange", "witnesses")},
    }
    result = dict(
        referenceSha256=sha256(args.reference.read_bytes()).hexdigest(),
        inputs=[dict(path=path.name, sha256=sha256(path.read_bytes()).hexdigest()) for path in args.frames],
        rows=len(rows), groups=len({row["group"] for row in rows}),
        reviewed=dict(Counter(case["verdict"] for case in sealed.values())),
        metrics={method: measure(sealed, ids) for method, ids in nominations.items()},
        spentProbeNodes=sum(
            row["sharedReply"]["line"]["nodes"] for row in rows if row.get("sharedReply") and
            not any(row["sharedReply"]["line"] == line for probe in row["replyProbes"] for line in probe["lines"])
        ),
        baseline={
            identity: {
                "status": (report or {}).get("mistakeStatus"),
                "category": mistake.get("category"),
                "tactical": mistake.get("tactical", {}).get("reasons", []),
            }
            for identity, report in baseline.items() if identity in sealed or identity in nominations["geometry"]
            for mistake in [(report or {}).get("mistake") or {}]
        },
        cases=cases,
    )
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
