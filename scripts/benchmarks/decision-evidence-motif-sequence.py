"""Fit compact motif nominators on legal Lichess solution sequences.

The output scores are for research triage. They neither verify a motif nor
attribute one to the root move. Chessable and reviewed games are score-only.
"""

import argparse
from dataclasses import dataclass
import hashlib
import importlib
import json
from pathlib import Path
from time import perf_counter

import chess
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from threadpoolctl import threadpool_limits
import torch
from torch import nn

corpus = importlib.import_module("decision-evidence-motif-corpus")
THEMES = corpus.THEMES
PLIES = 10
VALUES = (0, 1, 3, 3, 5, 9, 12)
SLIDERS = tuple(range(chess.BISHOP, chess.KING))
MODELS = ("root-logistic", "line-logistic", "line-mlp", "temporal-net")
SEEDS = (31, 73, 109)
KEEP = 15


def material(board, color):
    return sum(VALUES[role] * (len(board.pieces(role, color)) - len(board.pieces(role, not color)))
               for role in range(chess.PAWN, chess.KING))


def targets(board, square, color):
    return board.attacks(square) & chess.SquareSet(board.occupied_co[not color])


def target_values(board, squares):
    return [VALUES[board.piece_type_at(square)] for square in squares]


def counts(values):
    return [len(values), max(values, default=0), sum(value >= 3 for value in values)]


def lined_targets(board, move, color, role):
    if role not in SLIDERS:
        return [0, 0, 0, 0]
    dest_file, dest_rank = chess.square_file(move.to_square), chess.square_rank(move.to_square)
    sequences = []
    for dx, dy in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
        diagonal = dx != 0 and dy != 0
        if (diagonal and role == chess.ROOK) or (not diagonal and role == chess.BISHOP):
            continue
        hits = []
        for distance in range(1, 8):
            file, rank = dest_file + dx * distance, dest_rank + dy * distance
            if not (0 <= file < 8 and 0 <= rank < 8):
                break
            piece = board.piece_at(chess.square(file, rank))
            if piece:
                if piece.color == color:
                    break
                hits.append(VALUES[piece.piece_type])
                if len(hits) == 2:
                    sequences.append(hits)
                    break
    return [
        sum(front < back for front, back in sequences),
        sum(front > back for front, back in sequences),
        sum(back == VALUES[chess.KING] for _, back in sequences),
        sum(front == VALUES[chess.KING] for front, _ in sequences),
    ]


def group_counts(board, color, square):
    return [len(board.attackers(color, square)), len(board.attackers(not color, square))]


def ply_features(board, move, initial, solver, previous, following):
    color = board.turn
    role = board.piece_type_at(move.from_square)
    capture = chess.PAWN if board.is_en_passant(move) else board.piece_type_at(move.to_square)
    opponent_king = board.king(not color)
    castling, checked = board.is_castling(move), board.is_check()
    before_targets = targets(board, move.from_square, color)
    source_cover = group_counts(board, color, move.from_square)
    dest_cover = group_counts(board, color, move.to_square)
    slider_targets = {
        square: targets(board, square, color)
        for slider in SLIDERS for square in board.pieces(slider, color) if square != move.from_square
    }
    was_pinned = board.is_pinned(color, move.from_square)
    target_was_pinned = bool(capture and board.is_pinned(not color, move.to_square))
    own_mat = material(board, solver)
    board.push(move)
    reached = targets(board, move.to_square, color)
    new = reached - before_targets
    disclosed = [value for square, prior in slider_targets.items() if board.color_at(square) == color
                 for value in target_values(board, targets(board, square, color) - prior)]
    blocked = [square for square, prior in slider_targets.items() if board.color_at(square) == color
               and any(board.color_at(target) == (not color) for target in prior - targets(board, square, color))]
    escapes = board.legal_moves.count()
    horizontal = abs(chess.square_file(move.to_square) - chess.square_file(move.from_square))
    vertical = abs(chess.square_rank(move.to_square) - chess.square_rank(move.from_square))
    return [
        *(int(role == piece) for piece in range(1, 7)),
        *(int(capture == piece) for piece in range(1, 7)),
        int(color == solver), int(checked), int(board.is_check()), int(board.is_checkmate()),
        int(bool(move.promotion)), int(castling), min(40, escapes), horizontal, vertical,
        chess.square_distance(move.from_square, opponent_king), chess.square_distance(move.to_square, opponent_king),
        was_pinned, target_was_pinned, *source_cover, *dest_cover,
        *group_counts(board, color, move.to_square), len(board.attacks(move.to_square)),
        *counts(target_values(board, reached)), *counts(target_values(board, new)), *counts(disclosed),
        len(blocked), *lined_targets(board, move, color, move.promotion or role),
        sum(not board.attackers(not color, square) for square in reached),
        sum(board.is_pinned(not color, square) for square in reached),
        bool(previous and previous.to_square == move.to_square),
        bool(previous and previous.to_square in reached),
        bool(following and following.to_square == move.to_square),
        bool(following and following.from_square in reached),
        material(board, solver) - own_mat, material(board, solver) - initial,
    ]


def encode(fen, line):
    board = chess.Board(fen)
    if not board.is_valid() or not line:
        raise ValueError("Expected a valid board with a continuation")
    moves = [chess.Move.from_uci(uci) for uci in line]
    solver = board.turn
    initial = material(board, solver)
    rows = []
    for index, move in enumerate(moves):
        if move not in board.legal_moves:
            raise ValueError(f"Illegal move {move} at ply {index + 1}")
        if index < PLIES:
            previous = moves[index - 1] if index else None
            following = moves[index + 1] if index + 1 < min(PLIES, len(moves)) else None
            rows.append(ply_features(board, move, initial, solver, previous, following))
        else:
            board.push(move)
    values = np.zeros((PLIES, len(rows[0])), dtype=np.float32)
    valid = np.arange(PLIES) < len(rows)
    values[valid] = rows
    return values, valid


@dataclass
class Dataset:
    rows: list
    values: np.ndarray
    mask: np.ndarray
    tags: np.ndarray

    @classmethod
    def make(cls, rows, cache=None):
        if cache and cache.is_file():
            with np.load(cache, allow_pickle=False) as saved:
                if saved["key"] != dataset_key(rows):
                    raise ValueError("Feature cache belongs to different inputs")
                return cls(rows, saved["values"], saved["mask"], saved["tags"])
        encoded = [encode(row["fen"], row["line"]) for row in rows]
        features, mask = (np.stack(part) for part in zip(*encoded, strict=True))
        labels = np.asarray([[tag in row.get("tags", []) for tag in THEMES] for row in rows], dtype=np.float32)
        if cache:
            np.savez_compressed(cache, key=dataset_key(rows), values=features, mask=mask, tags=labels)
        return cls(rows, features, mask, labels)


def dataset_key(rows):
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode() + Path(__file__).read_bytes()).hexdigest()


def check_splits(rows):
    games, boards = set(), set()
    for row in rows:
        key = corpus.board_identity(chess.Board(row["fen"]))
        if key in boards or row["game"] in games or row["split"] != corpus.partition(row["game"]):
            raise ValueError("Duplicate position or source game or inconsistent split")
        boards.add(key)
        games.add(row["game"])
    return boards, games


def inputs(data, stats):
    mean, sd = stats
    values = (data.values - mean) / sd
    values = np.where(data.mask[:, :, None], values, 0)
    mask = data.mask.astype(np.float32)
    counts = mask.sum(axis=1, keepdims=True)
    summary = np.concatenate((np.where(data.mask[:, :, None], values, -np.inf).max(axis=1),
                              values.sum(axis=1) / counts, counts / PLIES), axis=1)
    flat = np.concatenate((values.reshape((len(values), -1)), mask, summary), axis=1)
    # The first-ply baseline has no access to the two next-move features.
    root = np.concatenate((values[:, 0, :-4], values[:, 0, -2:]), axis=1)
    return values, data.mask, flat, root


class TemporalMotifs(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.encoder = nn.Sequential(nn.Linear(width, 48), nn.GELU(), nn.Linear(48, 32), nn.GELU())
        self.context = nn.Conv1d(32, 48, kernel_size=5, padding=2)
        self.classifier = nn.Sequential(nn.GELU(), nn.Dropout(0.1), nn.Linear(48, len(THEMES)))

    def local_logits(self, values, mask):
        encoded = self.encoder(values) * mask.unsqueeze(-1)
        return self.classifier(self.context(encoded.transpose(1, 2)).transpose(1, 2))

    def forward(self, values, mask):
        local = self.local_logits(values, mask)
        # The puzzle tag supervises the whole line. Its location is latent.
        solver_plies = local[:, ::2]
        valid = mask[:, ::2]
        weighted = (solver_plies * 2).masked_fill(~valid.unsqueeze(-1), float("-inf"))
        return (weighted.logsumexp(dim=1) - valid.sum(dim=1, keepdim=True).log()) / 2


def ap_by_motif(labels, scores):
    return [float(average_precision_score(target, prediction)) if np.any(target) and not np.all(target) else None
            for target, prediction in zip(labels.T, scores.T, strict=True)]


def logloss(logits, y):
    return float(nn.functional.binary_cross_entropy_with_logits(logits, y))


def train_network(name, seed, train, validation, train_y, validation_y):
    torch.manual_seed(seed)
    train_x = tuple(torch.from_numpy(x) for x in train)
    validation_x = tuple(torch.from_numpy(x) for x in validation)
    train_y, validation_y = torch.from_numpy(train_y), torch.from_numpy(validation_y)
    if name == "temporal-net":
        model = TemporalMotifs(train_x[0].shape[-1])
    else:
        model = nn.Sequential(nn.Linear(train_x[0].shape[-1], 64), nn.GELU(), nn.Dropout(0.1),
                              nn.Linear(64, 32), nn.GELU(), nn.Linear(32, len(THEMES)))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.01)
    best, checkpoint, best_epoch = float("inf"), None, 0
    for epoch in range(1, 33):
        model.train()
        for mini in torch.randperm(len(train_y)).split(256):
            optimizer.zero_grad(set_to_none=True)
            logits = model(*(x[mini] for x in train_x))
            nn.functional.binary_cross_entropy_with_logits(logits, train_y[mini]).backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            loss = logloss(model(*validation_x), validation_y)
        if loss < best - 1e-4:
            best, checkpoint, best_epoch = loss, {k: v.clone() for k, v in model.state_dict().items()}, epoch
        if epoch - best_epoch >= 5:
            break
    model.load_state_dict(checkpoint)
    return model, dict(seed=seed, bestEpoch=best_epoch, validationLogLoss=best,
                       parameters=sum(parameter.numel() for parameter in model.parameters()))


def network_input(model, group):
    values, mask, flat, _ = group
    return (values, mask) if model == "temporal-net" else (flat,)


def predict_network(model, name, group):
    with torch.no_grad():
        arrays = [torch.from_numpy(x) for x in network_input(name, group)]
        return torch.cat([model(*batch).sigmoid()
                          for batch in zip(*(array.split(256) for array in arrays), strict=True)]).numpy()


def predict_first_ply(ensemble, group):
    with torch.no_grad():
        values, mask = map(torch.from_numpy, network_input("temporal-net", group))
        members = [model.local_logits(values, mask)[:, 0].sigmoid().numpy() for model, _ in ensemble]
    return np.mean(members, axis=0)


def review_metrics(rows, predictions):
    per_motif = {}
    for index, name in enumerate(THEMES):
        known = [(row["labels"][name], scores[index]) for row, scores in zip(rows, predictions, strict=True)
                 if row["labels"].get(name) is not None]
        if not known:
            continue
        labels, scores = map(np.asarray, zip(*known, strict=True))
        per_motif[name] = dict(positive=int(sum(labels)), negative=int(sum(~labels)))
        if np.any(labels) and not np.all(labels):
            per_motif[name]["ap"] = float(average_precision_score(labels, scores))
    return per_motif


def tagged_metrics(y, predictions, validation_predictions):
    average_precision = ap_by_motif(y, predictions)
    per_motif = {}
    for index, name in enumerate(THEMES):
        # Budget is fixed before testing. Use the validation 85th percentile
        # as a separate test of whether a fixed cutoff transfers.
        slots = int(np.ceil(len(y) * KEEP / 100))
        chosen = np.argsort(-predictions[:, index], kind="stable")[:slots]
        threshold = np.quantile(validation_predictions[:, index], (100 - KEEP) / 100)
        flagged = predictions[:, index] >= threshold
        target = y[:, index].astype(bool)
        per_motif[name] = dict(ap=average_precision[index], sourcePositives=int(sum(target)),
                               atBudget=dict(slots=slots, sourceTagged=int(sum(target[chosen]))),
                               fixedThreshold=dict(threshold=float(threshold), tagged=int(sum(flagged & target)),
                                                   untagged=int(sum(flagged & ~target)),
                                                   missedTag=int(sum(~flagged & target))))
    return dict(macroAP=float(np.mean(average_precision)), byMotif=per_motif)


def train_and_score(args):
    puzzle = json.loads(args.puzzle.read_bytes())
    rows = puzzle["cases"]
    boards, games = check_splits(rows)
    transfers = {}
    if args.transfer:
        payload = json.loads(args.transfer.read_bytes())
        for name, examples in payload.items():
            for row in examples:
                board = corpus.board_identity(chess.Board(row["fen"]))
                if board in boards or row.get("game") in games:
                    raise ValueError("A benchmark transfer example overlaps the puzzle sample")
            transfers[name] = Dataset.make(examples)
    dataset = Dataset.make(rows, args.feature_cache)
    split = np.asarray([row["split"] for row in rows])
    train_values = dataset.values[split == "train"][dataset.mask[split == "train"]]
    stats = (train_values.mean(axis=0), np.maximum(train_values.std(axis=0), 0.01))
    full = inputs(dataset, stats)
    results, inference, predictions = {}, {}, {}
    transfer_inputs = {name: inputs(data, stats) for name, data in transfers.items()}
    train_y, validation_y, test_y = (dataset.tags[split == name] for name in ("train", "validation", "test"))
    for name in MODELS:
        started = perf_counter()
        if name.endswith("logistic"):
            bundle = -1 if name == "root-logistic" else -2
            model = [LogisticRegression(C=0.1, max_iter=400).fit(full[bundle][split == "train"], column)
                     for column in train_y.T]

            def infer(group):
                return np.stack([clf.predict_proba(group[bundle])[:, 1] for clf in model], axis=1)

            fits = [dict(parameters=sum(clf.coef_.size + 1 for clf in model),
                         maxIterations=max(int(clf.n_iter_[0]) for clf in model))]
        else:
            train = network_input(name, tuple(feature[split == "train"] for feature in full))
            validation = network_input(name, tuple(feature[split == "validation"] for feature in full))
            ensemble = [train_network(name, seed, train, validation, train_y, validation_y) for seed in SEEDS]
            fits = [receipt for _, receipt in ensemble]

            def infer(group):
                return np.mean([predict_network(model, name, group) for model, _ in ensemble], axis=0)

        training_seconds = perf_counter() - started
        val, test = tuple(tuple(feature[split == key] for feature in full) for key in ("validation", "test"))
        val_scores, test_scores = infer(val), infer(test)
        started = perf_counter()
        singleton = tuple(feature[:1] for feature in test)
        for _ in range(120):
            infer(singleton)
        mean_single_ms = (perf_counter() - started) * 1000 / 120
        transfer_scores = {name: infer(group) for name, group in transfer_inputs.items()}
        inference[name] = dict(trainingSeconds=training_seconds, meanSingleInferenceMs=mean_single_ms, fits=fits)
        results[name] = dict(validationMacroAP=float(np.mean(ap_by_motif(validation_y, val_scores))),
                             test=tagged_metrics(test_y, test_scores, val_scores),
                             transfers={key: review_metrics(transfers[key].rows, value)
                                        for key, value in transfer_scores.items()})
        predictions[name] = {key: {row["id"]: score.tolist()
                                   for row, score in zip(transfers[key].rows, value, strict=True)}
                             for key, value in transfer_scores.items()}
        print(name, results[name]["validationMacroAP"], results[name]["test"]["macroAP"], flush=True)
    # Only the temporal model owns local logits. These are weakly supervised
    # localization hints, and have no line-tag or per-ply calibration.
    localized = {name: predict_first_ply(ensemble, group) for name, group in transfer_inputs.items()}
    results["temporal-first-ply"] = dict(transfers={key: review_metrics(transfers[key].rows, value)
                                                 for key, value in localized.items()})
    predictions["temporal-first-ply"] = {key: {row["id"]: score.tolist()
                                               for row, score in zip(transfers[key].rows, value, strict=True)}
                                         for key, value in localized.items()}
    return dict(themes=THEMES, corpusSha256=hashlib.sha256(args.puzzle.read_bytes()).hexdigest(),
                transferSha256=hashlib.sha256(args.transfer.read_bytes()).hexdigest() if args.transfer else None,
                splitSizes={key: int(np.count_nonzero(split == key)) for key in ("train", "validation", "test")},
                metrics=results, inference=inference, transferPredictions=predictions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("puzzle", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--feature-cache", type=Path)
    parser.add_argument("--transfer", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to replace frozen results")
    torch.set_num_threads(4)
    with threadpool_limits(limits=4):
        report = train_and_score(args)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)


if __name__ == "__main__":
    main()
