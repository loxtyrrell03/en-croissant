"""Train candidate rankers on verified refutations and freeze held-out nominations.

Only board information and the six-choice 90k-node search go into a ranking.
The ordinary root search identifies the candidates already covered. The test
input contains no deep verification, game move, rating or reviewed labels.
"""

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import chess
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


VALUES = {None: 0, chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
          chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
SEEDS = (19, 73, 113)
PLIES = 6


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bounded_score(line):
    if line["mate"] is not None:
        return 12 if line["mate"] > 0 else -12
    return float(np.clip(line["cp"] / 100, -12, 12))


def describe_pv(board, line):
    position = board.copy(stack=False)
    features = []
    cumulative_gain = 0
    for uci in line["pvUci"][:PLIES]:
        move = position.parse_uci(uci)
        piece = position.piece_type_at(move.from_square)
        victim = chess.PAWN if position.is_en_passant(move) else position.piece_type_at(move.to_square)
        gain = VALUES[victim]
        if move.promotion:
            gain += VALUES[move.promotion] - 1
        cumulative_gain += gain if position.turn == board.turn else -gain
        color = position.turn
        position.push(move)
        support = len(position.attackers(color, move.to_square))
        attackers = len(position.attackers(not color, move.to_square))
        threats = position.attacks(move.to_square) & position.occupied_co[not color]
        threat_pieces = [position.piece_type_at(square) for square in threats]
        features.append([1, int(position.is_check()), gain, cumulative_gain, VALUES[piece],
                         support, attackers, len(threats), max(map(VALUES.get, threat_pieces), default=0)])
    return np.asarray(features + [[0] * 9] * (PLIES - len(features)), dtype=float)


def features(row):
    board = chess.Board(row["fen"])
    ordinary = row["original"]
    shortlist = row["shortlist"]
    if ordinary[0]["depth"] < 18 or ordinary[0]["cp"] is None or not shortlist:
        return []
    leading = bounded_score(shortlist[0])
    excluded = {line["pvUci"][0] for line in ordinary}
    rows = []
    for rank, line in enumerate(shortlist, 1):
        move = line["pvUci"][0]
        if move in excluded:
            continue
        pv = describe_pv(board, line)
        # Mirror-neutral features keep the same meaning across colors and files.
        gap = leading - bounded_score(line)
        common = [rank, gap, leading, line["depth"], int(board.is_check()),
                  board.legal_moves.count(), len(board.piece_map()),
                  bounded_score(ordinary[0]) - bounded_score(ordinary[1]) if len(ordinary) > 1 else 0]
        moments = np.r_[pv[0], pv[1:4].mean(axis=0), pv[4:].mean(axis=0)]
        # Prefer a loss visible in the shallow reply when score gaps are similar.
        early_loss = min(0.0, pv[:4, 3].min())
        rule = float(np.clip(gap, 0, 4) - early_loss - 0.25 * (rank - 1))
        rows.append(dict(move=move, stockfish=-rank, shallow_reply=rule,
                         pooled=np.r_[common, moments], ordered=np.r_[common, pv.flatten()]))
    return rows


def models():
    return {
        "logistic_ordered": ("ordered", [
            make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=500)),
        ]),
        "tree_ordered": ("ordered", [
            HistGradientBoostingClassifier(learning_rate=0.08, max_iter=90,
                                           max_leaf_nodes=7, min_samples_leaf=12, l2_regularization=2),
        ]),
        **{
            f"neural_{shape}": (shape, [
                make_pipeline(StandardScaler(), MLPClassifier(
                    hidden_layer_sizes=(16, 8), activation="tanh", solver="lbfgs",
                    alpha=3.0, max_iter=400, random_state=seed,
                )) for seed in SEEDS
            ]) for shape in ("pooled", "ordered")
        },
    }


def fit_and_rank(training, testing, model_specs):
    fitted = {}
    truth = np.asarray([row["proof"] for row in training])
    if len(set(truth)) < 2:
        raise ValueError("Training needs examples with and without verified refutations")
    for name, (shape, estimators) in model_specs.items():
        vectors = np.stack([row[shape] for row in training])
        fitted[name] = (shape, [estimator.fit(vectors, truth) for estimator in estimators])
    result = []
    for case in testing:
        rows = case["features"]
        scores = {name: [row[name] for row in rows] for name in ("stockfish", "shallow_reply")}
        for name, (shape, estimators) in fitted.items():
            if rows:
                vectors = np.stack([row[shape] for row in rows])
                scores[name] = np.mean([model.predict_proba(vectors)[:, 1] for model in estimators], axis=0)
            else:
                scores[name] = []
        rankings = {
            name: [rows[i]["move"] for i in sorted(range(len(rows)), key=lambda i: (-values[i], i))]
            for name, values in scores.items()
        }
        result.append(dict(id=case["id"], event=case["event"], rankings=rankings))
    return result


def load_boards(path, development):
    raw = path.read_bytes()
    source = json.loads(raw)
    boards = source["results"]
    if any(("searches" in board) != development for board in boards):
        raise ValueError("Only the development split may contain verification searches")
    return raw, source["engineSha256"], boards


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("development", type=Path)
    parser.add_argument("labels", type=Path)
    parser.add_argument("holdout", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new output path outside the checkout")
    development_raw, engine, development = load_boards(args.development, True)
    holdout_raw, test_engine, holdout = load_boards(args.holdout, False)
    labels_raw = args.labels.read_bytes()
    label_source = json.loads(labels_raw)
    if engine != test_engine or label_source["searchSha256"] != sha(development_raw):
        raise ValueError("Engine or development evidence identity differs")
    for key in ("id", "sourceGroup", "event"):
        if {row[key] for row in development} & {row[key] for row in holdout}:
            raise ValueError(f"Holdout overlaps with development by {key}")
    board_keys = lambda rows: {tuple(chess.Board(row["fen"]).fen().split()[:4]) for row in rows}
    if board_keys(development) & board_keys(holdout):
        raise ValueError("Holdout overlaps with development by board")
    labels = {row["id"]: row["outcomes"] for row in label_source["labels"]}
    if labels.keys() != {row["id"] for row in development}:
        raise ValueError("Incomplete development labels")
    dev_cases = [
        dict(id=board["id"], event=board["event"], features=[
            row | {"proof": bool(labels[board["id"]][row["move"]]["proof"])} for row in features(board)
        ]) for board in development
    ]
    events = sorted({row["event"] for row in dev_cases})
    grouped = []
    for event in events:
        train = [item for row in dev_cases if row["event"] != event for item in row["features"]]
        validate = [row for row in dev_cases if row["event"] == event]
        grouped.extend(fit_and_rank(train, validate, models()))
    training = [item for row in dev_cases for item in row["features"]]
    started = time.perf_counter()
    frozen = fit_and_rank(training, [row | {"features": features(row)} for row in holdout], models())
    with args.output.open("x", encoding="utf8", newline="\n") as stream:
        json.dump(dict(
            protocol=1, engineSha256=engine, developmentSha256=sha(development_raw),
            labelsSha256=sha(labels_raw), holdoutSha256=sha(holdout_raw),
            rankerSha256=sha(Path(__file__).read_bytes()), sklearn=sklearn.__version__,
            seeds=SEEDS, trainingExamples=len(training), trainingProofs=sum(row["proof"] for row in training),
            developmentEvents=events, sampledFitAndRankMs=(time.perf_counter() - started) * 1000,
            development=grouped, holdout=frozen,
        ), stream, indent=2)
    print(f"Trained on {len(training)} candidates with {sum(row['proof'] for row in training)} verified refutations")


if __name__ == "__main__":
    main()
