"""Distinguish outwardly similar exchanges by the pieces actually retained."""
from collections import Counter
from pathlib import Path
import json
import sys

import chess

from resolve import compare
from screen import route_changes, VALUES


def ledger(root, good, bad, other):
    weaker = (bad, other)
    end = min(map(len, (good, *weaker)))
    if end < 7 or bad[1].move != other[1].move:
        return {}
    if not all(branch[1].check or branch[1].capture is not None for branch in weaker):
        return {}

    for horizon in range(7, end + 1):
        branches = (good, *weaker)
        if not all(all(step.quiet for step in branch[horizon - 2:horizon]) for branch in branches):
            continue
        worse_margin = min(good[horizon - 1].material - branch[horizon - 1].material for branch in weaker)
        if worse_margin < 100 or any(branch[horizon - 1].material > -100 for branch in weaker):
            continue
        if any(good[end - 1].material <= branch[end - 1].material or branch[end - 1].material >= 0
               for branch in weaker):
            continue
        attacks = [{step.capture: i for i, step in enumerate(branch[:min(horizon - 2, 10)])
                    if i % 2 == 1 and step.capture is not None} for branch in weaker]
        if any(len(attack) < 2 for attack in attacks):
            continue
        difference = set(attacks[0]).intersection(attacks[1], good[end - 1].present)
        if not difference:
            continue
        roles = Counter(root.piece_type_at(square) for square in difference)
        selected = max(difference, key=lambda square: (VALUES[root.piece_type_at(square)], -square))
        evidence = {
            "victims": [chess.square_name(square) for square in sorted(difference)],
            "roles": {chess.piece_name(role): count for role, count in roles.items()},
            "plies": horizon, "pivotDifference": worse_margin,
            "finalDifferences": [good[end - 1].material - branch[end - 1].material for branch in weaker],
            "better": [step.san for step in good[:horizon]], "worse": [step.san for step in bad[:horizon]],
            "confirmation": [step.san for step in other[:horizon]],
        }
        result = {"inventory": evidence}
        if all(route_changes(root, good, branch, attack[selected])
               for branch, attack in zip(weaker, attacks, strict=True)):
            result["inventory-route"] = evidence
        return result
    return {}


def assess(row):
    comparison = row["comparisonCandidates"] or row["candidates"]
    if comparison[0]["pvUci"][0] != row["candidates"][0]["pvUci"][0]:
        return {}
    actual = row["playedMoveUci"]
    reply = next((probe["lines"][0] for probe in row["replyProbes"] if probe["moveUci"] == actual), None)
    return compare(row, comparison, actual, reply, ledger)


if __name__ == "__main__":
    inputs, references, output = map(Path, sys.argv[1:])
    ref = {row["id"]: row.get("tacticalExchange") for row in json.loads(references.read_bytes())}
    results = [(row["id"], ref.get(row["id"]), assess(row)) for row in json.loads(inputs.read_bytes())]
    print(Counter((label, arm) for _, label, evidence in results for arm in evidence))
    for ident, label, evidence in results:
        if evidence:
            print(ident, label, *evidence)
    with output.open("x", encoding="utf-8") as stream:
        json.dump(results, stream, indent=2)
