"""Compare equal-budget confirmation queues using only cheap Stockfish frames."""
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
from time import perf_counter

import chess
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

from search_pairs import CLOSE, VALUES, cp, initial, records, trace

SEEDS = (31, 73, 109)
FEATURES = (
    "rootLoss", "replyLoss", "rootReplyDifference", "rank", "controlEval",
    "rootMaterialContrast", "replyMaterialContrast", "rootRepliesAgree",
    "replyCaptures", "replyChecks", "sameReplyLegal", "sameReplyCaptures",
    "candidateCapture", "candidateCheck", "targetValue",
    "numberOfLegalResponses", "pieces",
)
OUTCOME = {"competitive": 0, "verified": 1, "unresolved": None}


def victim_value(board, move):
    if board.is_en_passant(move):
        return 1
    return VALUES.get(board.piece_type_at(move.to_square), 0)


def end_material(board, line, horizon):
    return trace(board, line, horizon)[0][-1]


def material_margin(board, control, alt):
    horizon = min(8, len(alt), len(control))
    return end_material(board, control, horizon) - end_material(board, alt, horizon)


def encode(row):
    board = initial(row)
    choices = row["preview"]
    quick = {move: reply[0] for move, reply in row["previewReplies"].items() if reply}
    if len(choices) < 2 or any(x["pvUci"][0] not in quick for x in choices):
        return []
    labels = {pair["move"]: OUTCOME[pair["outcome"]] for pair in row["pairs"]}
    reference = row["reference"]
    if reference and row.get("referenceReplies"):
        top = reference[0]["pvUci"][0]
        refs = {move: reply[0] for move, reply in row["referenceReplies"].items() if reply}
        if top in refs and max(-cp(line) for line in refs.values()) + cp(refs[top]) <= CLOSE:
            labels[top] = 0
    result = []
    for rank, line in enumerate(choices):
        control = choices[1 if rank == 0 else 0]
        move = line["pvUci"][0]
        other = control["pvUci"][0]
        candidate = board.parse_uci(move)
        after = board.copy(stack=False)
        after.push(candidate)
        counterfactual = board.copy(stack=False)
        counterfactual.push_uci(other)
        reply = after.parse_uci(quick[move]["pvUci"][0])
        reply_is_legal = reply in counterfactual.legal_moves
        root_loss = cp(control) - cp(line)
        reply_loss = cp(quick[move]) - cp(quick[other])
        root_material = material_margin(board, control["pvUci"], line["pvUci"])
        reply_material = material_margin(board, [other, *quick[other]["pvUci"]],
                                         [move, *quick[move]["pvUci"]])
        x = (
            root_loss, np.clip(reply_loss, -900, 900), np.clip(root_loss - reply_loss, -900, 900),
            rank, np.clip(cp(control), -700, 700), root_material, reply_material,
            line["pvUci"][1:2] == [reply.uci()], after.is_capture(reply), after.gives_check(reply),
            reply_is_legal, reply_is_legal and counterfactual.is_capture(reply),
            board.is_capture(candidate), board.gives_check(candidate), victim_value(after, reply),
            after.legal_moves.count(), len(board.piece_map()),
        )
        result.append({"id": row["id"], "event": row["event"], "move": move, "x": x,
                       "target": labels.get(move), "rank": rank})
    return result


def models(train, test, max_iterations):
    known = [row for row in train if row["target"] is not None]
    y = np.asarray([row["target"] for row in known])
    if min(np.bincount(y, minlength=2)) < 8:
        raise ValueError("Fewer than eight known training examples of one outcome")
    X, check = np.asarray([row["x"] for row in known]), np.asarray([row["x"] for row in test])
    scale = StandardScaler().fit(X)
    X, check = scale.transform(X), scale.transform(check)
    weights = compute_sample_weight("balanced", y)
    estimates = {}
    timings = {}
    for name, model in (
        ("line logistic", LogisticRegression(C=0.5, max_iter=500)),
        ("line boosted tree", HistGradientBoostingClassifier(
            learning_rate=0.07, max_iter=90, max_leaf_nodes=9, min_samples_leaf=12,
            early_stopping=False, l2_regularization=2,
        )),
        *[(f"network {seed}", MLPClassifier(
            hidden_layer_sizes=(24, 12), solver="lbfgs", alpha=4.0, random_state=seed,
            max_iter=max_iterations, max_fun=40000,
        )) for seed in SEEDS],
    ):
        start = perf_counter()
        model.fit(X, y, sample_weight=weights)
        train_seconds = perf_counter() - start
        start = perf_counter()
        estimates[name] = model.predict_proba(check)[:, 1]
        timings[name] = {"trainSeconds": round(train_seconds, 4),
                         "predictionMs": round((perf_counter() - start) * 1000, 3)}
        if isinstance(model, MLPClassifier):
            timings[name]["iterations"] = model.n_iter_
    estimates["neural ensemble"] = np.mean([estimates.pop(f"network {seed}") for seed in SEEDS], axis=0)
    return estimates, timings


def evaluate(rows, scores):
    groups = defaultdict(list)
    for row, score in zip(rows, scores, strict=True):
        groups[row["id"]].append((row, float(score)))
    chosen = [min(group, key=lambda x: (-x[1], x[0]["rank"], x[0]["move"]))[0]
              for group in groups.values()]
    has_contrast = sum({row["target"] for row, _ in group} >= {0, 1} for group in groups.values())
    known = [(row["target"], score) for row, score in zip(rows, scores, strict=True)
             if row["target"] is not None]
    truth, values = zip(*known) if known else ((), ())
    known_labels = len(set(truth)) == 2
    by_event = defaultdict(Counter)
    for row in chosen:
        by_event[row["event"]][str(row["target"])] += 1
    return {
        "candidateAveragePrecision": round(average_precision_score(truth, values), 5) if known_labels else None,
        "candidateAuc": round(roc_auc_score(truth, values), 5) if known_labels else None,
        "onePerBoard": Counter(str(row["target"]) for row in chosen),
        "knownContrastBoards": has_contrast,
        "selectedByEvent": {event: dict(counts) for event, counts in sorted(by_event.items())},
        "selected": [{key: row[key] for key in ("id", "event", "move", "target")} for row in chosen],
    }


def audit(train, holdout):
    from frames import board_key
    if any(row.get("trainingMove") for row in holdout):
        raise ValueError("The ordinary transfer cannot receive a recorded move")
    checks = {
        "game": lambda row: row["game"],
        "event": lambda row: row["event"],
        "position": lambda row: board_key(chess.Board(row["fen"])),
    }
    for name, key in checks.items():
        train_set, test_set = set(map(key, train)), set(map(key, holdout))
        if train_set & test_set:
            raise ValueError(f"Training and transfer overlap on {name}")
        if name != "event" and (len(train_set) != len(train) or len(test_set) != len(holdout)):
            raise ValueError(f"Repeated {name} within the same split")


def rank(training, transfer, max_iterations=800):
    audit(training, transfer)
    # Deliberately hold out whole tournament families from development evaluation.
    development_families = sorted({row["event"] for row in training},
                                  key=lambda event: sha256(("model-dev-v1|" + event).encode()).digest())
    n_dev = max(1, (len(development_families) + 4) // 5)
    development = set(development_families[:n_dev])
    train, dev, test = ([item for row in data for item in encode(row)] for data in (
        [row for row in training if row["event"] not in development],
        [row for row in training if row["event"] in development], transfer,
    ))

    def compare(fit, score):
        fitted, timing = models(fit, score, max_iterations)
        x = np.asarray([row["x"] for row in score])
        estimates = {
            "preview root loss": x[:, 0],
            "short reply loss": x[:, 1],
            "short legal material": np.maximum(x[:, 5], x[:, 6]),
            **fitted,
        }
        return {"candidateLabels": Counter(str(row["target"]) for row in score),
                "results": {name: evaluate(score, scores) for name, scores in estimates.items()},
                "modelTiming": timing}

    return {
        "trainCandidates": Counter(str(row["target"]) for row in train + dev),
        "developmentFamilies": sorted(development),
        "development": compare(train, dev),
        "transfer": compare(train + dev, test),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("training", type=Path)
    parser.add_argument("transfer", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-iterations", type=int, default=800)
    args = parser.parse_args()
    receipt = rank(records(args.training), records(args.transfer), args.max_iterations)
    receipt["files"] = {path.name: sha256(path.read_bytes()).hexdigest()
                        for path in (args.training, args.transfer)}
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(receipt, out, indent=2)
        out.write("\n")
