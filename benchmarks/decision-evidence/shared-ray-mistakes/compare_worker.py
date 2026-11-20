"""Record report changes from the rear-capture guard on identical engine frames."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

from freeze import load_index


def select_reports(rows):
    return {row["id"]: row["report"] for row in rows}


def compare(baseline, guard):
    old, new = select_reports(baseline), select_reports(guard)
    if len(old) != len(baseline) or len(new) != len(guard) or set(old) != set(new):
        raise ValueError("Report IDs do not match.")
    changes = []
    changed_status = 0
    for identity in old:
        before, after = old[identity], new[identity]
        if before == after:
            continue
        if before is None or after is None:
            raise ValueError(f"Report availability changed for {identity}")
        sections = [key for key in before if before.get(key) != after.get(key)]
        old_mistake, new_mistake = before.get("mistake") or {}, after.get("mistake") or {}
        changed_status += before.get("mistakeStatus") != after.get("mistakeStatus")
        if old_mistake.get("evaluationLossCp") != new_mistake.get("evaluationLossCp"):
            raise ValueError(f"Evaluation loss changed for {identity}")
        changes.append(dict(id=identity, sections=sections, previous=detail(old_mistake), guard=detail(new_mistake)))
    return dict(rows=len(old), valid=sum(report is not None for report in old.values()),
                changed=len(changes), changedStatus=changed_status, changes=changes,
                baselineMedianMs=round(median(row["ms"] for row in baseline), 2),
                guardMedianMs=round(median(row["ms"] for row in guard), 2))


def detail(mistake):
    if not mistake:
        return None
    return dict(
        category=mistake["category"],
        evaluationLossCp=mistake.get("evaluationLossCp"),
        tacticalReasons=mistake.get("tactical", {}).get("reasons"),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("pairs", nargs="+", type=Path)
    args = parser.parse_args()
    if len(args.pairs) % 2:
        parser.error("Provide each baseline and guard together.")
    results = dict()
    for baseline, guard in zip(args.pairs[::2], args.pairs[1::2], strict=True):
        results[baseline.stem] = dict(
            baselineSha256=sha256(baseline.read_bytes()).hexdigest(),
            guardSha256=sha256(guard.read_bytes()).hexdigest(),
            **compare(load_index(baseline), load_index(guard)),
        )
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(results, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
