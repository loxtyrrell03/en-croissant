"""Score the open-line mechanism and compare matching complete decision reports."""
import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import median

HERE = Path(__file__).resolve().parent


def load(path):
    return json.loads(path.read_bytes())


def checked_index(rows):
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        raise ValueError("Duplicate identifiers in replay")
    return by_id


def motif_score(reference, predictions):
    count = Counter()
    for case, verdict in reference.items():
        status = verdict["status"]
        if status in ("excluded", "uncertain"):
            count[status] += 1
            if case in predictions:
                count[status + "Nominated"] += 1
        elif status == "yes":
            count["tp" if case in predictions else "fn"] += 1
        elif status == "no":
            count["fp" if case in predictions else "tn"] += 1
        else:
            raise ValueError(f"Unknown reference verdict {status}")
    keys = ("tp", "fp", "fn", "tn", "uncertain", "excluded", "uncertainNominated", "excludedNominated")
    return {key: count[key] for key in keys}


def is_tactical(report):
    mistake = (report or {}).get("mistake") or {}
    return mistake.get("tactical", {}).get("support") == "supported"


def compare(before, after):
    unaffected = ("fen", "position", "moves", "mistakeStatus")
    changes = []
    for case, old in before.items():
        before_report, after_report = old["report"], after[case]["report"]
        if (before_report is None) != (after_report is None):
            raise ValueError(f"Report availability changed for {case}")
        if before_report is None:
            continue
        if any(before_report[section] != after_report[section] for section in unaffected):
            raise ValueError(f"Comparison changed a different report scope for {case}")
        old_mistake, new_mistake = before_report.get("mistake"), after_report.get("mistake")
        if old_mistake == new_mistake:
            continue
        if not old_mistake or not new_mistake:
            raise ValueError(f"Mistake availability changed for {case}")
        if old_mistake["evaluationLossCp"] != new_mistake["evaluationLossCp"]:
            raise ValueError(f"Evaluation changed for {case}")
        if old_mistake["positional"] != new_mistake["positional"]:
            raise ValueError(f"Positional evidence changed for {case}")
        if is_tactical(before_report) or not is_tactical(after_report):
            raise ValueError(f"An established tactical verdict was changed for {case}")
        changes.append(case)
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--reference", type=Path, default=HERE / "reference.json")
    options = parser.parse_args()
    before = checked_index(load(options.before))
    after = checked_index(load(options.after))
    reference = checked_index(load(options.reference))
    if before.keys() != after.keys() or not reference.keys() <= before.keys():
        raise ValueError("Mismatched cases")
    changes = compare(before, after)
    out = {
        "cases": len(before),
        "stationary": motif_score(reference, {
            key for key, row in after.items() if (row.get("arms") or {}).get("stationary")
        }),
        "tracked": motif_score(reference, {
            key for key, row in after.items() if (row.get("arms") or {}).get("tracked")
        }),
        "positiveReportsWithTacticalSupport": {
            "before": sum(
                row["status"] == "yes" and is_tactical(before[key]["report"])
                for key, row in reference.items()
            ),
            "after": sum(
                row["status"] == "yes" and is_tactical(after[key]["report"])
                for key, row in reference.items()
            ),
        },
        "newVerified": [
            key for key in changes if reference.get(key, {}).get("status") == "yes"
        ],
        "newContradictions": [
            key for key in changes if reference.get(key, {}).get("status") == "no"
        ],
        "changes": changes,
        "timingMs": {
            "before": round(median(row["ms"] for row in before.values()), 2),
            "after": round(median(row["ms"] for row in after.values()), 2),
        },
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
