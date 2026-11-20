"""Record exact app deltas and verify the experiment leaves other scopes intact."""

import argparse
from collections import Counter
import json
from pathlib import Path

from freeze import digest, write


def read(path):
    return json.loads(path.read_bytes())


def difference(before, after):
    if before == after:
        return None
    assert after["retainedPawnSupport"]
    assert before["tactical"] == after["tactical"], "Tactical evidence changed"
    assert before["positional"]["support"] != "supported", "Overrode existing positional evidence"
    assert after["positional"]["basis"] == "heuristic"
    compare = {"category", "positional", "retainedPawnSupport", "limitations"}
    assert {k: v for k, v in before.items() if k not in compare} == {
        k: v for k, v in after.items() if k not in compare
    }
    return dict(before=before["category"], after=after["category"], evidence=after["retainedPawnSupport"])


def collect(frames, baseline, candidate):
    assert [row["id"] for row in frames] == [row["id"] for row in baseline] == [row["id"] for row in candidate]
    cohorts, changes = {}, []
    for frame, old, new in zip(frames, baseline, candidate):
        cohort = frame["cohort"]
        counts = cohorts.setdefault(cohort, Counter())
        counts["requests"] += 1
        if new.get("request"):
            counts["extraRepliesRequested"] += 1
            if new["reusedFrame"]:
                counts["extraRepliesAvailable"] += 1
        before, after = old["report"], new["report"]
        if not before or not after:
            assert before is after
            continue
        assert before["version"] == 63 and after["version"] == 64
        scopes = {"version", "position", "moves"}
        assert {k: v for k, v in before.items() if k not in scopes} == {
            k: v for k, v in after.items() if k not in scopes
        }, frame["id"]
        assert before["moves"][1:] == after["moves"][1:]
        position = difference(before["position"], after["position"])
        candidate = difference(before["moves"][0], after["moves"][0])
        if position or candidate:
            counts["positionChanges"] += bool(position)
            counts["leadingMoveChanges"] += bool(candidate)
            changes.append(dict(id=frame["id"], cohort=cohort, position=position, move=candidate))
    return dict(cohorts={k: dict(v) for k, v in cohorts.items()}, changes=changes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("frames", "baseline", "candidate", "calibration", "development", "reserve", "cached", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    release = collect(*(read(path) for path in (args.frames, args.baseline, args.candidate)))
    # Selected examples have a fully observed positive transfer result.
    sources = ("calibration", "development", "reserve")
    comparisons = {name: read(getattr(args, name)) for name in sources}
    experiment = {name: dict(totals=data["totals"], hashes=data["inputs"])
                  for name, data in comparisons.items()}
    by_case = {item["id"]: item["reference"] for data in comparisons.values() for item in data["cases"]}
    for change in release["changes"]:
        assert any(result["status"] == "positive" for result in by_case[change["id"]])
    inputs = [args.frames, args.baseline, args.candidate]
    write(args.output, dict(
        experiment=experiment, replay=release, cached=read(args.cached),
        replayHashes={path.name: digest(path.read_bytes()) for path in inputs},
    ))
    print(release["cohorts"])


if __name__ == "__main__":
    main()
