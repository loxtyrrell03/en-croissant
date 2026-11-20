"""Score the same reviewed moves before and after optional engine checks."""

import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import median


def read(path):
    return json.loads(path.read_bytes())


def mistake(report):
    return (report or {}).get("mistake") or {}


def score(report, label):
    category = report.get("category")
    outcomes = {
        "tactical": (report.get("tactical") or {}).get("support") == "supported",
        "positional": (report.get("positional") or {}).get("support") == "supported",
        "mixed": category == "mixed",
    }
    tactical, positional = label["tactical"], label["positional"]
    mixed = False if tactical is False or positional is False else (
        True if tactical is True and positional is True else None
    )
    for axis, expected in (("tactical", tactical), ("positional", positional), ("mixed", mixed)):
        actual = outcomes[axis]
        yield axis, (("uncertain-called" if actual else "uncertain")
                     if expected is None else
                     ("tp" if actual else "fn") if expected else ("fp" if actual else "tn"))


def summarize(manifest, reference, candidate):
    original = {row["id"]: row for row in reference}
    inputs = {row["id"]: row["input"] for row in manifest["rows"]}
    assert original.keys() == inputs.keys() == {row["id"] for row in candidate}
    classifications = Counter()
    verdict_drift = Counter()
    nominated = Counter()
    diffs = []
    for row in candidate:
        case_id = row["id"]
        before = original[case_id]["initial"]
        initial = row["initial"]
        final = row.get("final", initial)
        assert bool(before) == bool(initial)
        if not before:
            continue
        for scope in ("position", "moves"):
            if initial[scope] != before[scope]:
                verdict_drift[scope] += 1
            if final[scope] != before[scope]:
                verdict_drift[f"final-{scope}"] += 1
        baseline_mistake = mistake(before)
        ordinary_mistake = mistake(initial).copy()
        if ordinary_mistake.pop("checkingDefenceRequest", None):
            nominated[row.get("cohort", "repeated-input")] += 1
        if ordinary_mistake != baseline_mistake:
            verdict_drift["mistake"] += 1
        new_mistake = mistake(final)
        if new_mistake.get("category") != baseline_mistake.get("category"):
            diffs.append(dict(
                id=case_id, cohort=row.get("cohort"),
                before=baseline_mistake.get("category"), after=new_mistake.get("category"),
                defence=new_mistake["tacticalEpisode"]["explanation"],
                positional=(new_mistake.get("passedAdvance") or {}).get("factor", {}).get("description"),
            ))
        label = inputs[case_id].get("label")
        if label and label.get("scope") == "mistake-mechanism" and "#" not in case_id:
            for version, report in (("v40", baseline_mistake), ("v41", new_mistake)):
                for axis, metric in score(report, label):
                    classifications[version, axis, metric] += 1
    reports = {}
    for version in ("v40", "v41"):
        reports[version] = {axis: {
            measure: classifications[version, axis, measure]
            for measure in ("tp", "fp", "fn", "tn", "uncertain", "uncertain-called")
        } for axis in ("tactical", "positional", "mixed")}
    return dict(
        sources=manifest["sources"],
        requests=len(candidate),
        valid=sum(bool(row["initial"]) for row in candidate),
        unexpectedVerdictChanges=dict(verdict_drift),
        searchRequests=dict(nominated),
        reviewedMistakes=reports,
        verdictChanges=diffs,
        workerMedianMs={
            version: round(median(row["initialMs"] for row in rows if row["initial"]), 2)
            for version, rows in (("v40", reference), ("v41", candidate))
        },
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "base", "candidate", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    results = summarize(read(args.manifest), read(args.base), read(args.candidate))
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(results, file, indent=2)
        file.write("\n")


if __name__ == "__main__":
    main()
