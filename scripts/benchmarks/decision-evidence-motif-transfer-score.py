"""Measure reviewed motif nominations and played-mistake triage at fixed budgets."""

import argparse
import hashlib
import json
from pathlib import Path
from statistics import median

import chess
import numpy as np
from sklearn.metrics import average_precision_score


def reads(path):
    return json.loads(path.read_bytes())


def ranking(entries, slots):
    ordered = sorted(entries, key=lambda entry: (-entry[1], hashlib.sha256(entry[0].encode()).digest()))
    answers = [answer for _, _, answer in ordered[:slots]]
    known = [(score, answer) for _, score, answer in entries if answer is not None]
    scores, labels = zip(*known, strict=True) if known else ((), ())
    return dict(reviewedPositive=sum(answer is True for answer in answers),
                reviewedNegative=sum(answer is False for answer in answers),
                uncertain=sum(answer is None for answer in answers), slots=len(answers),
                ap=float(average_precision_score(labels, scores)) if len(set(labels)) == 2 else None,
                availablePositive=sum(labels), availableNegative=len(labels) - sum(labels),
                selected=[case for case, _, _ in ordered[:slots]])


def collection_cue(row):
    if not row["rootGeometry"]:
        return 0
    board = chess.Board(row["fen"])
    root = board.parse_uci(row["line"][0])
    color = board.turn
    board.push(root)
    targets = board.attacks(root.to_square) & chess.SquareSet(board.occupied_co[not color])
    targets &= ~board.pieces(chess.KING, not color) & ~board.pieces(chess.PAWN, not color)
    current = root.to_square
    for uci in row["line"][1:5]:
        move = board.parse_uci(uci)
        if board.turn != color and move.to_square == current:
            break
        if board.turn != color and move.from_square in targets:
            targets.discard(move.from_square)
        if board.turn == color and move.from_square == current:
            if move.to_square in targets:
                return 2
            current = move.to_square
        if move.to_square in targets:
            targets.discard(move.to_square)
        board.push(move)
    return 1


def fork_audit(inputs, pilot, baseline):
    name = "fork-audit-engine"
    rows = inputs[name]
    incumbent = {key: ("fork" in value["root"]) for key, value in baseline[name].items()}
    known = [row for row in rows if row["labels"]["fork"] is not None]
    confusion = {}
    for predicted, actual, key in [(True, True, "tp"), (True, False, "fp"),
                                   (False, True, "fn"), (False, False, "tn")]:
        confusion[key] = sum(incumbent[row["id"]] is predicted and row["labels"]["fork"] is actual for row in known)
    unresolved = [row for row in rows if not incumbent[row["id"]]]
    slots = 12
    index = pilot["themes"].index("fork")
    routes = {"geometry": {row["id"]: int(row["rootGeometry"]) for row in unresolved},
              "geometry-plus-collection": {row["id"]: collection_cue(row) for row in unresolved}}
    for key, groups in pilot["transferPredictions"].items():
        routes[key] = {row["id"]: groups[name][row["id"]][index] for row in unresolved}
    routes["geometry-plus-temporal-first-ply"] = {
        row["id"]: int(row["rootGeometry"]) + routes["temporal-first-ply"][row["id"]] for row in unresolved
    }
    return dict(incumbent=confusion, byRoute={
        route: ranking([(row["id"], scores[row["id"]], row["labels"]["fork"]) for row in unresolved], slots)
        for route, scores in routes.items()
    })


def motif_scores(inputs, pilot, baseline):
    themes = pilot["themes"]
    predictions = pilot["transferPredictions"]
    legacy = {}
    for group, cases in baseline.items():
        legacy[group] = {}
        for motif in themes:
            rows = [case for case in inputs[group] if case["labels"].get(motif) is not None]
            if rows:
                legacy[group][motif] = {
                    key: sum((motif in cases[case["id"]]["root"]) is predicted
                             and case["labels"][motif] is actual for case in rows)
                    for key, predicted, actual in (("tp", True, True), ("fp", True, False),
                                                  ("fn", False, True), ("tn", False, False))
                }
    cohort = ("independent-engine", "woodpecker-engine")
    unresolved = [(group, row) for group in cohort for row in inputs[group]
                  if "fork" not in baseline[group][row["id"]]["root"]]
    index = themes.index("fork")
    return dict(
        incumbent=legacy,
        medianVerifierMs={group: median(row["durationMs"] for row in entries.values())
                          for group, entries in baseline.items()},
        combinedUnresolvedFork={
            name: ranking([(row["id"], scores[group][row["id"]][index], row["labels"].get("fork"))
                           for group, row in unresolved], 10)
            for name, scores in predictions.items()
        },
    )


def mixed(labels):
    tactical, positional = labels["tactical"], labels["positional"]
    if tactical is False or positional is False:
        return False
    if tactical is True and positional is True:
        return True
    return None


def mistake_scores(inputs, pilot, cohort):
    rows = inputs[f"{cohort}-missed"]
    streams = pilot["transferPredictions"]
    result = {}
    for axis in ("tactical", "mixed"):
        def axis_label(row):
            return row["labels"]["tactical"] if axis == "tactical" else mixed(row["labels"])

        unresolved = [row for row in rows if not (row["verified"]["tactical"]
                      and (axis == "tactical" or row["verified"]["positional"]))]
        slots = len(rows) // 4
        scores = {"evaluation-loss": ranking([(row["id"], row["loss"], axis_label(row))
                                               for row in unresolved], slots)}
        for model, streams_by_cohort in streams.items():
            def score(case_id):
                missed = np.asarray(streams_by_cohort[f"{cohort}-missed"][case_id])
                played = np.asarray(streams_by_cohort[f"{cohort}-played"][case_id])
                control = np.asarray(streams_by_cohort[f"{cohort}-control"][case_id])
                return max(missed.max(), (played - control).max())
            scores[model] = ranking([(row["id"], score(row["id"]), axis_label(row)) for row in unresolved], slots)
        result[axis] = scores
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("pilot", type=Path)
    parser.add_argument("verifier", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    inputs, pilot, baseline = (reads(path) for path in (args.input, args.pilot, args.verifier))
    if hashlib.sha256(args.input.read_bytes()).hexdigest() != pilot["transferSha256"]:
        raise ValueError("Transfer cases differ from the frozen run")
    score = dict(motifs=motif_scores(inputs, pilot, baseline),
                 classical={cohort: mistake_scores(inputs, pilot, cohort)
                            for cohort in ("historical", "newer")})
    if "fork-audit-engine" in inputs:
        score["forkAudit"] = fork_audit(inputs, pilot, baseline)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(score, output, indent=2)


if __name__ == "__main__":
    main()
