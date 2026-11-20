"""Summarize exact-role interference recovery on fixed paired inputs."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

import chess


ROLES = ("interposer", "guard", "target", "attacker")


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def by_id(rows):
    indexed = {item["id"]: item for item in rows}
    if len(indexed) != len(rows):
        raise ValueError("Duplicate case ID")
    return indexed


def keys(branch, qualified=True):
    return {
        tuple(item[role] for role in ROLES)
        for item in branch
        if not qualified or item["kind"] == "used-cut"
    }


def reports(row):
    move = row["report"]["moves"][0]
    return move["mechanisms"] + move["verifiedMotifs"]


def live(row):
    return any(item["id"] == "interference" for item in row["live"])


def named(row):
    return any(item.get("mechanism", item.get("id")) == "interference" for item in reports(row))


def confusion(reference, detected):
    return dict(Counter(
        ("TP" if positive else "FP") if predicted else ("FN" if positive else "TN")
        for positive, predicted in zip(reference, detected, strict=True)
    ))


def line_label(fen, moves, max_ply=9):
    board = chess.Board(fen)
    return board.variation_san([chess.Move.from_uci(move) for move in moves[:max_ply]])


def lab_result(input_path, candidate_path, baseline_path=None):
    inputs = by_id(read(input_path))
    candidate = by_id(read(candidate_path))
    baseline = by_id(read(baseline_path)) if baseline_path else None
    assert candidate.keys() == inputs.keys()
    assert baseline is None or baseline.keys() == inputs.keys()
    live_reference = []
    decision_reference = []
    geometric_reference = []
    added_live = []
    added_decisions = []
    changed_characters = []
    support_pattern = Counter()
    exact_candidate_live = []
    exact_candidate_decision = []
    for case_id, case in inputs.items():
        first, second = case["reference"]
        a, b = keys(first), keys(second)
        live_reference.append(bool(a))
        decision_reference.append(bool(a & b))
        geometric_reference.append(bool(keys(first, qualified=False)))
        support_pattern[
            "same role in both" if a & b else "different roles in both" if a and b
            else "first search only" if a else "independent reply only" if b else "neither"
        ] += 1
        detected, old = candidate[case_id], baseline[case_id] if baseline else None
        live_routes = [route for route in detected["routes"] if route["id"] == "interference"]
        confirmed = [
            route for route in detected["corroborated"] if route["mechanism"] == "interference"
        ]
        for route in live_routes:
            role = tuple(chess.square_name(square) for square in route["squares"])
            assert role in a, (case_id, role, a)
            assert any(
                tuple(item[key] for key in ROLES) == role
                and item["payoffIndex"] + 1 == route["through"] for item in first
            ), (case_id, route)
        for route in confirmed:
            assert tuple(route["squares"]) in a & b, (case_id, route, a, b)
        exact_candidate_live.append(bool(live_routes))
        exact_candidate_decision.append(bool(confirmed))
        if live(detected) and (old is None or not live(old)):
            assert live_routes, case_id
            route = live_routes[0]
            added_live.append(dict(
                id=case_id, line=line_label(case["fen"], case["candidates"][0]["pvUci"], route["through"]),
                roles=[chess.square_name(square) for square in route["squares"]],
                point=route["text"],
            ))
        if named(detected) and (old is None or not named(old)):
            if old is not None:
                assert confirmed, case_id
            added_decisions.append(case_id)
        category = detected["report"]["position"]["category"]
        if old and category != old["report"]["position"]["category"]:
            changed_characters.append(dict(id=case_id, before=old["report"]["position"]["category"], after=category))
    result = dict(
        cases=len(inputs), searchInputSha256=digest(input_path), reference=dict(support_pattern),
        geometricLive=confusion(live_reference, geometric_reference),
        candidateExactLive=confusion(live_reference, exact_candidate_live),
        candidateExactDecision=confusion(decision_reference, exact_candidate_decision),
        candidateLive=confusion(live_reference, [live(candidate[key]) for key in inputs]),
        candidateDecision=confusion(decision_reference, [named(candidate[key]) for key in inputs]),
        newLive=added_live, newDecisions=added_decisions, positionChanges=changed_characters,
        medianCandidateWorkerMs=round(median(row["ms"] for row in candidate.values()), 2),
    )
    if baseline:
        result.update(
            baselineLive=confusion(live_reference, [live(baseline[key]) for key in inputs]),
            baselineDecision=confusion(decision_reference, [named(baseline[key]) for key in inputs]),
            medianBaselineWorkerMs=round(median(row["ms"] for row in baseline.values()), 2),
        )
    return result


def archive_result(base_path, next_path):
    base = by_id(read(base_path))
    after = by_id(read(next_path))
    assert base.keys() == after.keys()
    assert all((base[key]["report"] is None) == (after[key]["report"] is None) for key in base)
    fields = Counter()
    changed = []
    for key, old in base.items():
        report = old["report"]
        if report is None:
            continue
        delta = [field for field in report if field != "version" and report[field] != after[key]["report"][field]]
        if delta:
            fields.update(delta)
            changed.append(key)
    return dict(
        requests=len(base), reports=sum(row["report"] is not None for row in base.values()),
        changedByField=dict(fields), changed=changed,
        medianBaselineWorkerMs=round(median(row["ms"] for row in base.values() if row["report"]), 2),
        medianCandidateWorkerMs=round(median(row["ms"] for row in after.values() if row["report"]), 2),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw", type=Path, help="Directory containing scored inputs and before/after replays")
    parser.add_argument("archive_baseline", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = args.raw
    splits = ("development", "heldout", "classical")
    results = {
        name: lab_result(
            root / f"{name}-scored.json", root / f"{name}-next.json", root / f"{name}-base.json",
        )
        for name in splits
    }
    results["deeperRecheck"] = lab_result(
        root / "rechecked-scored.json", root / "rechecked-next.json", root / "rechecked-base.json",
    )
    results["archive"] = archive_result(args.archive_baseline, root / "archive-next.json")
    manifest = read(root / "classical-manifest.json")
    results["classical"]["sources"] = {
        Path(path).name: row for path, row in manifest["sources"].items()
    }
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(results, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


if __name__ == "__main__":
    main()
