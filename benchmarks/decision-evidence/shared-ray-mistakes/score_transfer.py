"""Compare the TypeScript candidate with independently reviewed exact questions."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from freeze import load_index
from score import measure


def index(path):
    rows = load_index(path)
    found = {row["id"]: row for row in rows}
    if len(found) != len(rows):
        raise ValueError(f"Duplicate decision in {path}")
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("frames", "reference", "candidate", "baseline", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    frames, candidate, baseline = (index(path) for path in (args.frames, args.candidate, args.baseline))
    reviewed = {row["id"]: row for row in load_index(args.reference)["labels"]}
    if not (frames.keys() == candidate.keys() == baseline.keys()) or not reviewed.keys() <= frames.keys():
        raise ValueError("The review and replays must come from the same frozen decisions.")
    picks = {key for key, row in candidate.items() if row.get("result")}
    restricted = {key for key, row in candidate.items() if row.get("nomination") == "restricted"}
    by_case = []
    for key, row in candidate.items():
        if key not in reviewed and not row.get("nomination"):
            continue
        report = baseline[key]["report"] or {}
        mistake = report.get("mistake") or {}
        by_case.append(dict(
            id=key, source=frames[key].get("site"), cohort=frames[key].get("category"), nomination=row.get("nomination"),
            reference=reviewed.get(key),
            baselineCategory=mistake.get("category"), baselineStatus=report.get("mistakeStatus"),
            baselineReasons=mistake.get("tactical", {}).get("reasons", []), candidate=row.get("result"),
        ))
    result = dict(
        inputs={path.name: sha256(path.read_bytes()).hexdigest()
                for path in (args.frames, args.reference, args.candidate, args.baseline)},
        rows=len(frames), reviewed=dict(Counter(row["verdict"] for row in reviewed.values())),
        quality=measure(reviewed, picks),
        nominations=dict(Counter(row.get("nomination") for row in candidate.values() if row.get("nomination"))),
        restrictedNodes=sum((frames[key].get("sharedReply") or {}).get("line", {}).get("nodes", 0)
                            for key in restricted),
        cases=by_case,
    )
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(result, out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
