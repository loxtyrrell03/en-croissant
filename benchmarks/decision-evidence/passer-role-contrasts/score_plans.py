"""Score pawn identity and separate exact-move contribution against a blind reference."""

import argparse
from collections import Counter
from pathlib import Path
from statistics import median
from time import perf_counter

import chess

from pawn_plans import assets, compare
from freeze import read, write
from trials import initial


def notation(row, proof):
    if not proof:
        return None
    board = initial(row)
    return dict(pawn=proof["pawn"], defending=proof["defending"], lines=[
        dict(move=b["move"], role=b["role"], rootAction=b["rootAction"],
             san=board.variation_san([chess.Move.from_uci(s) for s in b["path"]]))
        for b in proof["branches"]
    ])


def score_scope(counter, predicted, label):
    if label is None:
        counter["unknownCall" if predicted else "unknownAbstain"] += 1
    elif not label:
        counter["falsePositive" if predicted else "trueNegative"] += 1
    elif predicted & set(label):
        counter["truePositive"] += 1
    else:
        counter["falseNegative"] += 1
        if predicted:
            counter["wrongPawn"] += 1


def witness(analysis, scope, uci, method):
    if scope == "position":
        return analysis["position" if method == "distinct" else "repeatedPosition"]
    return analysis["moves" if method == "distinct" else "repeatedMoves"].get(uci)


def scoring(app, deep, reviewed, baseline, extended=False):
    deep_by_id = {row["id"]: row for row in deep}
    truth = {row["id"]: row for row in reviewed["cases"]}
    worker = {row["id"]: row["report"] for row in baseline}
    looked = []
    algorithms = ("presence", "repeated", "distinct")
    totals = {name: {scope: Counter() for scope in ("position","move")} for name in algorithms}
    outcomes = {scope: Counter() for scope in ("position","move")}
    elapsed = []
    for frame in app:
        started = perf_counter()
        result = compare(frame, extended)
        elapsed.append((perf_counter() - started) * 1000)
        root = frame["candidates"][0]["pvUci"][0]
        deeper = compare(deep_by_id[frame["id"]], extended)
        label = truth.get(frame["id"])
        observed = {scope: notation(frame, witness(result,scope,root,"distinct")) for scope in ("position","move")}
        compared = {scope: notation(frame, witness(result,scope,root,"repeated")) for scope in ("position","move")}
        confirmed = {scope: notation(frame, witness(deeper,scope,root,"distinct")) for scope in ("position","move")}
        old = worker[frame["id"]]
        old_move = next((move for move in old["moves"] if move["moveUci"] == root), None) if old else None
        for scope in ("position","move"):
            if label:
                simple = {chess.square_name(sq) for sq in assets(initial(frame))}
                score_scope(totals["presence"][scope], simple, label[scope])
                for arm in ("repeated","distinct"):
                    opinion = witness(result,scope,root,arm)
                    target = {opinion["pawn"]} if opinion else set()
                    score_scope(totals[arm][scope],target,label[scope])
            if not observed[scope]:
                continue
            outcomes[scope]["calls"] += 1
            if frame["category"] == "ordinary":
                outcomes[scope]["ordinaryCalls"] += 1
            if confirmed[scope] and confirmed[scope]["pawn"] == observed[scope]["pawn"]:
                outcomes[scope]["repeatAtDepth"] += 1
            before = old["position"] if scope == "position" and old else old_move
            if before and before["tactical"]["support"] == "supported" and before["positional"]["support"] != "supported":
                outcomes[scope]["couldAddMixed"] += 1
        if label or any(observed.values()) or any(compared.values()):
            looked.append(dict(id=frame["id"], group=frame["group"], site=frame["site"], exactUci=root,
                review=label, strict=observed, repeated=compared, deeper=confirmed,
                baseline=dict(position=old["position"]["category"] if old else None, move=old_move["category"] if old_move else None)))
    return dict(blind=totals, allBoards=outcomes, medianMs=round(median(elapsed), 3), cases=looked)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "deep", "reference", "baseline", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--blockade-handoff", action="store_true")
    args = parser.parse_args()
    result = scoring(read(args.app),read(args.deep),read(args.reference),read(args.baseline),args.blockade_handoff)
    write(args.output, result)
    print({key:value for key,value in result.items() if key != "cases"})
