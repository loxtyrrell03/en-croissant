"""Compare route explanations and scope verdicts on matched worker replays."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

import chess

METHODS = {
    "archive": ("baseline", "repeated", "named-repeated", "settled", "final"),
    "cached": ("baseline", "leading-reply", "repeated", "named-repeated", "separated", "settled", "final"),
    "scored": ("baseline", "repeated", "named-repeated", "separated", "settled", "final"),
    "holdout": ("baseline", "final"),
}
INPUTS = {"archive": "archive", "cached": "cached", "scored": "reserve-scored", "holdout": "holdout-scored"}
MOTIFS = ("clearance", "deflection")


def indexed(path):
    rows = json.loads(path.read_bytes())
    return {row["id"]: row for row in rows}


def category(report):
    return (report or {}).get("category")


def root_motifs(move):
    return {motif["id"] for motif in move["verifiedMotifs"] if motif["ply"] == 1} | {
        item["mechanism"] for item in move["mechanisms"] if item["rootMoveInvolved"]
    }


def compare(baseline, candidate):
    assert baseline.keys() == candidate.keys()
    counts = {}
    new = []
    for case_id, row in candidate.items():
        old, report = baseline[case_id]["report"], row["report"]
        assert bool(old) == bool(report), case_id
        if not report:
            continue
        cohort = row["cohort"]
        per = counts.setdefault(cohort, Counter())
        for name in ("position", "mistake"):
            per[name + "Changed"] += old[name] != report[name]
            per[name + "CategoryChanged"] += category(old[name]) != category(report[name])
        for index, (old_move, move) in enumerate(zip(old["moves"], report["moves"], strict=True)):
            assert old_move["moveUci"] == move["moveUci"]
            per["movesChanged"] += old_move != move
            per["moveCategoryChanged"] += category(old_move) != category(move)
            for kind in root_motifs(move) - root_motifs(old_move):
                if kind not in MOTIFS:
                    continue
                per[kind + "Added"] += 1
                if cohort in ("course", "independent") or cohort.startswith("archive-"):
                    continue
                proof = next(item for item in move["mechanisms"] if item["mechanism"] == kind)
                board = chess.Board(proof["fen"])
                san = board.variation_san(map(chess.Move.from_uci, proof["lineUci"]))
                new.append(dict(id=case_id, candidate=index + 1, motif=kind, line=san,
                                previous=category(old_move), verdict=category(move)))
    times = [row["elapsedMs"] for row in candidate.values() if row["report"]]
    return dict(valid=len(times), medianWorkerMs=round(median(times), 2), byCohort=counts, publicWitnesses=new)


def frozen_score(rows, reference):
    totals = {name: Counter() for name in MOTIFS}
    for case_id, record in reference.items():
        report = rows["route:" + case_id]["report"]
        calls = root_motifs(report["moves"][0]) if report else set()
        for name in MOTIFS:
            truth = record["labels"][name]
            actual = name in calls
            score = ("unknown-positive" if actual else "unknown") if truth is None else (
                ("tp" if actual else "fn") if truth else ("fp" if actual else "tn")
            )
            totals[name][score] += 1
    return totals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    original = Path(__file__).resolve().parent.parent / "line-route-motifs"
    reference = indexed(original / "reference.json")
    frozen_receipt = {}
    results = {}
    for group, methods in METHODS.items():
        frames = args.runs / f"{INPUTS[group]}.json"
        baseline = indexed(args.runs / f"{group}-baseline.json")
        group_receipt = dict(inputSha256=sha256(frames.read_bytes()).hexdigest(), arms={})
        for method in methods:
            rows = indexed(args.runs / f"{group}-{method}.json")
            group_receipt["arms"][method] = compare(baseline, rows)
            if group == "cached":
                frozen_receipt[method] = frozen_score(rows, reference)
        results[group] = group_receipt
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(dict(comparisons=results, frozenNamedMotifs=frozen_receipt), output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
