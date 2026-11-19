"""Train a small ranker to nominate one independently verified Stockfish reply.

The two training targets are deeper score corroboration and a settled
material loss. The evaluation measures marginal evidence gained by a
fixed-cost check against reviewed mistakes from unseen events.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import chess
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.multioutput import MultiOutputClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

VALUES = (0, 100, 320, 330, 500, 900, 0)
SEEDS = (11, 22, 33)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize_score(line):
    if line.get('mate') is not None:
        return 10 if line['mate'] > 0 else -10
    return max(-10, min(10, line['cp'] / 100))


def net_material(board, side):
    return sum(VALUES[role] * (len(board.pieces(role, side)) - len(board.pieces(role, not side)))
               for role in range(1, 6))


def features(board, candidate, index, root, best, played, top):
    """Only use the already available root pairs and the inexpensive reply PV."""
    board = board.copy(stack=False)
    move = board.parse_uci(candidate['pvUci'][0])
    victim = chess.PAWN if board.is_en_passant(move) else board.piece_type_at(move.to_square)
    attacker = board.piece_type_at(move.from_square)
    own_material = net_material(board, board.turn)
    side = board.turn
    line = []
    checks = captures = 0
    for uci in candidate['pvUci'][:10]:
        current = board.parse_uci(uci)
        checks += int(board.gives_check(current))
        captures += int(board.is_capture(current))
        board.push(current)
        line.append((net_material(board, side) - own_material) / 100.0)
    score = normalize_score(candidate)
    mate = candidate.get('mate')
    return [
        index,
        score - normalize_score(top),
        score + normalize_score(played),
        normalize_score(best) - normalize_score(played),
        int(played['pvUci'][1:2] == [move.uci()]),
        len(root.piece_map()),
        root.legal_moves.count(),
        board.legal_moves.count(),
        (victim or 0),
        attacker,
        np.mean(line[-3:]),
        line[0],
        min(line),
        max(line),
        checks,
        captures,
        int(mate is not None),
        int(move.promotion is not None),
    ]


def load_cases(sample, audit_path, engine_dir, split):
    audit = json.loads(audit_path.read_bytes())
    if audit['cohort'] != 'tournament' or audit['split'] != split:
        raise ValueError('Probe training and evaluation must use their designated splits')
    wanted = [row for row in sample['cases'] if row['split'] == split]
    audited = {row['id']: row for row in audit['results']}
    if set(audited) != {row['id'] for row in wanted}:
        raise ValueError('Audit and sampled games differ')
    cases = []
    for source in wanted:
        id = source['id']
        audit_row = audited[id]
        engine = json.loads((engine_dir / (id + '.json')).read_bytes())
        if engine['identity'] != audit_row['engineIdentity'] or engine['identity']['fen'] != source['fen']:
            raise ValueError('Cached preliminary evidence belongs to another position')
        root = chess.Board(source['fen'])
        board = root.copy(stack=False)
        board.push_uci(source['playedMoveUci'])
        known = audit_row['replyRanking']
        candidates = []
        best = engine['comparison'][0]
        played = next(line for line in engine['comparison'] if line['pvUci'][0] == source['playedMoveUci'])
        for index, query in enumerate(known['queries']):
            candidate = engine['reply'][index]
            if candidate['pvUci'][0] != query['moveUci'] or candidate['fen'] != board.fen():
                raise ValueError('The fixed-cost query and low-cost reply must have the same root')
            signals = features(board, candidate, index, root, best, played, engine['reply'][0])
            candidates.append(dict(query, features=signals))
        cases.append(dict(source, candidates=candidates, baseline=known['baselineTactical']))
    return cases, audit


def fit(cases):
    queries = [candidate for case in cases for candidate in case['candidates']]
    x = np.array([row['features'] for row in queries])
    names = ('corroboratedScore', 'settledMaterialLoss')
    y = np.array([[row[key] for key in names] for row in queries])
    if not len(y) or any(len(np.unique(column)) != 2 for column in y.T):
        raise ValueError('Need positive and negative examples for both engine targets')
    models = {
        'logistic': make_pipeline(StandardScaler(), MultiOutputClassifier(
            LogisticRegression(C=.25, max_iter=500))),
        'tree': MultiOutputClassifier(HistGradientBoostingClassifier(
            max_iter=60, max_leaf_nodes=4, min_samples_leaf=8, l2_regularization=1, random_state=0)),
        **{f'neural-{seed}': make_pipeline(
            StandardScaler(), MLPClassifier(hidden_layer_sizes=(12,), activation='tanh',
                                            solver='lbfgs', alpha=3, max_iter=1000, random_state=seed))
           for seed in SEEDS},
    }
    for model in models.values():
        model.fit(x, y)
    return models, dict(queries=len(y), targetPositives=dict(zip(names, y.sum(axis=0).tolist())),
                        productive=sum(row['addsTacticalEvidence'] for row in queries),
                        positionsWithProductiveQuery=sum(
                            any(row['addsTacticalEvidence'] for row in case['candidates']) for case in cases))


def rankings(candidates, models):
    x = np.asarray([row['features'] for row in candidates])
    orders = {
        'engine-top': list(range(len(candidates))),
        'paired-pv-reply': list(np.argsort(-x[:, 4], kind='stable')),
        'material-last-three': list(np.argsort(-x[:, 10], kind='stable')),
    }
    predictions = {}
    for name, model in models.items():
        probabilities = model.predict_proba(x)
        if isinstance(probabilities, list):
            probabilities = np.column_stack([head[:, 1] for head in probabilities])
        # A ranking score for two overlapping signals. No claim that the
        # product is a calibrated probability or that the heads are independent.
        priority = np.prod(probabilities, axis=1)
        predictions[name] = priority
        orders[name] = list(np.argsort(-priority, kind='stable'))
    mean_neural = np.mean([predictions[f'neural-{seed}'] for seed in SEEDS], axis=0)
    orders['neural-ensemble'] = list(np.argsort(-mean_neural, kind='stable'))
    return orders


def measure(cases, labels, models):
    counts = defaultdict(lambda: defaultdict(int))
    by_event = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for case in cases:
        target = labels[case['id']]
        candidates = case['candidates'] if not case['baseline'] else []
        orders = rankings(candidates, models) if candidates else {}
        methods = ['base', 'all', 'engine-top', 'paired-pv-reply', 'material-last-three',
                   *models, 'neural-ensemble']
        for name in methods:
            for summary in (counts[name], by_event[case['event']][name]):
                choices = candidates if name == 'all' else (
                    [candidates[orders[name][0]]] if name in orders else [])
                added = any(row['addsTacticalEvidence'] for row in choices)
                fired = case['baseline'] or added
                summary['queries'] += len(choices)
                summary['engineNodes'] += sum(row['nodes'] for row in choices)
                summary['newSupport'] += int(added)
                summary['addedReviewedTruePositives'] += int(added and target is True)
                summary['truePositives'] += int(fired and target is True)
                summary['falsePositives'] += int(fired and target is False)
                summary['missedPositives'] += int(not fired and target is True)
                summary['unreviewablePredictions'] += int(fired and target is None)
    return counts, by_event


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('--train', type=Path, nargs=2, required=True, metavar=('AUDIT', 'ROOT_CACHE'))
    parser.add_argument('--test', type=Path, nargs=2, required=True, metavar=('AUDIT', 'ROOT_CACHE'))
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--registration', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep model evaluation files outside the checkout')
    sample = json.loads(args.sample.read_bytes())
    train, _ = load_cases(sample, *args.train, 'development')
    test, audit = load_cases(sample, *args.test, 'validation')
    for key in ('event', 'sourceGroup'):
        if {case[key] for case in train} & {case[key] for case in test}:
            raise ValueError(f'Train and evaluation overlap on {key}')
    plan = json.loads(args.registration.read_bytes())
    if (plan['sampleSha256'] != sha256(args.sample) or plan['freezeSha256'] != audit.get('freezeSha256')
            or plan['trainingAuditSha256'] != sha256(args.train[0])
            or audit.get('referenceSha256') != sha256(args.reference)):
        raise ValueError('Evaluation does not match the registered sample, frozen system, training data and review')
    reference = json.loads(args.reference.read_bytes())['cases']
    labels = {row['id']: row['tactical'] for row in reference if row['scope'] == 'mistake-mechanism'}
    if set(labels) != {case['id'] for case in test}:
        raise ValueError('The independent review must address every evaluation decision')
    models, development = fit(train)
    metrics, by_event = measure(test, labels, models)
    report = dict(
        sklearn=sklearn.__version__, candidatesPerBoard=1,
        scope='Candidates come from a 300K-node unrestricted frame. Each result uses the same one-query budget.',
        limits='Offline nomination against cached fixed-cost scans. Source events are grouped. Each accuracy label is independent of the model.',
        training=development, trainPositions=len(train), testPositions=len(test),
        reviewedPositives=list(labels.values()).count(True), reviewedNegatives=list(labels.values()).count(False),
        unknown=list(labels.values()).count(None), metrics=metrics, byEvent=by_event,
        registrationSha256=sha256(args.registration), referenceSha256=sha256(args.reference),
    )
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps(report, default=dict))


if __name__ == '__main__':
    main()
