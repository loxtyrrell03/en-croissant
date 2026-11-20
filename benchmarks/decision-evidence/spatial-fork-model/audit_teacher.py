"""Compare the narrow engine training target with existing exact-move reviews."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import chess
import chess.engine

from experiment import payoff


def exact_label(engine, row):
    if "deep" in row:
        return row["label"], row["reason"]
    board = chess.Board(row["fen"])
    move = board.parse_uci(row["move"])
    targets = payoff.geometry(board, move)
    child = board.copy(stack=False)
    child.push(move)
    label, reason, _ = payoff.label_payoff(board, move, targets,
                                           payoff.search(engine, child, payoff.PROOF_NODES))
    return label, reason


def audit(bundle, executable):
    sha = hashlib.sha256(executable.read_bytes()).hexdigest()
    if sha != bundle["engine"]:
        raise ValueError("Expected the engine used to collect the original searches")
    rows = {row["identity"]["id"]: row for row in bundle["rows"]}
    result = {}
    with chess.engine.SimpleEngine.popen_uci(str(executable)) as engine:
        engine.configure({"Threads": 1, "Hash": 32})
        for name, reference in bundle["reviews"].items():
            table, misses = Counter(), Counter()
            for case in reference:
                key = case["id"]
                if case["moveUci"] != rows[key]["move"]:
                    raise ValueError("Reviewed move mismatch")
                label, _ = exact_label(engine, rows[key])
                table[(case["fork"], label)] += 1
                if case["fork"] is True and not bundle["incumbent"][key]:
                    misses[label] += 1
            values = {"positive": True, "negative": False, "unknown": None}
            result[name] = {
                "counts": {
                    manual: {teacher: table[(manual_label, teacher_label)]
                             for teacher, teacher_label in values.items()}
                    for manual, manual_label in values.items()
                },
                "reviewedPositiveMissedByApp": {name: misses[value] for name, value in values.items()}
            }
    return dict(teacherNodes=payoff.PROOF_NODES, cohorts=result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transfer", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = audit(payoff.read(args.transfer), args.engine)
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(result, file, indent=2)
