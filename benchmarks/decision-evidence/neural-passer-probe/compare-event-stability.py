"""Compare the frozen equal-budget review queues by event family."""

import json
from pathlib import Path


BENCHMARKS = Path(__file__).resolve().parent.parent


def read(path):
    return json.loads((BENCHMARKS / path).read_text(encoding="utf-8"))


def compare(neural, simpler, positive, negative, slots):
    paired = {}
    assert neural["events"].keys() == simpler["events"].keys()
    for event in neural["events"]:
        a, b = neural["events"][event], simpler["events"][event]
        assert a[slots] == b[slots]
        paired[event] = {
            "slots": a[slots],
            "positives": a[positive] - b[positive],
            "negatives": a[negative] - b[negative],
        }
    total = sum(row["positives"] for row in paired.values())
    left_out = [total - row["positives"] for row in paired.values()]
    return {
        "neuralMinusSimple": total,
        "leaveOneEventOutRange": [min(left_out), max(left_out)],
        "improvedEvents": sum(row["positives"] > 0 for row in paired.values()),
        "worsenedEvents": sum(row["positives"] < 0 for row in paired.values()),
        "paired": paired,
    }


def confirmed(arm, review):
    confirmed_assets = {
        (row["case"], row["branch"], row["square"])
        for row in review if row["strongerTarget"] is True
    }
    nominated = {
        (row["case"], row["branch"], row["pawn"])
        for row in arm["nominations"]
    }
    return len(confirmed_assets & nominated)


def main():
    passer = read("neural-passer-probe/results.json")["transfer"]
    audit = read("neural-passer-probe/audit.json")
    recurrent = read("neural-deep-witness/results.json")
    results = {}
    for cohort, recheck in [("ordinary", "test"), ("enriched", "reserve")]:
        arms = passer[cohort]["arms"]
        neural = arms["line + localized Leela"]
        results[f"localized Leela, {cohort}"] = {}
        for label in ["line logistic", "static logistic", "shallow advance count"]:
            simple = arms[label]
            comparison = compare(neural, simple, "positive", "negative", "assets")
            comparison["deeperConfirmedNeural"] = confirmed(neural, audit[recheck])
            comparison["deeperConfirmedSimple"] = confirmed(simple, audit[recheck])
            results[f"localized Leela, {cohort}"][label] = comparison
        arms = recurrent[cohort]["results"]
        results[f"recurrent, {cohort}"] = compare(
            arms["branch-neural"], arms["score-logistic"], "witness", "negative", "slots"
        )
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
