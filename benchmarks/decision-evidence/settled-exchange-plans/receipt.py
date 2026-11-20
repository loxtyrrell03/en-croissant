"""Validate the complete worker comparison and record independent repeats."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from examine import SOURCES


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(value, out, indent=2)
        out.write("\n")


def prepare(lab, run):
    sources = [(relative, lab / relative) for relative in SOURCES] + [("fresh", run / "fresh-scored.json")]
    rows = [dict(row, cohort=cohort) for cohort, path in sources for row in read(path)]
    write(run / "base-input.json", rows)


def identity(effect):
    return effect["move"], effect["asset"], effect["paired"]["actor"]


def corroborated(screen, recheck):
    expected = {r["id"]: {identity(effect) for effect in r["effects"] if effect["linked"]}
                for group in screen.values() for r in group["cases"]}
    result = {}
    for case in recheck["cases"]:
        confirmed = {identity(effect) for effect in case["confirmation"] if effect["linked"]}
        match = expected[case["id"]] & confirmed
        result[case["id"]] = {move for move, _, _ in match}
    return result


def comparison(run):
    active = ("archive-v2", "fresh-output", "archive-deep", "fresh-deep", "full-baseline", "full-product")
    archive, fresh, archive_deep, fresh_deep, baseline, product = [
        read(run / f"{key}.json") for key in active
    ]
    robust = corroborated(archive, archive_deep) | corroborated(fresh, fresh_deep)
    assert len(baseline) == len(product)
    after_counts = {}
    changes = []
    for left, right in zip(baseline, product, strict=True):
        assert left["id"] == right["id"] and left["cohort"] == right["cohort"] and left["plans"] == right["plans"]
        category = "fresh" if right["cohort"] == "fresh" else "cached"
        summary = after_counts.setdefault(category, Counter())
        summary["requests"] += 1
        before, after = left.get("report"), right.get("report")
        if before is None or after is None:
            assert before is after
            continue
        summary["validReports"] += 1
        assert before["position"] == after["position"]
        assert before["mistakeStatus"] == after["mistakeStatus"] and before["mistake"] == after["mistake"]
        for a, b in zip(before["moves"], after["moves"], strict=True):
            if a == b:
                continue
            assert a["moveUci"] == b["moveUci"]
            assert a["tactical"] == b["tactical"] and b["settledExchangePlan"]["linesUci"]
            assert b["positional"]["support"] == "supported" and a["positional"]["support"] != "supported"
            summary["newMoveExplanations"] += 1
            summary[f"{a['category']}To{b['category'].title()}"] += 1
            stable = b["moveUci"] in robust.get(right["id"], set())
            summary["newMoveExplanationsRepeated"] += stable
            changes.append({"id": right["id"], "cohort": right["cohort"], "move": b["moveUci"],
                            "old": a["category"], "new": b["category"], "samePlanAtHigherBudget": stable})
    normal_a, normal_b = [read(run / f"live-{key}.json") for key in ("base", "product")]
    assert normal_a["searches"] == normal_b["searches"] and normal_a["input"] == normal_b["input"]
    analysis = {
        "baseline": "a779f152", "stockfishSha256": fresh_deep["engineSha256"],
        "cached": {key: {k: v for k, v in value.items() if k != "cases"} for key, value in archive.items()},
        "fresh": next({k: v for k, v in row.items() if k != "cases"} for row in fresh.values()),
        "freshSampleSha256": sha256((run / "fresh.json").read_bytes()).hexdigest(),
        "freshExclusions": read(run / "exclusions.json"),
        "reports": after_counts, "changes": changes,
        "live": {"baseline": normal_a["category"], "product": normal_b["category"],
                 "queries": normal_b["searches"], "plan": normal_b["plan"]},
    }
    return analysis


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("operation", choices=("prepare", "compare"))
    for key in ("lab", "run"):
        cli.add_argument(key, type=Path)
    cli.add_argument("--output", type=Path)
    args = cli.parse_args()
    if args.operation == "prepare":
        prepare(args.lab, args.run)
    else:
        write(args.output, comparison(args.run))


if __name__ == "__main__":
    main()
