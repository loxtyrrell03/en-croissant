"""Summarise matched worker replays, keeping private reports out of the receipt."""

from collections import Counter
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import statistics
import sys


def read(path):
    return json.loads(path.read_bytes())


def indexed(path):
    rows = read(path)
    table = {row["id"]: row for row in rows}
    if len(table) != len(rows):
        raise ValueError(f"Repeated IDs in {path}")
    return table


def compare(before, after, public=False):
    if before.keys() != after.keys():
        raise ValueError("Unmatched input IDs")
    categories = Counter()
    changes = Counter()
    effects = {}
    for key, row in before.items():
        old, new = row["report"], after[key]["report"]
        if old is None or new is None:
            if old != new:
                raise ValueError(f"Usable-report mismatch for {key}")
            continue
        for field in ("position", "moves", "mistake", "mistakeStatus"):
            changes[field] += old.get(field) != new.get(field)
        if old["position"]["category"] != new["position"]["category"]:
            categories[f'position: {old["position"]["category"]} -> {new["position"]["category"]}'] += 1
        for previous, current in zip(old["moves"], new["moves"], strict=True):
            if previous["moveUci"] != current["moveUci"]:
                raise ValueError(f"Unmatched candidate move for {key}")
            if previous["category"] != current["category"]:
                categories[f'move: {previous["category"]} -> {current["category"]}'] += 1
            if public and previous != current:
                effects.setdefault(key, []).append({
                    "move": current["moveUci"],
                    "before": previous["category"],
                    "after": current["category"],
                    "addedNotes": [note for note in current["limitations"] if note not in previous["limitations"]],
                })
    return {
        "requests": len(before),
        "valid": sum(row["report"] is not None for row in before.values()),
        "changedReportsByScope": changes,
        "categoryTransitions": categories,
        "medianWorkerMs": {
            label: round(statistics.median(row["ms"] for row in rows.values() if row["report"] is not None), 2)
            for label, rows in (("before", before), ("after", after))
        },
        **({"changedMoves": effects} if public else {}),
    }


def early_metrics(root, audit, arm):
    path = Path("scripts/benchmarks/decision-evidence-evaluate.py")
    spec = importlib.util.spec_from_file_location("early_evaluation", path)
    evaluator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    reports = indexed(audit / f"early-{arm}.json")
    result = {}
    for name in ("course", "independent", "classical"):
        reference = read(root / f"{name}-reference-v13heldout.json")
        inputs = read(root / f"{name}-candidate-v13heldout.json")
        for row in inputs["results"]:
            report = reports[row["id"]]
            row.update(assessment=report["report"], milliseconds=report["ms"])
        result[name] = {
            question: {
                axis: {key: values["candidate"][axis][key] for key in ("tp", "fp", "fn", "tn")}
                for axis in ("tactical", "positional", "mixed")
            }
            for question, values in evaluator.evaluate(reference, inputs)["questions"].items()
        }
    return result


def main(lab, audit, historical, output):
    trials = {}
    for name in ("heldout", "reserve", "fresh-final", "deeper"):
        stem = lab / name
        arms = ("product",) if name == "deeper" else ("geometry", "material", "product")
        base = indexed(stem.with_name(f"{name}-base.json"))
        scores = {
            arm: compare(base, indexed(stem.with_name(f"{name}-{arm}.json")),
                         public=arm == "product" and name in ("fresh-final", "deeper"))
            for arm in arms
        }
        manifest_name = "deeper-input" if name == "deeper" else name
        manifest = read(lab / f"{manifest_name}.json")
        if {row["id"] for row in manifest} != base.keys():
            raise ValueError(f"Sample and replay inputs differ for {name}")
        trials[name] = {
            "ids": [row["id"] for row in manifest],
            "matchedInputSha256": sha256((lab / f"{name}-scored.json").read_bytes()).hexdigest(),
            "selectionCounts": Counter(row["selection"] for row in manifest),
            "arms": scores,
        }
    controls = {
        name: compare(indexed(audit / f"{name}-v47.json"), indexed(audit / f"{name}-product.json"))
        for name in ("archive", "prospective", "early")
    }
    for name, scores in controls.items():
        if scores["changedReportsByScope"]["mistake"] or scores["changedReportsByScope"]["mistakeStatus"]:
            raise ValueError(f"Unexpected mistake change in {name}")
    result = {
        "before": "ae4bf1fc (Decision Evidence v47)",
        "after": "Decision Evidence v48",
        "puzzleReplays": trials,
        "otherReplays": controls,
        "earlierReview": {arm: early_metrics(historical, audit, arm) for arm in ("v47", "product")},
    }
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main(*(Path(arg) for arg in sys.argv[1:]))
