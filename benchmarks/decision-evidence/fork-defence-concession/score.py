"""Score the exact reviewed fork-payment endpoint and the unchanged archive."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from statistics import median


def read(path):
    return json.loads(path.read_bytes())


def by_id(rows):
    keyed = {row["id"]: row for row in rows}
    if len(keyed) != len(rows):
        raise ValueError("Duplicate case identity")
    return keyed


def exact(row, move):
    report = row.get("report") or {}
    return next((entry for entry in report.get("moves", []) if entry["moveUci"] == move), {})


def payment(report):
    return bool((report.get("conditionalFork") or {}).get("defenceConsequence"))


def panel(references, baseline, *variants):
    reference = by_id(references["cases"])
    frames = [by_id(rows) for rows in (baseline, *variants)]
    if any(set(arm) != set(reference) for arm in frames):
        raise ValueError("Every arm must cover the same frame identities")
    results = []
    for arm in frames:
        observations = Counter()
        category_changes, verdict_changes, gains = [], [], []
        for key, row in reference.items():
            if arm[key]["move"] != row["moveUci"]:
                raise ValueError("Evaluated move differs from its review")
            old = exact(frames[0][key], row["moveUci"])
            new = exact(arm[key], row["moveUci"])
            observations[(row["forkPayment"], payment(new))] += 1
            if payment(new) and not payment(old):
                gains.append(dict(id=key, label=row["forkPayment"], proof=new["conditionalFork"]))
            if old.get("category") != new.get("category"):
                category_changes.append(dict(id=key, before=old.get("category"), after=new.get("category")))
            if old.get("tactical", {}).get("support") != new.get("tactical", {}).get("support"):
                verdict_changes.append(key)
        results.append(dict(
            positive=observations[(True, True)], missed=observations[(True, False)],
            falsePositive=observations[(False, True)], trueNegative=observations[(False, False)],
            uncertainReported=observations[(None, True)], uncertainUnreported=observations[(None, False)],
            moveCategoryChanges=category_changes, moveTacticalSupportChanges=verdict_changes,
            added=gains, medianReportMs=median(row["elapsedMs"] for row in arm.values()),
        ))
    return results


def archive(before, after):
    left, right = by_id(before), by_id(after)
    if set(left) != set(right):
        raise ValueError("Archive identity mismatch")
    changes = Counter()
    examples = []
    for key in left:
        old, new = left[key]["report"], right[key]["report"]
        if old is None or new is None:
            changes["nullBoth" if old == new else "nullChange"] += 1
            continue
        if {k: v for k, v in old.items() if k != "version"} == {k: v for k, v in new.items() if k != "version"}:
            changes["identical"] += 1
            continue
        changes["changed"] += 1
        for scope in ("position", "moves", "mistake", "mistakeStatus"):
            if old[scope] != new[scope]:
                changes[scope] += 1
        examples.append(key)
    return dict(requests=len(left), counts=dict(changes), changedIds=examples,
                baselineMedianMs=median(row.get("ms", row.get("elapsedMs", 0)) for row in before),
                releaseMedianMs=median(row["elapsedMs"] for row in after if "elapsedMs" in row))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("research", type=Path)
    parser.add_argument("archive_baseline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    load = lambda name: read(args.research / f"{name}.json")
    output = {}
    comparisons = {
        "pool": ["baseline", "immediate", "delayed", "retained"],
        "reserve": ["baseline", "retained", "release"],
    }
    for name, arms in comparisons.items():
        reference = load(f"{name}-reference")
        rows = [load(f"{name}-{arm}") for arm in arms]
        output[name] = dict(zip(arms, panel(reference, *rows), strict=True))
        output[name]["inputSha256"] = hashlib.sha256((args.research / f"{name}-deep.json").read_bytes()).hexdigest()
    output["archive"] = archive(read(args.archive_baseline), load("archive-release"))
    output["publicExample"] = load("public-example-retained")[0]["report"]["moves"][0]["conditionalFork"]
    output["extraEngineRequestsPerReport"] = 0
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(output, file, indent=2)


if __name__ == "__main__":
    main()
