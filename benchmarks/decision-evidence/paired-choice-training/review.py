"""Summarize repeated holdout witnesses and test whether their first check matters."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import chess

from search_pairs import child, cp, engines, initial, records, select_lines

CHECK_NODES = 2_400_000


def verified(rows):
    return {
        (row["id"], p["move"], p["comparedWith"], p["reply"], p["mechanism"], p.get("originalVictimSquare")): (row, p)
        for row in rows for p in row["pairs"] if p["outcome"] == "verified"
    }


def variation(board, moves):
    return board.variation_san([chess.Move.from_uci(move) for move in moves])


def check_order(board, pair, executable):
    at = child(board, pair["move"])
    checking = at.parse_uci(pair["reply"])
    if not at.gives_check(checking) or not pair.get("capture") or pair["capture"] == pair["reply"]:
        return {"kind": "no prior checking move"}
    immediate = chess.Move.from_uci(pair["capture"])
    if immediate not in at.legal_moves or not at.is_capture(immediate):
        return {"kind": "the later capture cannot be made immediately",
                "checkSan": at.san(checking)}
    matched = select_lines(at, executable, CHECK_NODES, 2, [checking, immediate])
    if len(matched) != 2:
        return {"kind": "incomplete exact comparison"}
    moves = {frame["pvUci"][0]: frame for frame in matched}
    return {
        "kind": "same-depth comparison from after the weaker choice",
        "checkedMoveSan": at.san(checking),
        "directCaptureSan": at.san(immediate),
        "checkMinusDirectCp": cp(moves[checking.uci()]) - cp(moves[immediate.uci()]),
        "frames": matched,
    }


def counts_for(ranked, positives):
    return {
        name: {
            "initial": entry["onePerBoard"],
            "initialAveragePrecision": entry["candidateAveragePrecision"],
            "repeatableWitnessesSelected": sum(
                (option["id"], option["move"]) in positives for option in entry["selected"]
            ),
            "repeatableEvents": sorted({
                option["event"] for option in entry["selected"] if (option["id"], option["move"]) in positives
            }),
        }
        for name, entry in ranked["transfer"]["results"].items()
    }


def review(args):
    first = verified(records(args.first))
    stronger = verified(records(args.stronger))
    kept = first.keys() & stronger.keys()
    app = {row["id"]: row["report"] for row in records(args.app)}
    initial_fit = json.loads(args.ranked.read_bytes())
    longer_fit = json.loads(args.longer_fit.read_bytes())
    examples = []
    coverage = {}
    for key in sorted(kept):
        row, pair = stronger[key]
        board = initial(row)
        if row["id"] not in coverage:
            coverage[row["id"]] = {
                ranks: [{"san": board.san(board.parse_uci(line["pvUci"][0])),
                         "move": line["pvUci"][0], "cp": line["cp"], "depth": line["depth"]}
                        for line in select_lines(board, str(args.engine), CHECK_NODES, ranks)]
                for ranks in (3, 5)
            }
        examples.append({
            "id": row["id"], "site": row["site"], "fen": row["fen"], "event": row["event"],
            "stronger": key[2], "weaker": key[1], "checkOrCapture": key[3],
            "originalTarget": key[5], "lossCp": pair["rootLossCp"],
            "lossInSeparateReplyCp": pair["replyLossCp"],
            "sameReplyContrastCp": pair.get("controlLossCp"),
            "retainedMaterialContrast": pair.get("materialContrast"),
            "refutationSan": variation(board, pair["refutedLine"][:8]),
            "comparisonSan": variation(board, pair["comparedLine"][:8]),
            "refutedLine": pair["refutedLine"], "comparedLine": pair["comparedLine"],
            "baseline": app[row["id"]],
            "firstCheck": check_order(board, pair, str(args.engine)),
        })
    stage_counts = Counter(row["report"]["category"] if row["report"] else "unavailable"
                           for row in records(args.app))
    repeated = {(key[0], key[1]) for key in kept}
    return {
        "inputSha256": {path.name: sha256(path.read_bytes()).hexdigest()
                        for path in (args.first, args.stronger, args.engine)},
        "fitLabels": initial_fit["trainCandidates"],
        "developmentLabels": initial_fit["development"]["candidateLabels"],
        "holdoutLabels": initial_fit["transfer"]["candidateLabels"],
        "holdoutPositionAssessments": stage_counts,
        "firstWitnesses": len(first),
        "strongerWitnesses": len(stronger),
        "repeatedWitnesses": len(kept),
        "repeatableGames": len({key[0] for key in kept}),
        "repeatableEvents": len({stronger[key][0]["event"] for key in kept}),
        "firstFit": counts_for(initial_fit, repeated),
        "convergenceCheck": {
            "results": counts_for(longer_fit, repeated),
            "iterations": {name: expense.get("iterations")
                           for name, expense in longer_fit["transfer"]["modelTiming"].items() if "iterations" in expense},
        },
        "witnesses": examples,
        "unrestrictedRootVisibility": coverage,
        "onlyAtInitialBudget": [list(key) for key in sorted(first.keys() - stronger.keys())],
        "onlyAtStrongerBudget": [list(key) for key in sorted(stronger.keys() - first.keys())],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("first", "stronger", "app", "ranked", "longer_fit", "engine", "output"):
        parser.add_argument(field, type=Path)
    args = parser.parse_args()
    try:
        result = review(args)
        with args.output.open("x", encoding="utf8") as out:
            json.dump(result, out, ensure_ascii=False, indent=2)
            out.write("\n")
    finally:
        for worker in engines:
            worker.quit()
