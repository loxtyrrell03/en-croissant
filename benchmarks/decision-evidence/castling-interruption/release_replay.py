"""Prepare the shared-reply frames and check the released change in scope."""

import argparse
from collections import Counter
import json
from pathlib import Path

from freeze import digest, write


def read(path):
    return json.loads(path.read_bytes())


def prepare(paths, output):
    unique = {}
    for path in paths:
        for row in read(path):
            if row["id"] in unique:
                continue
            frame = {**row, "cohort": path.stem}
            same = row.get("sameAfterCastle")
            comparison = row.get("comparisonCandidates")
            if same and comparison:
                frame["sharedReply"] = dict(
                    betterMoveUci=comparison[0]["pvUci"][0],
                    playedMoveUci=row["playedMoveUci"], line=same[0],
                )
            unique[row["id"]] = frame
    write(output, list(unique.values()))


def unchanged_archive(paths):
    before, after = (read(path) for path in paths)
    assert [row["id"] for row in before] == [row["id"] for row in after]
    for left, right in zip(before, after):
        old, new = left["report"], right["report"]
        if old is None or new is None:
            assert old is new
            continue
        assert old.pop("version") == 64 and new.pop("version") == 65
        assert old == new, left["id"]
    return dict(requests=len(before), changed=0, hashes=[digest(path.read_bytes()) for path in paths])


def compare(paths, output, archive=None):
    input_path, before_path, after_path = paths[:3]
    previous, current = (read(path) for path in (before_path, after_path))
    frames = read(input_path)
    assert [row["id"] for row in frames] == [row["id"] for row in previous] == [row["id"] for row in current]
    cohorts, changes = {}, []
    for row, old, new in zip(frames, previous, current):
        name = row["cohort"]
        counts = cohorts.setdefault(name, Counter())
        counts["requests"] += 1
        first, second = old["report"], new["report"]
        if not first or not second:
            assert first is second
            counts["unavailable"] += 1
            continue
        assert first["version"] == 64 and second["version"] == 65
        ignore = {"version", "mistake"}
        assert {k: v for k, v in first.items() if k not in ignore} == {
            k: v for k, v in second.items() if k not in ignore
        }, row["id"]
        before, after = first["mistake"], second["mistake"]
        if before == after:
            continue
        assert before and after and after["castleDisplacement"] and after["category"] == "mixed", row["id"]
        ignore = {"tactical", "positional", "category", "castleDisplacement"}
        assert {k: v for k, v in before.items() if k not in ignore} == {
            k: v for k, v in after.items() if k not in ignore
        }, row["id"]
        counts["mistakeChanges"] += 1
        changes.append(dict(id=row["id"], cohort=name, before=before["category"], after=after["category"],
                            evidence=after["castleDisplacement"]))
    trials = {path.stem: dict(counts=read(path)["counts"], inputs=read(path)["hashes"]) for path in paths[3:]}
    data = dict(cohorts={key: dict(counts) for key, counts in cohorts.items()}, changes=changes,
                trials=trials, replayHashes={path.name: digest(path.read_bytes()) for path in paths[:3]})
    if archive:
        data["archive"] = unchanged_archive(archive)
    write(output, data)
    print({key: dict(counts) for key, counts in cohorts.items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("prepare", "verify"))
    parser.add_argument("output", type=Path)
    parser.add_argument("inputs", type=Path, nargs="+")
    parser.add_argument("--archive", nargs=2, type=Path, metavar=("V64", "V65"))
    args = parser.parse_args()
    if args.stage == "prepare":
        prepare(args.inputs, args.output)
    else:
        compare(args.inputs, args.output, args.archive)


if __name__ == "__main__":
    main()
