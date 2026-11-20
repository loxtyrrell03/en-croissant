"""Check that the experiment only adds positional evidence to played mistakes."""
from argparse import ArgumentParser
from copy import deepcopy
from json import dump, load
from pathlib import Path
from statistics import median


def by_id(path):
    with path.open(encoding="utf-8") as stream:
        rows = load(stream)
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate decision IDs")
    return result


def compare(before, after):
    if before.keys() != after.keys():
        raise ValueError("The two replays contain different decisions")
    changes = []
    before_times = []
    after_times = []
    for id_, old in before.items():
        new = after[id_]
        original, updated = old["report"], new["report"]
        if original is None or updated is None:
            if original != updated:
                raise ValueError(f"The legality filter changed for {id_}")
            continue
        before_times.append(old["ms"])
        after_times.append(new["ms"])
        baseline = deepcopy(original)
        candidate = deepcopy(updated)
        baseline.pop("version")
        candidate.pop("version")
        old_mistake = baseline.get("mistake")
        new_mistake = candidate.get("mistake")
        proof = (new_mistake or {}).get("exchangeOutpost")
        if proof:
            if old_mistake["category"] != "tactical" or new_mistake["category"] != "mixed":
                raise ValueError(f"Unexpected report transition for {id_}")
            changes.append(dict(id=id_, before="tactical", after="mixed", proof=proof))
            for key in ("positional", "positionalFactors", "category", "exchangeOutpost"):
                new_mistake.pop(key, None)
                old_mistake.pop(key, None)
        if baseline != candidate:
            raise ValueError(f"Unrelated report fields changed for {id_}")
    return {
        "requests": len(before),
        "reports": len(before_times),
        "changes": changes,
        "medianMs": {"baseline": round(median(before_times), 2),
                     "candidate": round(median(after_times), 2)},
    }


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    report = compare(by_id(args.baseline), by_id(args.candidate))
    with args.output.open("x", encoding="utf-8") as stream:
        dump(report, stream, indent=2)
        stream.write("\n")
