"""Score structural explanations against matching game and reference IDs."""
import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import median


def index(path):
    rows = json.loads(Path(path).read_bytes())
    keyed = {row["id"]: row for row in rows}
    if len(keyed) != len(rows):
        raise ValueError("Duplicate case IDs")
    return keyed


def score(reference, guesses):
    count = Counter()
    for case, entry in reference.items():
        status = entry["status"]
        feature = guesses.get(case)
        if status == "yes":
            count["tp" if feature == entry["feature"] else "fn"] += 1
            if feature and feature != entry["feature"]:
                count["wrongFeature"] += 1
        elif status == "no":
            count["fp" if feature else "tn"] += 1
        else:
            count[status] += 1
            if feature:
                count[status + "Nominated"] += 1
    keys = ("tp", "fp", "fn", "tn", "wrongFeature", "uncertain", "excluded", "uncertainNominated", "excludedNominated")
    return {key: count[key] for key in keys}


def compare(before, after):
    if before.keys() != after.keys():
        raise ValueError("Inputs differ across report revisions")
    changed = {}
    for key, old in before.items():
        a, b = old["report"], after[key]["report"]
        if (a is None) != (b is None):
            raise ValueError(f"Report availability changed at {key}")
        if not a:
            continue
        if any(a[field] != b[field] for field in ("fen", "position", "moves", "mistakeStatus")):
            raise ValueError(f"Changed unrelated scope for {key}")
        m1, m2 = a["mistake"], b["mistake"]
        if m1 == m2:
            continue
        if not m1 or not m2:
            raise ValueError(f"Mistake availability changed for {key}")
        owned = {"category", "positional", "positionalFactors", "strategicAsset"}
        if {k: v for k, v in m1.items() if k not in owned} != {k: v for k, v in m2.items() if k not in owned}:
            raise ValueError(f"Changed tactical or score evidence at {key}")
        if m1["positional"]["support"] == "supported" or m2["positional"]["support"] != "supported":
            raise ValueError(f"Changed a previously established diagnosis at {key}")
        changed[key] = {
            "before": m1["category"], "after": m2["category"],
            "feature": m2["strategicAsset"]["factor"]["feature"],
            "explanation": m2["positional"]["reasons"][0],
        }
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("arms", type=Path)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    reference, arms, before, after = [index(getattr(args, key)) for key in ("reference", "arms", "before", "after")]
    if not reference or not reference.keys() <= arms.keys() or not reference.keys() <= before.keys():
        raise ValueError("The reference has no matching replay rows")
    changed = compare(before, after)
    out = {
        "cases": len(reference),
        "repeated": score(reference, {key: row["repeated"]["factor"]["feature"] for key, row in arms.items() if row["repeated"]}),
        "linked": score(reference, {key: row["linked"]["factor"]["feature"] for key, row in arms.items() if row["linked"]}),
        "newWorkerReports": score(reference, {key: row["feature"] for key, row in changed.items()}),
        "changes": changed,
        "workerMedianMs": {"before": round(median(r["ms"] for r in before.values()), 3),
                           "after": round(median(r["ms"] for r in after.values()), 3)},
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
