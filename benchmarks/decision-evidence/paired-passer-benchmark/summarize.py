"""Publish compact counts and exact positive/diagnostic examples."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import chess

from search_pairs import reached, sampling


def verify_partitions(cohorts):
    identities = []
    for rows in cohorts.values():
        games = {row["game"] for row in rows}
        if len(games) != len(rows):
            raise ValueError("More than one decision from a game")
        boards = set()
        for row in rows:
            board = reached(row)
            boards.add(sampling.board_key(board))
            for arm in row.get("arms", []):
                child = board.copy()
                child.push_uci(arm["move"])
                boards.add(sampling.board_key(child))
        identities.append((games, {row["event"] for row in rows}, boards))
    for left, right in zip(*identities, strict=True):
        if left & right:
            raise ValueError("A game, event or normalized board crosses the split")


def orientation(rows, layer, key):
    return {r["id"]: r[layer][key] for r in rows if r[layer][key] is not None}


def retained(first, second):
    return {case: value for case, value in first.items() if second.get(case) == value}


def summary(sample, preview, reference, deeper, forced, repeated, matched):
    provisional = orientation(reference, "reference", "advancingBranch")
    confirmed = orientation(deeper, "stronger", "advancingBranch")
    push_first = orientation(forced, "first", "viableBranch")
    push_repeat = orientation(repeated, "repeat", "viableBranch")
    push_matched = orientation(matched, "matched", "viableBranch")
    push_fixed = retained(retained(push_first, push_repeat), push_matched)
    valid_control = {
        "bothKnown": sum(
            all(arm["outcome"] is not None for arm in row["reference"]["compared"])
            for row in reference if row["selection"] == "control"
        ),
        "contrast": sum(
            row["reference"]["advancingBranch"] is not None
            for row in reference if row["selection"] == "control"
        ),
    }
    return {
        "games": len(sample), "events": len({row["event"] for row in sample}),
        "preview": dict(Counter(row["status"] for row in preview)),
        "nominated": sum(row.get("hint", 0) > 0 for row in preview),
        "reference": len(reference), "referenceControls": valid_control,
        "referenceOpposite": provisional, "recheckedReference": len(deeper),
        "strongerOpposite": confirmed, "repeatedOpposite": retained(provisional, confirmed),
        "forcedPairs": len(forced), "forcedOpposite": push_first,
        "forcedOppositeRepeated": retained(push_first, push_repeat),
        "forcedOppositeMatched": retained(push_first, push_matched), "forcedStable": push_fixed,
        "overlapOfDefiniteTargets": sorted(confirmed.keys() & push_fixed.keys()),
    }


def inputs(root):
    stages = ("sample", "preview", "reference", "adjudication", "forced-first", "forced-deep", "forced-matched")
    loaded, hashes = [], {}
    for stage in stages:
        content = (root / f"{stage}.json").read_bytes()
        loaded.append(json.loads(content))
        hashes[stage] = sha256(content).hexdigest()
    return loaded, hashes


def exact_examples(stages, frame_names, notes):
    examples = []
    for note in notes:
        by_stage = {}
        for stage, field in frame_names:
            rows = stages[stage][note["split"]]
            if (row := next((row for row in rows if row["id"] == note["id"]), None)) is None:
                continue
            by_stage[field] = row[field]
        original = next(row for row in stages[0][note["split"]] if row["id"] == note["id"])
        if not by_stage:
            raise ValueError(f"No reviewed search frame for {note['id']}")
        examples.append(dict(original, split=note["split"], **by_stage))
    return examples


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("lab", "notes", "report", "examples"):
        p.add_argument(name, type=Path)
    args = p.parse_args()
    data, hashes = inputs(args.lab)
    verify_partitions(data[1])
    last = {
        "inputSha256": hashes,
        "splits": {split: summary(*(stage[split] for stage in data)) for split in data[0]},
    }
    notes = json.loads(args.notes.read_bytes())
    cases = exact_examples(data, ((2, "reference"), (3, "stronger"), (4, "first"),
                                  (5, "repeat"), (6, "matched")), notes)
    with args.report.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(last, stream, indent=2)
        stream.write("\n")
    with args.examples.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write("[\n" + ",\n".join("  " + json.dumps(case, separators=(",", ":")) for case in cases) + "\n]\n")


if __name__ == "__main__":
    main()
