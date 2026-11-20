"""Compare localized frozen chess representations at a fixed search budget."""
import argparse
from collections import defaultdict
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys
from time import perf_counter

import chess
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from assets import cohorts, counts, direction


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
LOCAL = "line + localized Leela"
SIMPLE = ("line logistic", "line tree", "shallow advance count", "pawn rank", "clear file")


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def relative_square(board, square):
    return square if board.turn else chess.square_mirror(square)


def neural_inputs(encoder, leela, assets):
    # Preserve the move history in the model input. Identical piece placement
    # after two candidate moves need not imply identical historical planes.
    by_branch = defaultdict(list)
    for index, asset in enumerate(assets):
        by_branch[(asset.game, asset.branch)].append(index)
    size = len(assets)
    raw, pooled = np.empty((size, 36)), np.empty((size, 256))
    local, evaluation = np.empty((size, 768)), np.empty((size, 3))
    grouped = list(by_branch.values())
    start = perf_counter()
    for offset in range(0, len(grouped), 16):
        members = grouped[offset:offset + 16]
        inputs = np.stack([leela.planes(assets[indices[0]].child) for indices in members])
        hidden, wdl = encoder.session.run(
            [leela.ATTENTION_OUTPUT, leela.WDL_OUTPUT], {"/input/planes": inputs})
        tokens = hidden.reshape(len(inputs), 64, 256)
        for batch_index, indices in enumerate(members):
            for index in indices:
                asset = assets[index]
                board = asset.child
                locations = [
                    asset.square, asset.square + direction(asset.color), board.king(not asset.color),
                ]
                locations = [relative_square(board, square) for square in locations]
                raw[index] = inputs[batch_index].reshape(112, 64)[:12, locations].T.reshape(-1)
                pooled[index] = tokens[batch_index].mean(axis=0)
                local[index] = tokens[batch_index, locations].reshape(-1)
                evaluation[index] = wdl[batch_index][::1 if board.turn == asset.color else -1]
    return {
        "line + local board planes": raw,
        "line + Leela evaluation": evaluation,
        "line + pooled Leela": pooled,
        LOCAL: local,
    }, {
        "boards": len(by_branch),
        "totalMsPerBoard": round((perf_counter() - start) * 1000 / len(by_branch), 3),
    }


def fit_and_rank(training, testing, features, split):
    train_known = np.array([asset.target is not None for asset in training])
    train_labels = np.asarray([asset.target for asset in training])[train_known].astype(int)
    train_board = np.asarray([asset.board_features for asset in training])
    test_board = np.asarray([asset.board_features for asset in testing])
    train_lines = np.column_stack([train_board, [asset.line_features for asset in training]])
    test_lines = np.column_stack([test_board, [asset.line_features for asset in testing]])
    ranks = {
        # Common deterministic tie-breaker uses the opaque case ID, never a target.
        "training base rate": (np.full(len(testing), train_labels.mean()), True),
        "pawn rank": (test_board[:, 0], False),
        "clear file": (test_board[:, 1], False),
        "shallow advance count": (np.asarray([
            sum(asset.line_features[i + 2] and asset.line_features[i + 3] for i in (0, 5))
            for asset in testing
        ]), False),
    }
    static_scale = StandardScaler().fit(train_board[train_known])
    line_scale = StandardScaler().fit(train_lines[train_known])
    scaled_train = line_scale.transform(train_lines[train_known])
    scaled_test = line_scale.transform(test_lines)
    regressions = {
        "static logistic": (static_scale.transform(train_board[train_known]), static_scale.transform(test_board)),
        "line logistic": (scaled_train, scaled_test),
    }
    for arm, input_matrix in features.items():
        train_features = input_matrix[:len(training)][train_known]
        test_features = input_matrix[split:split + len(testing)]
        scale = StandardScaler().fit(train_features)
        # Balance full blocks by feature count so an embedding cannot dominate
        # solely because it is wider than the shallow search inputs.
        gain = min(1, np.sqrt(scaled_train.shape[1] / train_features.shape[1]))
        regressions[arm] = (
            np.column_stack([scaled_train, scale.transform(train_features) * gain]),
            np.column_stack([scaled_test, scale.transform(test_features) * gain]),
        )
    for arm, (train, test) in regressions.items():
        model = LogisticRegression(C=.1, max_iter=1000).fit(train, train_labels)
        ranks[arm] = (model.predict_proba(test)[:, 1], True)
    tree = HistGradientBoostingClassifier(
        max_iter=100, max_leaf_nodes=7, learning_rate=.08, l2_regularization=1, random_state=47,
    ).fit(train_lines[train_known], train_labels)
    ranks["line tree"] = (tree.predict_proba(test_lines)[:, 1], True)
    return ranks


def summarize(assets, ranks, probabilistic):
    known = np.array([a.target is not None for a in assets])
    truth = np.asarray([item.target for item in assets])[known].astype(int)
    families, pairs = defaultdict(list), defaultdict(list)
    for index, asset in enumerate(assets):
        families[asset.event].append(index)
        pairs[(asset.game, asset.original)].append(index)
    selected = []
    by_event = {}
    for event, candidates in sorted(families.items()):
        def order(index):
            item = assets[index]
            tie = sha256(f"{item.id}:{item.branch}:{item.original}".encode()).digest()
            return -ranks[index], tie
        chosen = sorted(candidates, key=order)[:(len(candidates) + 3) // 4]
        selected.extend(chosen)
        by_event[event] = counts([assets[index] for index in chosen])
    contrasts = []
    for comparable in pairs.values():
        if len(comparable) != 2:
            continue
        left, right = comparable
        if {assets[left].target, assets[right].target} == {True, False}:
            delta = ranks[left] - ranks[right] if assets[left].target else ranks[right] - ranks[left]
            contrasts.append(1 if delta > 0 else .5 if delta == 0 else 0)
    return {
        "averagePrecision": float(average_precision_score(truth, ranks[known])),
        "brier": float(brier_score_loss(truth, ranks[known])) if probabilistic else None,
        "selected": counts([assets[index] for index in selected]),
        "events": by_event,
        "samePawnOppositeLabelPairs": len(contrasts),
        "samePawnOrdering": sum(contrasts),
        "nominations": [
            {"case": assets[i].id, "branch": assets[i].branch, "pawn": chess.square_name(assets[i].square),
             "origin": assets[i].original, "target": assets[i].target}
            for i in selected
        ],
    }


def compare(arms, arm, control):
    candidate, baseline = arms[arm], arms[control]
    return {
        "positiveDifference": candidate["selected"]["positive"] - baseline["selected"]["positive"],
        "negativeDifference": candidate["selected"]["negative"] - baseline["selected"]["negative"],
        "eventsImproved": sum(
            count["positive"] > baseline["events"][event]["positive"]
            for event, count in candidate["events"].items()
        ),
    }


def experiment(directory, network):
    manifest = json.loads((HERE / "protocol.json").read_text(encoding="utf-8"))
    for path in [network, *(directory / f"{name}.jsonl" for name in ("train", "test", "reserve"))]:
        if sha256(path.read_bytes()).hexdigest() != manifest["inputs"][path.name]:
            raise ValueError(f"Frozen input has changed: {path.name}")
    frames = load_module("deep_witness_frames", HERE.parent / "neural-deep-witness" / "frames.py")
    leela = load_module("leela_probe", REPO / "scripts/benchmarks/decision-evidence-leela-probe.py")
    training, ordinary, enriched = cohorts(directory, frames.family)
    encoder = leela.Encoder(network)
    with threadpool_limits(limits=1):
        features, cost = neural_inputs(encoder, leela, training + ordinary + enriched)
        result = {}
        offset = len(training)
        for name, testing in (("ordinary", ordinary), ("enriched", enriched)):
            rankings = fit_and_rank(training, testing, features, offset)
            offset += len(testing)
            arms = {arm: summarize(testing, *values) for arm, values in rankings.items()}
            result[name] = {
                "cohort": counts(testing), "arms": arms,
                "localizedVersusControls": {
                    control: compare(arms, LOCAL, control)
                    for control in (*SIMPLE, "static logistic", "line + local board planes",
                                    "line + Leela evaluation", "line + pooled Leela")
                },
            }
    return {
        "training": counts(training), "cost": dict(cost, additionalStockfishNodes=0),
        "transfer": result,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("network", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = experiment(args.frames, args.network)
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(result, out, indent=2, allow_nan=False)
        out.write("\n")


if __name__ == "__main__":
    main()
