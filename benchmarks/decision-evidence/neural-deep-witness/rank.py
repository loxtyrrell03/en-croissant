"""Compare neural and simple rankings for deeper tactical review."""
from collections import Counter, defaultdict
from hashlib import sha256
from math import ceil
from pathlib import Path
from statistics import median
from time import perf_counter
import argparse

import chess
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits
import torch
from torch import nn

from frames import family, initial, records, write
from sample import board_key

VALUES = [0, 1, 3, 3, 5, 9, 0]
SHORT_PLIES = 8
DEEP_PLIES = 14
SEEDS = (31, 73, 109)
MIN_GAIN = 2


def score(line):
    if line["mate"] is not None:
        return 1600 if line["mate"] > 0 else -1600
    if line["cp"] is None:
        raise ValueError("Missing an exact evaluation")
    return max(-1400, min(1400, line["cp"]))


def material(board, side):
    return sum(VALUES[role] * (len(board.pieces(role, side)) - len(board.pieces(role, not side)))
               for role in range(1, 6))


def legal_prefix(child, line, side, plies, features=False):
    board = child.copy()
    if line["fen"] != board.fen():
        raise ValueError("Engine line from the wrong board")
    trajectory, timeline, notation = [], [], []
    for uci in line["pvUci"][:plies]:
        move = board.parse_uci(uci)
        role = board.piece_type_at(move.from_square)
        piece_taken = chess.PAWN if board.is_en_passant(move) else board.piece_type_at(move.to_square)
        played_side = board.turn == side
        notation.append(board.san(move))
        board.push(move)
        value = material(board, side)
        trajectory.append(value)
        if features:
            threats = [0, 0]
            for square in board.attacks(move.to_square) & board.occupied_co[board.turn]:
                target = board.piece_type_at(square)
                if 2 <= target <= 5:
                    threats[0] += 1
                    threats[1] += not bool(board.attackers(board.turn, square))
            timeline.append([value, VALUES[piece_taken or 0], bool(piece_taken), bool(move.promotion),
                             board.is_check(), played_side, min(board.legal_moves.count(), 45) / 10,
                             *threats, *(role == role_id for role_id in range(1, 7)), 1])
    return trajectory, timeline, notation


def evidence(board, row, packet, horizon, deep):
    children = []
    for key, move in (("better", row["candidate"]), ("played", row["playedMoveUci"])):
        child = board.copy()
        child.push_uci(move)
        lines = packet[key]
        if len(lines) < 2:
            return None, "one-reply"
        if lines[0]["depth"] != lines[1]["depth"] or lines[0]["pvUci"][0] == lines[1]["pvUci"][0]:
            return None, "incomparable-branches"
        children.append((child, lines))
    good, bad = [lines for _, lines in children]
    reply_loss = score(bad[0]) - score(good[0])
    root_loss = None
    if deep:
        roots = packet["root"]
        if any(line["fen"] != board.fen() for line in roots):
            raise ValueError("Wrong root for comparison")
        if [line["pvUci"][0] for line in roots] != [row["candidate"], row["playedMoveUci"]]:
            raise ValueError("Wrong root choices")
        root_loss = score(roots[0]) - score(roots[1])
        if min(line["depth"] for _, lines in children for line in lines) < 14:
            return None, "shallow-reference"
        if max(abs(score(root) + score(line)) for root, line in zip(roots, (good[0], bad[0]), strict=True)) > 160:
            return None, "score-disagreement"
    if reply_loss < 80 or (deep and root_loss < 80):
        if deep and max(root_loss, reply_loss) <= 40:
            return 0, "no-repeatable-loss"
        return None, "score-margin"
    if deep:
        # Each choice has a separately searched root PV and unrestricted leading reply.
        # A refutation only needs a strong reply, and a weaker opponent alternative may
        # simply miss the tactic. Corroborate across the two different searches instead.
        children = [
            (child, [lines[0], dict(fen=child.fen(), pvUci=root["pvUci"][1:],
                                   mate=None if root["mate"] is None else -root["mate"])])
            for (child, lines), root in zip(children, roots, strict=True)
        ]
        good, bad = [lines for _, lines in children]
    if all(line["mate"] is not None and 0 < line["mate"] <= 8 for line in bad) and all(
            line["mate"] is None or line["mate"] < 0 for line in good):
        return 1, "mate"
    traces = [[legal_prefix(child, line, board.turn, horizon)[0] for line in lines] for child, lines in children]
    matched = min(map(len, traces[0] + traces[1]))
    if matched < (8 if deep else horizon):
        return None, "short-reference-line"
    # Compare the least favourable stronger line with the least punishing played line.
    contrast = [min(path[i] for path in traces[0]) - max(path[i] for path in traces[1])
                for i in range(matched)]
    if min(contrast[-4:]) >= MIN_GAIN:
        return 1, "stable-material"
    if deep and max(contrast) < 1:
        return 0, "no-bounded-material-contrast"
    return None, "unsettled-material"


def features(board, row):
    sequences, evals, depth, summaries = [], [], [], []
    for slot, move in (("better", row["candidate"]), ("played", row["playedMoveUci"])):
        child = board.copy()
        child.push_uci(move)
        for line in row["short"][slot]:
            _, entries, _ = legal_prefix(child, line, board.turn, SHORT_PLIES, True)
            entries = np.array(entries, dtype=np.float32)
            if not len(entries):
                raise ValueError("Missing short principal variation")
            entries[:, 0] -= material(board, board.turn)
            sequences.append(np.pad(entries, ((0, SHORT_PLIES-len(entries)), (0, 0))))
            summaries.extend([entries.mean(axis=0), entries.max(axis=0), entries.min(axis=0), entries[-1]])
            evals.append(score(line))
            depth.append(line["depth"])
    short_scores = [(evals[2] - evals[0])/100, (evals[3] - evals[1])/100,
                    (evals[0] - evals[1])/100, (evals[2] - evals[3])/100, *[s / 100 for s in evals],
                    *depth, len(board.piece_map()), material(board, board.turn), board.legal_moves.count()]
    fast = min(
        seq[seq[:, -1] != 0][-1, 0] for seq in sequences[:2]
    ) - max(seq[seq[:, -1] != 0][-1, 0] for seq in sequences[2:])
    flat = np.concatenate([short_scores, np.asarray(summaries).flatten(), [fast]])
    return np.stack(sequences), np.array(short_scores), flat, fast


def dataset(file):
    eligible, counts = [], Counter()
    for row in records(file):
        if row.get("skipped") or any(len(row["short"][arm]) < 2 for arm in ("better", "played")):
            counts[row.get("skipped", "short-two-replies-unavailable")] += 1
            continue
        board = initial(row)
        if evidence(board, row, row["short"], SHORT_PLIES, False)[0] == 1:
            counts["already-visible-shallow"] += 1
            continue
        label, mechanism = evidence(board, row, row["deep"], DEEP_PLIES, True)
        counts[mechanism] += 1
        encoded = features(board, row)
        eligible.append((row, label, mechanism, encoded))
    return eligible, dict(counts)


class BranchGRU(nn.Module):
    def __init__(self, width, numeric):
        super().__init__()
        self.line = nn.GRU(width, 24, batch_first=True)
        self.output = nn.Sequential(nn.Linear(72 + numeric, 32), nn.GELU(),
                                    nn.Dropout(.15), nn.Linear(32, 1))

    def forward(self, seq, numbers):
        n, branches, plies, width = seq.shape
        moves = seq.reshape((n * branches, plies, width))
        result, _ = self.line(moves)
        end = (moves[:, :, -1].sum(dim=1).long() - 1).clamp_min(0)
        vectors = result[torch.arange(len(end), device=seq.device), end]
        better, played = vectors.reshape((n, 2, 2, 24)).mean(dim=2).unbind(1)
        return self.output(torch.cat((better, played, better - played, numbers), dim=1)).flatten()


def neural(x, scores, y, future, future_scores, seed):
    torch.manual_seed(seed)
    x = torch.from_numpy(np.asarray(x, dtype=np.float32))
    future = torch.from_numpy(np.asarray(future, dtype=np.float32))
    scaler = StandardScaler().fit(scores)
    scores = torch.tensor(scaler.transform(scores), dtype=torch.float32)
    future_scores = torch.tensor(scaler.transform(future_scores), dtype=torch.float32)
    model = BranchGRU(x.shape[-1], scores.shape[-1])
    optimizer = torch.optim.AdamW(model.parameters(), lr=.003, weight_decay=.03)
    objective = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(float(np.sum(y == 0) / np.sum(y == 1))))
    target = torch.as_tensor(y, dtype=torch.float32)
    for _ in range(35):
        for sample in torch.randperm(len(y)).split(32):
            optimizer.zero_grad(set_to_none=True)
            loss = objective(model(x[sample], scores[sample]), target[sample])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
    model.eval()
    start = perf_counter()
    with torch.no_grad():
        logits = model(future, future_scores).numpy()
    inference = (perf_counter()-start)*1000
    return logits, sum(p.numel() for p in model.parameters()), inference


def predict(train, test):
    known = [d for d in train if d[1] is not None]
    y = np.array([d[1] for d in known])
    a, b, c, _ = map(np.stack, zip(*(d[3] for d in known), strict=True))
    xx, yy, zz, contrast = map(np.stack, zip(*(d[3] for d in test), strict=True))
    predictions = {
        "shallow-loss": yy[:, 0],
        "shallow-material": contrast,
        "score-logistic": make_pipeline(StandardScaler(), LogisticRegression(C=.2, max_iter=1000)
                                       ).fit(b, y).decision_function(yy),
        "line-logistic": make_pipeline(StandardScaler(), LogisticRegression(C=.015, max_iter=1000)
                                      ).fit(c, y).decision_function(zz),
        "line-tree": HistGradientBoostingClassifier(max_iter=100, max_leaf_nodes=8, l2_regularization=3,
                                                    random_state=31).fit(c, y).decision_function(zz),
    }
    runs = [neural(a, b, y, xx, yy, seed) for seed in SEEDS]
    predictions["branch-neural"] = np.asarray([r[0] for r in runs]).mean(axis=0)
    return predictions, [r[0] for r in runs], runs[0][1], float(median(r[2] for r in runs))


def counts(test, selected):
    labels = Counter(test[i][1] for i in selected)
    return {"slots": len(selected), "witness": labels[1], "negative": labels[0], "uncertain": labels[None]}


def measure(test, scores):
    groups = defaultdict(list)
    for index, (row, _, _, _) in enumerate(test):
        groups[family(row["event"])].append(index)
    selected = []
    by_event = {}
    for group, indices in sorted(groups.items()):
        ranked = sorted(indices, key=lambda i: (-scores[i], test[i][0]["id"]))
        queue = ranked[:ceil(len(indices)*.25)]
        selected.extend(queue)
        by_event[group] = counts(test, queue)
    known = [i for i in range(len(test)) if test[i][1] is not None]
    ap = average_precision_score([test[i][1] for i in known], scores[known])
    return dict(counts(test, selected), averagePrecision=float(ap), events=by_event,
                selected=[test[i][0]["id"] for i in selected])


def check_split(train, test):
    for partition_key in (lambda r: r["game"], lambda r: family(r["event"]),
                          lambda r: board_key(chess.Board(r["fen"]))):
        left = [partition_key(row) for row in train]
        right = [partition_key(row) for row in test]
        if set(left) & set(right):
            raise ValueError("Training and transfer identities intersect")
    for partition in (train, test):
        for identity in ("game", "id"):
            if len({row[identity] for row in partition}) != len(partition):
                raise ValueError("A game or decision repeats within its split")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("train", "test", "output"):
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    check_split(records(args.train), records(args.test))
    torch.set_num_threads(2)
    with threadpool_limits(limits=2):
        train, counts_train = dataset(args.train)
        test, counts_test = dataset(args.test)
        print("train", counts_train, "test", counts_test, flush=True)
        results, seeds, params, millis = predict(train, test)
    measures = {method: measure(test, values) for method, values in results.items()}
    seed_results = [measure(test, scores) for scores in seeds]
    ids = [d[0]["id"] for d in test]
    write(args.output, {
        "training": counts_train, "test": counts_test, "parameters": params, "oneNetworkBatchMs": millis,
        "eligible": counts(test, range(len(test))), "results": measures, "seedResults": seed_results,
        "caseScores": {
            identifier: {"label": test[i][1], "evidence": test[i][2],
                         **{method: float(scores[i]) for method, scores in results.items()}}
            for i, identifier in enumerate(ids)
        },
        "hashes": {name: sha256(getattr(args, name).read_bytes()).hexdigest() for name in ("train", "test")},
    })
    print({method: {k: m[k] for k in ("witness", "negative", "uncertain", "averagePrecision")}
           for method, m in measures.items()}, flush=True)


if __name__ == "__main__":
    main()
