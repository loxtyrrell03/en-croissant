"""Compare each app-budget pawn observation with independently searched lines."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from plans import examine


def signature(observation):
    return tuple(observation[key] for key in ("pawn", "lever", "target", "theirSquare"))


def compare(app_rows, reference_rows):
    app_by_id = {row["id"]: row for row in app_rows}
    reference_by_id = {row["id"]: row for row in reference_rows}
    if (len(app_rows) != len(app_by_id) or len(reference_rows) != len(reference_by_id)
            or app_by_id.keys() != reference_by_id.keys()):
        raise ValueError("The two frame sets must have the same unique case IDs")

    result = []
    for identity, app in app_by_id.items():
        deep = reference_by_id[identity]
        if app["fen"] != deep["fen"]:
            raise ValueError(f"Reference board differs for {identity}")
        views = (examine(app), examine(app, settle=True), examine(deep, settle=True))
        keys = [{signature(item) for item in view["grounded"]} for view in views]
        shape, fixed, settled, deep_grounded = (
            {signature(item) for item in views[1]["pattern"]}, *keys
        )
        result.append(dict(
            id=identity, matched={arm: sorted(outcomes & deep_grounded)
                                  for arm, outcomes in (("shape", shape), ("fixed", fixed), ("settled", settled))},
            shallow=views[1], fixed=views[0]["grounded"], independent=views[2],
        ))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    packets = {which: getattr(args, which).read_bytes() for which in ("app", "reference")}
    comparisons = compare(*(json.loads(value) for value in packets.values()))
    tallies = Counter()
    for case in comparisons:
        for field, predictions in (("shape", case["shallow"]["pattern"]),
                                   ("fixed", case["fixed"]), ("settled", case["shallow"]["grounded"])):
            tallies[field] += bool(predictions)
            tallies[field + "Corroborated"] += bool(case["matched"][field])
        tallies["independentlyObserved"] += bool(case["independent"]["grounded"])
    output = dict(total=len(comparisons), counts=dict(tallies),
                  framesSha256={key: sha256(data).hexdigest() for key, data in packets.items()},
                  cases=comparisons)
    with args.output.open("x", encoding="utf8", newline="\n") as target:
        json.dump(output, target, indent=2)
        target.write("\n")
    print(json.dumps(output["counts"]), flush=True)


if __name__ == "__main__":
    main()
