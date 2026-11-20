"""Compare a spatial move encoder, with and without puzzle pretraining."""

import argparse
from collections import Counter
import hashlib
import importlib
import json
from pathlib import Path
import sys
from time import perf_counter

import chess
import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from threadpoolctl import threadpool_limits
from torch import nn
from torch.nn import functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/benchmarks"))
baseline = importlib.import_module("decision-evidence-fork-payoff-model")
payoff = baseline.payoff
board_identity = payoff.corpus.board_identity
SEEDS = (17, 59, 97)
PLIES = 4
PLANES = 17


def move_planes(board, move):
    result = np.zeros((PLANES, 64), dtype=np.uint8)
    mover = board.turn
    for square, piece in board.piece_map().items():
        index = piece.piece_type - 1 + 6 * (piece.color != mover)
        result[index, square if mover else chess.square_mirror(square)] = 1
    for square in chess.scan_forward(board.castling_rights):
        result[12, square if mover else chess.square_mirror(square)] = 1
    if board.has_legal_en_passant():
        square = board.ep_square
        result[13, square if mover else chess.square_mirror(square)] = 1
    origin = move.from_square if mover else chess.square_mirror(move.from_square)
    target = move.to_square if mover else chess.square_mirror(move.to_square)
    result[14, origin] = result[15, target] = 1
    result[16].fill(move.promotion or 0)
    return result.reshape(PLANES, 8, 8)


def encode_candidate(row):
    board = chess.Board(row["fen"])
    move = board.parse_uci(row["move"])
    root = move_planes(board, move)
    board.push(move)
    lines = np.zeros((2, PLIES, PLANES, 8, 8), dtype=np.uint8)
    masks = np.zeros((2, PLIES), dtype=bool)
    for index, reply in enumerate(row["quick"][:2]):
        cursor = board.copy(stack=False)
        for ply, uci in enumerate(reply["pv"][:PLIES]):
            action = cursor.parse_uci(uci)
            lines[index, ply] = move_planes(cursor, action)
            masks[index, ply] = True
            cursor.push(action)
    return np.concatenate((root[None], lines.reshape(-1, PLANES, 8, 8))), masks


def pretraining_samples(corpus, held_games, held_boards):
    fitted, counts = [], Counter()
    for row in corpus["cases"]:
        if row["split"] != "train" or row["game"] in held_games:
            continue
        board = chess.Board(row["fen"])
        pairs = []
        for ply, uci in enumerate(row["line"][:4]):
            actual = board.parse_uci(uci)
            if board_identity(board) in held_boards:
                pairs = []
                counts["excludedByBoard"] += 1
                break
            if ply % 2 == 0:
                alternatives = [move for move in board.legal_moves if move != actual]
                if alternatives:
                    gives_check, capture = board.gives_check(actual), board.is_capture(actual)
                    role = board.piece_type_at(actual.from_square)
                    def mismatch(move):
                        return ((board.piece_type_at(move.from_square) != role)
                        + (board.gives_check(move) != gives_check)
                        + (board.is_capture(move) != capture))

                    different = min(map(mismatch, alternatives))
                    matches = [move for move in alternatives if mismatch(move) == different]
                    forks = bool(payoff.geometry(board, actual))
                    alternative = min(matches, key=lambda move: (
                        bool(payoff.geometry(board, move)) != forks,
                        payoff.key(row["game"] + move.uci())
                    ))
                    pairs.append((move_planes(board, actual), move_planes(board, alternative)))
            board.push(actual)
        if pairs:
            counts["games"] += 1
            fitted.extend(pairs)
    counts["pairs"] = len(fitted)
    return np.asarray(fitted), dict(counts)


class MoveEncoder(nn.Module):
    width = 20
    output = 20

    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(nn.Conv2d(PLANES, self.width, 3, padding=1), nn.GELU(),
                                    nn.Conv2d(self.width, self.width, 3, padding=1), nn.GELU())
        self.project = nn.Sequential(nn.Linear(4 * self.width, self.output), nn.GELU())

    def forward(self, planes):
        maps = self.layers(planes).flatten(2)
        locations = planes[:, 14:16].flatten(2).transpose(1, 2)
        selected = torch.bmm(maps, locations).flatten(1)
        return self.project(torch.cat((selected, maps.mean(2), maps.amax(2)), dim=1))


class ExactNetwork(nn.Module):
    def __init__(self, quick_width):
        super().__init__()
        self.encoder = MoveEncoder()
        local = self.encoder.output
        self.reply = nn.Sequential(nn.Linear(PLIES * (local + 1), 24), nn.GELU())
        self.head = nn.Sequential(nn.Linear(local + 48 + quick_width, 32), nn.GELU(),
                                  nn.Dropout(.1), nn.Linear(32, 1))

    def forward(self, moves, masks, quick):
        rows, length, channels, ranks, files = moves.shape
        embedded = self.encoder(moves.reshape(-1, channels, ranks, files).float())
        embedded = embedded.reshape(rows, length, -1)
        line = embedded[:, 1:].reshape(rows, 2, PLIES, -1)
        branch = torch.cat((line * masks.unsqueeze(-1), masks.unsqueeze(-1)), dim=-1)
        summary = self.reply(branch.flatten(2)) * masks.any(dim=2).unsqueeze(-1)
        return self.head(torch.cat((embedded[:, 0], summary.flatten(1), quick), 1)).squeeze(1)


def pretrain(encoder, sample):
    head = nn.Linear(encoder.output, 1).to(sample.device)
    optimizer = torch.optim.AdamW([*encoder.parameters(), *head.parameters()], lr=.002)
    for _ in range(8):
        for batch in torch.randperm(len(sample), device=sample.device).split(256):
            moves = sample[batch]
            logits = head(encoder(moves.flatten(0, 1).float())).reshape(-1, 2)
            loss = F.softplus(logits[:, 1] - logits[:, 0]).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()


def train_groups(rows, y, train):
    """Keep every opposite-label same-board comparison in one mini-batch."""
    groups = {}
    for index in np.flatnonzero(train):
        identity = rows[index]["identity"]
        key = (identity["game"], identity["boardKey"])
        groups.setdefault(key, []).append(int(index))
    singles, pairs = [], []
    for items in groups.values():
        if len(items) == 2 and y[items[0]] != y[items[1]]:
            pairs.append(tuple(sorted(items, key=lambda index: -y[index])))
        else:
            singles.extend(items)
    return np.asarray(pairs, dtype=np.int64).reshape(-1, 2), np.asarray(singles, dtype=np.int64)


def fit(inputs, labels, pairs, singles, validation, sample, seed):
    device = inputs[0].device
    torch.manual_seed(seed)
    model = ExactNetwork(inputs[2].shape[1]).to(device)
    start = perf_counter()
    if sample is not None:
        pretrain(model.encoder, sample)
    warmup = perf_counter() - start
    optimizer = torch.optim.AdamW(model.parameters(), lr=.002, weight_decay=.025)
    labels = torch.as_tensor(labels, device=device)
    x_val = tuple(matrix[validation] for matrix in inputs)
    pairs, singles = (torch.as_tensor(items, device=device) for items in (pairs, singles))
    groups = torch.randperm(len(singles) + len(pairs), device=device)
    best_loss, best_epoch = float("inf"), 0
    for epoch in range(1, 31):
        model.train()
        groups = groups[torch.randperm(len(groups), device=device)]
        for group in groups.split(96):
            match = pairs[group[group < len(pairs)]]
            ind = torch.cat((match.flatten(), singles[group[group >= len(pairs)] - len(pairs)]))
            scores = model(*(matrix[ind] for matrix in inputs))
            loss = F.binary_cross_entropy_with_logits(scores, labels[ind])
            if len(match):
                left, right = scores[:match.numel()].reshape(-1, 2).unbind(dim=1)
                loss += .2 * F.softplus(.5 - left + right).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            loss = float(F.binary_cross_entropy_with_logits(model(*x_val), labels[validation]))
        if loss < best_loss - 1e-4:
            best_loss, best_epoch = loss, epoch
            checkpoint = {key: value.detach().clone() for key, value in model.state_dict().items()}
        if epoch - best_epoch >= 7:
            break
    model.load_state_dict(checkpoint)
    return model.cpu(), dict(seed=seed, validationLogLoss=best_loss, epoch=best_epoch,
                            pretrainSeconds=warmup, fitSeconds=perf_counter() - start - warmup,
                            parameters=sum(parameter.numel() for parameter in model.parameters()))


def check_reference(rows, review, split):
    ids = {row["identity"]["id"]: row["move"] for row in rows if row["identity"]["split"] == split}
    if len(ids) != len(review) or any(ids.get(row["id"]) != row["moveUci"] for row in review):
        raise ValueError(f"Reference does not cover the exact moves in {split}")


def score(rows, predictions, reviews, incumbent, cached_predictions):
    result = {}
    for split in ["test", *reviews]:
        selected = [i for i, row in enumerate(rows) if row["identity"]["split"] == split]
        cases = [rows[i] for i in selected]
        manual = {row["id"]: row["fork"] for row in reviews.get(split, [])}
        unresolved = set(manual) - {key for key, found in incumbent.items() if found}
        methods = {name: values[selected] for name, values in predictions.items()}
        if split in cached_predictions:
            cached = cached_predictions[split]
            methods["handcrafted-network"] = [cached[row["identity"]["id"]] for row in cases]
        result[split] = {}
        if manual:
            known = [key for key, truth in manual.items() if truth is not None]
            missed = sorted(key for key in unresolved if manual[key] is True)
            result[split]["incumbent"] = dict(
                truePositive=sum(manual[key] and incumbent[key] for key in known),
                falsePositive=sum(not manual[key] and incumbent[key] for key in known),
                missed=len(missed) if split == "classical" else missed,
            )
        for name, values in methods.items():
            rows_score = baseline.score(cases, values, manual=manual or None)
            if manual:
                rows_score["unresolved"] = baseline.score(cases, values, manual=manual, unresolved=unresolved)
                ordered = sorted((i for i, row in enumerate(cases) if row["identity"]["id"] in unresolved),
                                 key=lambda i: (-values[i], payoff.key(cases[i]["identity"]["id"])))
                ids = [cases[i]["identity"]["id"] for i in ordered[:len(ordered) // 4]]
                if split != "classical":
                    rows_score["shortlist"] = [dict(id=key, reviewedFork=manual[key]) for key in ids]
            result[split][name] = rows_score
    return result


def experiment(corpus, rows, reviews, incumbent, cached, device):
    for row in rows:
        if row["identity"]["boardKey"] != board_identity(chess.Board(row["fen"])):
            raise ValueError("Stored board identity does not match the input position")
    baseline.enforce_groups(rows, [])
    if len({row["identity"]["id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate case")
    for split, review in reviews.items():
        check_reference(rows, review, split)
    if set(incumbent) != {row["id"] for review in reviews.values() for row in review}:
        raise ValueError("Incumbent decisions must cover all reviewed transfer moves")
    split = np.asarray([row["identity"]["split"] for row in rows])
    known = np.asarray([row["label"] is not None for row in rows])
    labels = np.asarray([row["label"] is True for row in rows], dtype=np.float32)
    train, validation = (split == "train") & known, np.flatnonzero((split == "validation") & known)
    held = [row["identity"] for row in rows if row["identity"]["split"] != "train"]
    start = perf_counter()
    pre, coverage = pretraining_samples(corpus, {row["game"] for row in held},
                                       {row["boardKey"] for row in held})
    prepare = perf_counter() - start
    sample = torch.from_numpy(pre).to(device)
    start = perf_counter()
    moves, mask = zip(*(encode_candidate(row) for row in rows), strict=True)
    spatial_ms = (perf_counter() - start) * 1_000 / len(rows)
    raw, cue = zip(*(baseline.features(row) for row in rows), strict=True)
    raw = np.stack(raw)
    normalized = baseline.normalise(raw[train], raw)
    flat = normalized.reshape(len(rows), -1)
    logistic = LogisticRegression(C=.1, max_iter=500).fit(flat[train], labels[train])
    predictions = {"stockfish": raw[:, 0, 1], "quick-payoff": np.asarray(cue),
                   "reply-logistic": logistic.predict_proba(flat)[:, 1]}
    quick = normalized[:, :, :8].reshape(len(rows), -1).copy()
    cpu = [torch.from_numpy(np.stack(moves)), torch.from_numpy(np.stack(mask)), torch.from_numpy(quick)]
    inputs = tuple(matrix.to(device) for matrix in cpu)
    pairs, singles = train_groups(rows, labels, train)
    timings, single_timings, fits = {}, {}, {}
    for name, warm in (("spatial-scratch", None), ("spatial-pretrained", sample)):
        ensemble = [fit(inputs, labels, pairs, singles, validation, warm, seed) for seed in SEEDS]
        with torch.no_grad():
            for model, _ in ensemble:
                model(*(matrix[:1] for matrix in cpu))
            start = perf_counter()
            outputs = [torch.cat([model(*(matrix[i:i+48] for matrix in cpu)).sigmoid()
                                  for i in range(0, len(rows), 48)]) for model, _ in ensemble]
            timings[name] = (perf_counter() - start) * 1_000 / len(rows)
            start = perf_counter()
            latency_cases = min(100, len(rows))
            for i in range(latency_cases):
                for model, _ in ensemble:
                    model(*(matrix[i:i+1] for matrix in cpu))
            single_timings[name] = (perf_counter() - start) * 1_000 / latency_cases
        predictions[name] = torch.stack(outputs).mean(0).numpy()
        fits[name] = [metadata for _, metadata in ensemble]
    return dict(positions=dict(Counter(split)), knownTraining=int(train.sum()), trainingPairs=len(pairs),
                pretraining=coverage, pretrainingPrepareSeconds=prepare,
                spatialFeaturesMs=spatial_ms, batchedInferenceCpuMs=timings,
                singleInferenceCpuMs=single_timings, fits=fits,
                results=score(rows, predictions, reviews, incumbent, cached))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("puzzle_cache", type=Path)
    parser.add_argument("transfer_bundle", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to overwrite results")
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True)
    bundle = payoff.read(args.transfer_bundle)
    rows = baseline.load_cache(args.puzzle_cache) + bundle["rows"]
    with threadpool_limits(limits=4):
        result = experiment(payoff.read(args.corpus), rows, bundle["reviews"], bundle["incumbent"],
                            bundle["cachedPredictions"], args.device)
    assets = (args.corpus, args.puzzle_cache / "receipt.json", args.transfer_bundle)
    result["inputs"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in assets}
    result["dependencies"] = dict(torch=torch.__version__, chess=chess.__version__, numpy=np.__version__,
                                  device=args.device)
    result["engine"] = bundle["engine"]
    result["excludedFromPuzzleAudit"] = bundle["excludedFromPuzzleAudit"]
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)


if __name__ == "__main__":
    main()
