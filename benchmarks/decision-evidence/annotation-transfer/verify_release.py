"""Compare the released report to the baseline and paired-move prototype."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path


def load(path):
    rows = json.loads(path.read_bytes())
    index = {row["id"]: row["report"] for row in rows}
    if len(rows) != len(index):
        raise ValueError("Duplicate replay results")
    return index


def compare(old, new, prototype=None):
    assert old.keys() == new.keys(), "Different replay decisions"
    if prototype is not None:
        assert old.keys() == prototype.keys(), "Different prototype decisions"
    counts = Counter()
    for key in old:
        before, after = old[key], new[key]
        if before is None:
            assert after is None, key
            counts["unavailable"] += 1
            continue
        assert after and after["version"] == 63, key
        recorded = after.get("playedMoveAssessment")
        assert {k: v for k, v in after.items() if k not in {"version", "playedMoveAssessment"}} == {
            k: v for k, v in before.items() if k != "version"
        }, key
        if prototype is not None:
            assert prototype[key]["moves"] == before["moves"] + ([recorded] if recorded else []), key
        if recorded:
            assert all(move["moveUci"] != recorded["moveUci"] for move in before["moves"]), key
            counts["supplemental"] += 1
            counts[recorded["category"]] += 1
    return dict(requests=len(old), stats=dict(counts))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("old", "new", "prototype", "archive_old", "archive_new", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    archive = compare(load(args.archive_old), load(args.archive_new))
    annotation = compare(load(args.old), load(args.new), load(args.prototype))
    paths = [args.old, args.new, args.prototype, args.archive_old, args.archive_new]
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(dict(annotation=annotation, archive=archive, inputs={
            path.name: sha256(path.read_bytes()).hexdigest() for path in paths
        }), out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
