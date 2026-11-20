"""Describe the same rankings against the incumbent's exact-branch replays."""
from collections import Counter
from pathlib import Path
import argparse
import json

from frames import write


def assess(available, version, axis):
    return (available.get(version) or {}).get(axis, {}).get("support") == "supported"


def label(row):
    before, after = (assess(row, stamp, "tactical") for stamp in ("short", "deep"))
    return "retained" if before and after else "added" if after else "removed" if before else "unresolved"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("results", "replay", "output"):
        p.add_argument(name, type=Path)
    a = p.parse_args()
    base = json.loads(a.results.read_bytes())
    reports = {r["id"]: r for r in json.loads(a.replay.read_bytes())}
    subset = {case: label(reports[case]) for case in base["caseScores"]}
    outcome = {variant: Counter(subset[case] for case in detail["selected"])
               for variant, detail in base["results"].items()}
    write(a.output, {"overall": Counter(subset.values()), "byShortlist": outcome, "cases": subset})
    print(dict(Counter(subset.values())), {variant: dict(counts) for variant, counts in outcome.items()}, flush=True)


if __name__ == "__main__":
    main()
