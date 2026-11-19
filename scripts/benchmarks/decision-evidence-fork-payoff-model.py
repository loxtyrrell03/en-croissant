"""Compare exact fork payoff models using equally cheap legal reply searches."""

import argparse
from collections import Counter
import importlib
import json
from pathlib import Path
from time import perf_counter

import chess
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss
from threadpoolctl import threadpool_limits
import torch
from torch import nn

payoff = importlib.import_module("decision-evidence-fork-payoff")
sequence = importlib.import_module("decision-evidence-motif-sequence")
SEEDS = (17, 59, 97)


def reply_features(board, root, targets, frame):
    if frame is None:
        return [0] * 8, 0
    result = payoff.replay_payoff(board, root, targets, frame["pv"])
    take = result["collected"]
    settled = result["settled"] or 0
    gain = result["movement"]
    ev = (-frame["cp"] if frame["mate"] is None else -1200 * np.sign(frame["mate"])) / 100
    vector = [1, ev, int(take is not None), take[0] if take else 0, settled / 100,
              min(gain) / 100, max(gain) / 100, int(result["forkerSurvives"])]
    cue = 2 * int(bool(take and take[0] <= 5)) + int(settled >= 100) + int(ev >= .65)
    return vector, cue


def features(row):
    board = chess.Board(row["fen"])
    root = board.parse_uci(row["move"])
    targets = payoff.geometry(board, root)
    if not targets:
        raise ValueError("Training and scoring inputs must be geometry candidates")
    lines = row["quick"] or [None]
    branches, cues = [], []
    for frame in lines:
        tactical, cue = reply_features(board, root, targets, frame)
        pv = [root.uci(), *(frame["pv"] if frame else [])]
        values, mask = sequence.encode(board.fen(), pv[:1 + payoff.HORIZON])
        branches.append(np.concatenate((tactical, mask, values.reshape(-1))))
        cues.append(cue)
    if len(branches) == 1:
        branches.append(np.zeros_like(branches[0]))
    return np.asarray(branches, dtype=np.float32), min(cues)


def load_cache(path, split=None):
    receipt = payoff.read(path / "receipt.json")
    rows = [payoff.read(path / (row + ".json")) for row in receipt["ids"]]
    if split and any(row["identity"]["split"] != split for row in rows):
        raise ValueError("Unexpected split in transfer")
    return rows


def enforce_groups(train_and_test, transfer):
    games, positions = {}, {}
    for row in [*train_and_test, *transfer]:
        identity = row["identity"]
        group, board, split = identity["game"], identity["boardKey"], identity["split"]
        for seen, item in ((games, group), (positions, board)):
            if seen.setdefault(item, split) != split:
                raise ValueError("Source game or identical mirrored board appears in multiple partitions")


class ReplyNetwork(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.shared = nn.Sequential(nn.Linear(width, 24), nn.GELU(), nn.Linear(24, 12), nn.GELU())
        self.head = nn.Sequential(nn.Linear(24, 12), nn.GELU(), nn.Linear(12, 1))

    def forward(self, x):
        mask = x[:, :, 0] > 0
        branches = self.shared(x) * mask.unsqueeze(-1)
        # Preserve which defender reply ranked first. The accompanying branch
        # captures how the purported fork changes under a second defence.
        return self.head(branches.flatten(1)).squeeze(-1)


def fit_net(x, y, val_x, val_y, seed):
    torch.manual_seed(seed)
    model = ReplyNetwork(x.shape[-1])
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=.015)
    x, y, val_x, val_y = map(torch.from_numpy, [x, y, val_x, val_y])
    criterion = nn.BCEWithLogitsLoss()
    best, checkpoint, best_epoch = float("inf"), None, 0
    for epoch in range(1, 41):
        model.train()
        for batch in torch.randperm(len(y)).split(128):
            optimizer.zero_grad(set_to_none=True)
            criterion(model(x[batch]), y[batch]).backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            loss = float(criterion(model(val_x), val_y))
        if loss < best - 1e-4:
            best, checkpoint, best_epoch = loss, {key: value.clone() for key, value in model.state_dict().items()}, epoch
        if epoch - best_epoch >= 8:
            break
    model.load_state_dict(checkpoint)
    return model, dict(seed=seed, validationLogLoss=best, bestEpoch=best_epoch,
                       parameters=sum(parameter.numel() for parameter in model.parameters()))


def normalise(train, values):
    valid = train[train[:, :, 0] > 0]
    means = valid.mean(axis=0)
    scales = np.maximum(valid.std(axis=0), .1)
    z = np.where(values[:, :, :1] > 0, (values - means) / scales, 0)
    z[:, :, 0] = values[:, :, 0]
    return z


def score(rows, predictions, *, manual=None, unresolved=None, probability=False):
    if manual is None:
        truth = [row["label"] for row in rows]
    else:
        truth = [manual[row["identity"]["id"]] for row in rows]
    indices = [index for index, row in enumerate(rows)
               if unresolved is None or row["identity"]["id"] in unresolved]
    ranked = sorted(indices, key=lambda i: (-predictions[i], payoff.key(rows[i]["identity"]["id"])))
    reviewed = [i for i in indices if truth[i] is not None]
    labels = [truth[i] for i in reviewed]
    budget = len(indices) // 4
    selected = [truth[i] for i in ranked[:budget]]
    result = dict(positions=len(indices), available=dict(positives=labels.count(True), negatives=labels.count(False),
                    uncertain=len(indices) - len(reviewed)), quarterBudget=budget,
                  picks=dict(positives=selected.count(True), negatives=selected.count(False),
                             uncertain=selected.count(None)))
    if len(set(labels)) > 1:
        result["ap"] = float(average_precision_score(labels, [float(predictions[i]) for i in reviewed]))
    if probability and labels:
        result["brier"] = float(brier_score_loss(labels, [float(predictions[i]) for i in reviewed]))
    groups = {}
    for i in indices:
        info = rows[i]["identity"]
        if info["origin"] == "alternative":
            groups.setdefault(info["game"], {})["alternative"] = i
        elif info["origin"] == "solution":
            groups.setdefault(info["game"], {})["solution"] = i
    ordered_pairs = []
    for pair in groups.values():
        if len(pair) == 2:
            first, second = pair["solution"], pair["alternative"]
            if truth[first] is not None and truth[second] is not None and truth[first] != truth[second]:
                forward = predictions[first] > predictions[second]
                reverse = predictions[second] > predictions[first]
                ordered_pairs.append(float(forward if truth[first] else reverse) if forward or reverse else .5)
    if ordered_pairs:
        result["counterfactualPairs"] = dict(total=len(ordered_pairs), fractionCorrect=float(np.mean(ordered_pairs)))
    return result


def fit_and_score(puzzles, classical, reference, incumbent):
    enforce_groups(puzzles, classical)
    all_rows = puzzles + classical
    start = perf_counter()
    arrays, quick_cues = zip(*(features(row) for row in all_rows), strict=True)
    total_feature_ms = (perf_counter() - start) * 1000
    raw = np.stack(arrays)
    split = np.asarray([row["identity"]["split"] for row in all_rows])
    known = np.asarray([row["label"] is not None for row in all_rows])
    labels = np.asarray([row["label"] is True for row in all_rows], dtype=np.float32)
    train = (split == "train") & known
    val = (split == "validation") & known
    x = normalise(raw[train], raw)
    flat = x.reshape(len(x), -1)
    root = flat[:, 8 + sequence.PLIES:8 + sequence.PLIES + (flat.shape[1] // 2 - 8 - sequence.PLIES) // sequence.PLIES]
    root = np.concatenate((root[:, :-4], root[:, -2:]), axis=1)
    predictions = {"quick-payoff": np.asarray(quick_cues), "quick-evaluation": raw[:, 0, 1]}
    for name, matrix in (("root-logistic", root), ("reply-logistic", flat)):
        regressor = LogisticRegression(C=.1, max_iter=500)
        predictions[name] = regressor.fit(matrix[train], labels[train]).predict_proba(matrix)[:, 1]
    ensemble = [fit_net(x[train], labels[train], x[val], labels[val], seed) for seed in SEEDS]
    start = perf_counter()
    with torch.no_grad():
        model_x = torch.from_numpy(x)
        predictions["reply-network"] = torch.stack([model(model_x).sigmoid() for model, _ in ensemble]).mean(0).numpy()
    inference_ms = (perf_counter() - start) * 1000 / len(all_rows)
    review = {row["id"]: row["fork"] for row in reference}
    unresolved = set(review) - {key for key, value in incumbent.items() if value}
    # Every model and control uses the same held-out placements and review slots.
    result = {}
    for name, values in predictions.items():
        probability = name.endswith("logistic") or name.endswith("network")
        sections = {}
        for part in ("test", "classical"):
            indices = np.flatnonzero(split == part)
            sections[part] = score([all_rows[index] for index in indices], values[indices], probability=probability)
        if review:
            indices = [index for index, row in enumerate(all_rows) if row["identity"]["id"] in review]
            examples = [all_rows[index] for index in indices]
            sections["manual"] = score(examples, values[indices], manual=review, probability=probability)
            if unresolved:
                sections["manualUnresolved"] = score(examples, values[indices], manual=review, unresolved=unresolved,
                                                     probability=probability)
        result[name] = sections
    model_predictions = {name: {row["identity"]["id"]: float(value)
                                for row, value in zip(all_rows, scores, strict=True) if row["identity"]["split"] == "classical"}
                         for name, scores in predictions.items()}
    return dict(counts=dict(Counter(split)), featuresPerReply=x.shape[-1], meanFeaturesMs=total_feature_ms / len(all_rows),
                meanBatchedModelMs=inference_ms, fits=[metadata for _, metadata in ensemble], scores=result,
                classicalPredictions=model_predictions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("puzzles", type=Path)
    parser.add_argument("classical", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--incumbent", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to overwrite experiment results")
    puzzles = load_cache(args.puzzles)
    classical = load_cache(args.classical, "classical")
    reference = payoff.read(args.reference)["cases"]
    incumbent = payoff.read(args.incumbent)
    if set(incumbent) != {row["id"] for row in reference}:
        raise ValueError("Expected incumbent output for every reviewed exact move")
    torch.set_num_threads(4)
    with threadpool_limits(limits=4):
        report = fit_and_score(puzzles, classical, reference, incumbent)
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(report, file, indent=2, default=int)


if __name__ == "__main__":
    main()
