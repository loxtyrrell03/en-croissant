"""Fit fixed linear and neural selectors with board and event grouping."""

import argparse
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from legal_pool import material_order
from freeze import read, write

ARMS = ("material", "linear", "neural")


def fit_rows(rows):
    return [row for row in rows if row["label"] in ("positive", "order-harmless")
            or (row["label"] == "uncompetitive-reply" and row["source"] == "new-screen")]


def data(rows):
    features = np.asarray([row["features"] for row in rows])
    target = np.asarray([row["label"] == "positive" for row in rows], dtype=np.int64)
    board_count = Counter(row["id"] for row in rows)
    weight = np.asarray([1 / board_count[row["id"]] for row in rows])
    for label in (0, 1):
        members = target == label
        weight[members] *= 0.5 / weight[members].sum()
    return features, target, weight * len(target)


def train(rows):
    x, target, weight = data(rows)
    linear = make_pipeline(StandardScaler(), LogisticRegression(C=0.2, max_iter=1200, random_state=41))
    linear.fit(x, target, logisticregression__sample_weight=weight)
    neural = []
    for seed in (41, 59, 73):
        model = make_pipeline(StandardScaler(), MLPClassifier(
            hidden_layer_sizes=(24, 12), activation="relu", solver="lbfgs",
            alpha=4, max_iter=3600, tol=5e-4, random_state=seed,
        ))
        model.fit(x, target, mlpclassifier__sample_weight=weight)
        neural.append(model)
    return dict(linear=linear, neural=neural)


def predict(models, rows):
    if not rows:
        return {arm: [] for arm in ARMS}
    x = np.asarray([row["features"] for row in rows])
    return dict(material=[material_order(row) for row in rows],
                linear=models["linear"].predict_proba(x)[:, 1],
                neural=np.mean([model.predict_proba(x)[:, 1] for model in models["neural"]], axis=0))


def evaluate(rows, options):
    scores = {arm: Counter() for arm in ARMS}
    for arm, predictions in options.items():
        boards = {}
        for row, strength in zip(rows, predictions, strict=True):
            prior = boards.get(row["id"])
            if prior is None or strength > prior[0]:
                boards[row["id"]] = (strength, row)
        for _, row in boards.values():
            scores[arm][row["label"]] += 1
    return scores


def validation(rows):
    results = {arm: Counter() for arm in ARMS}
    aps = {arm: [] for arm in ARMS[1:]}
    iterations = []
    groups = [row["group"] for row in rows]
    for train_index, test_index in GroupKFold(n_splits=5).split(rows, groups=groups):
        train_set = [rows[index] for index in train_index]
        test_set = [rows[index] for index in test_index]
        models = train(train_set)
        iterations.append([model[-1].n_iter_ for model in models["neural"]])
        # Validation reproduces deployment by selecting among unseen replies.
        test_set = [row for row in test_set if row["unseen"]]
        predictions = predict(models, test_set)
        scores = evaluate(test_set, predictions)
        for arm, counter in scores.items():
            results[arm].update(counter)
        target = [row["label"] == "positive" for row in test_set]
        if any(target) and not all(target):
            for arm in aps:
                aps[arm].append(round(average_precision_score(target, predictions[arm]), 4))
    return dict(knownCandidates=results, averagePrecisionByFold=aps, neuralIterations=iterations)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    candidates = read(args.data)
    eligible = fit_rows(candidates)
    models = train(eligible)
    with args.model.open("xb") as packed:
        joblib.dump(models, packed, compress=3)
    receipt = dict(rows=len(candidates), used=len(eligible), boards=len({row["id"] for row in eligible}),
        groups=len({row["group"] for row in eligible}), labels=dict(Counter(row["label"] for row in eligible)),
        unseenLabels=dict(Counter(row["label"] for row in eligible if row["unseen"])),
        finalNeuralIterations=[model[-1].n_iter_ for model in models["neural"]],
        groupedDevelopment=validation(eligible))
    write(args.output, receipt)
    print(receipt, flush=True)
