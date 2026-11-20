"""Reduce retained raw runs into auditable timing and case receipts."""

import argparse
from collections import Counter
import json
from pathlib import Path

from experiment import ARMS, decision, digest

RUNS = (
    "archive", "reserve", "archive-6m", "reserve-6m", "holdout",
    "prospective", "remaining", "six-archive", "six-reserve", "six-reserve-6m",
    "wide-archive", "wide-reserve", "wide-archive-6m", "wide-prospective",
)

FIXTURES = (
    ("wide-archive-6m", "06d8488e5d433ad1"),
    ("archive-6m", "72bfacff5979bbb5"),
    ("reserve", "8717a9b3de261d55"),
    ("reserve-6m", "8717a9b3de261d55"),
    ("reserve", "d92503ccccdff208"),
    ("reserve-6m", "d92503ccccdff208"),
    ("reserve", "8367c04911a82dc9"),
    ("reserve-6m", "8367c04911a82dc9"),
    ("wide-prospective", "04c8ecd9689f6a16"),
)


def run_summary(source):
    raw = json.loads(source.read_bytes())
    cases = raw["cases"]
    arms = {arm: Counter() for arm in ARMS}
    outcome = {}
    for row in cases:
        scores = {arm: decision(row, arm) for arm in ARMS}
        for arm, status in scores.items():
            arms[arm][status] += 1
        outcome[row["id"]] = scores
    metadata = {key: raw[key] for key in ("engine", "nodes", "screened", "sources", "medianMs")}
    return dict(metadata, rawSha256=digest(source), targetRank=raw.get("targetRank", 7),
                horizon=raw.get("horizon", 16), nominations=len(cases), arms=arms, outcomes=outcome), cases


def write(output, data):
    with output.open("x", encoding="utf-8") as target:
        json.dump(data, target, indent=2)
        target.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_runs", type=Path)
    parser.add_argument("results", type=Path)
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("--cached-check", type=Path, nargs="*", default=[])
    args = parser.parse_args()
    summary = {}
    examples = []
    for run in RUNS:
        report, cases = run_summary(args.raw_runs / f"passer-mobility-{run}.json")
        summary[run] = report
        for label, game in FIXTURES:
            if label != run:
                continue
            row, = (case for case in cases if game in case["id"])
            example = dict(row)
            for name in ("testResults", "controlResults"):
                example[name] = [
                    dict(result, line=dict(result["line"], pvUci=result["line"]["pvUci"][:7]))
                    if result and result.get("line") else result for result in row[name]
                ]
            expected = report["outcomes"][row["id"]]
            for arm, verdict in expected.items():
                assert decision(example, arm) == verdict
            example.pop("results")
            example.pop("milliseconds")
            examples.append(dict(run=run, expected=expected, **example))
    refresh = {}
    for run in ("prospective", "remaining"):
        source = args.raw_runs / f"passer-mobility-{run}-frames.json"
        rows = json.loads(source.read_bytes())
        refresh[run] = dict(sha256=digest(source), counts=Counter(row["refresh"] for row in rows),
                            sampleIds=[row["id"] for row in rows])
    sources = {f"{source.parent.name}/{source.name}": digest(source) for source in args.cached_check}
    write(args.results, dict(runs=summary, refreshedFrames=refresh, cachedCheckInputs=sources))
    write(args.fixtures, examples)


if __name__ == "__main__":
    main()
