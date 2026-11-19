"""Score exact-move technology transfer and preserve scope of motif evidence."""

import argparse
from collections import Counter
import json
from pathlib import Path

import chess


def read(path):
    return json.loads(path.read_bytes())


def scoped_witnesses(row, report):
    move = report.get("decision") or {}
    if move.get("tactical") != "supported":
        return []
    board = chess.Board(row["fen"])
    board.push_uci(row["move"])
    return [witness for witness in move["mechanisms"]
            if witness["mechanism"] == "fork"
            and sum(board.piece_type_at(chess.parse_square(square)) not in (None, chess.PAWN)
                    for square in witness["squares"][1:]) >= 2]


def score(sample, reference, results):
    references = {row["id"]: row for row in reference["cases"]}
    rows = {row["id"]: row for row in sample["cases"]}
    if set(rows) != set(references) or len(results) != len(rows) or set(rows) != {row["id"] for row in results}:
        raise ValueError("Benchmark reports must cover the exact reference cases")
    labels, events = Counter(), {}
    outcomes = ("truePositive", "falsePositive", "falseNegative", "trueNegative", "unknownReported", "unknown")
    approaches = ("liveMotif", "decisionEvidence", "decisionWithReplyFork")
    for result in results:
        key = result["id"]
        row, reference = rows[key], references[key]
        if row["move"] != reference["moveUci"]:
            raise ValueError(f"Wrong exact move for {key}")
        decision = result.get("decision") or {}
        badge = "fork" in result["rootMotifs"]
        evidence = ("fork" in decision.get("rootMotifs", []) or bool(scoped_witnesses(row, result))
                    or bool((decision.get("conditionalFork") or {}).get("defenceConsequence")))
        extra = bool(result.get("replyFork"))
        truth = reference["fork"]
        event = row["event"]
        cohort = events.setdefault(event, Counter())
        for method, found in zip(approaches, (badge, evidence, evidence or extra), strict=True):
            if truth is None:
                cell = "unknownReported" if found else "unknown"
            elif truth:
                cell = "truePositive" if found else "falseNegative"
            else:
                cell = "falsePositive" if found else "trueNegative"
            labels[method, cell] += 1
            cohort[method, cell] += 1
    return dict(total={method: {outcome: labels[method, outcome] for outcome in outcomes} for method in approaches},
                groups={name: {method: {outcome: counts[method, outcome] for outcome in outcomes}
                               for method in approaches} for name, counts in events.items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("results", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = score(read(args.sample), read(args.reference), read(args.results))
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(result, file, indent=2)


if __name__ == "__main__":
    main()
