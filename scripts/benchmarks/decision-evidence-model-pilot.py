"""Compare small learned baselines on previously reviewed chess move evidence.

This pilot uses raw board and Stockfish facts, not classifier outputs or source
category tags. It measures move-justification only. A previously inspected
test cohort is development evidence, even if its game groups are disjoint.
"""
import argparse
import hashlib
import json
from pathlib import Path

import chess
import numpy as np
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


VALUE = {1: 1.0, 2: 3.2, 3: 3.3, 4: 5.0, 5: 9.0}


def material(board, side):
    return sum(value * (len(board.pieces(role, side)) - len(board.pieces(role, not side)))
               for role, value in VALUE.items())


def score(line):
    if line['mate'] is not None:
        return 10 if line['mate'] > 0 else -10
    return max(-10, min(10, line['cp'] / 100))


def features(fen, selected, alternatives):
    board = chess.Board(fen)
    side = board.turn
    before = material(board, side)
    out = [len(board.piece_map()), board.legal_moves.count(), int(board.is_check()),
           before, score(selected), score(alternatives[0]) - score(selected),
           score(alternatives[0]) - score(alternatives[min(1, len(alternatives) - 1)])]
    checks = captures = promotions = 0
    totals = []
    for ply, uci in enumerate(selected['pvUci'][:10]):
        move = chess.Move.from_uci(uci)
        if not board.is_legal(move):
            return None
        captures += board.is_capture(move)
        checks += board.gives_check(move)
        promotions += bool(move.promotion)
        board.push(move)
        totals.append(material(board, side) - before)
        if ply == 0:
            out.extend([checks, captures, board.legal_moves.count()])
    if not totals:
        return None
    return out + [checks, captures, promotions, totals[-1], min(totals), max(totals),
                  int(board.is_checkmate())]


def read_rows(reference, engine_dir):
    rows = []
    for label in json.loads(reference.read_bytes())['cases']:
        if label['scope'] != 'move-justification':
            continue
        raw = json.loads((engine_dir / f"{label['id']}.json").read_bytes())
        fen = raw['identity']['fen']
        selected = next((line for line in raw['deep'] if line['pvUci'][0] == label['moveUci']), None)
        raw_features = features(fen, selected, raw['deep']) if selected else None
        rows.append(dict(label, features=raw_features, fenIdentity=' '.join(fen.split()[:4])))
    return rows


def predicted_rule(rows, path):
    raw = {row['id']: row for row in json.loads(path.read_bytes())['results']}
    results = {}
    for row in rows:
        report = raw[row['id']].get('assessment') or {}
        move = next((m for m in report.get('moves', []) if m['moveUci'] == row['moveUci']), {})
        results[row['id']] = {dimension: int(move.get(dimension, {}).get('support') == 'supported')
                              for dimension in ['tactical', 'positional']}
    return results


def statistics(labels, probabilities, threshold=0.5, binary=False):
    known = np.array([label is not None for label in labels])
    y = np.array([bool(label) for label in labels])[known]
    p = np.asarray(probabilities)[known]
    predict = p >= threshold
    tp = int(np.sum(y & predict))
    fn = int(np.sum(y & ~predict))
    fp = int(np.sum(~y & predict))
    tn = int(np.sum(~y & ~predict))
    return dict(tp=tp, fn=fn, fp=fp, tn=tn, unknown=int(np.sum(~known)),
                balancedAccuracy=(tp/(tp+fn) + tn/(tn+fp))/2 if tp+fn and tn+fp else None,
                averagePrecision=float(average_precision_score(y, p)) if tp+fn and tn+fp and not binary else None,
                brier=float(brier_score_loss(y, p)) if len(y) and not binary else None)


def mixed_label(row):
    t, p = row['tactical'], row['positional']
    return True if t is True and p is True else False if t is False or p is False else None


def measure(rows, by_dim, binary=False):
    output = {d: statistics([row[d] for row in rows], by_dim[d], binary=binary)
              for d in ['tactical', 'positional']}
    # Requiring both independent labels avoids treating the two head
    # probabilities as statistically independent or multiplying them.
    mixed = np.minimum(by_dim['tactical'], by_dim['positional'])
    output['mixed'] = statistics([mixed_label(row) for row in rows], mixed, binary=True)
    return output


def run(train_rows, evaluation_rows, rule_path, feature_set):
    if {row['fenIdentity'] for row in train_rows} & {row['fenIdentity'] for row in evaluation_rows}:
        raise ValueError('Train and evaluation contain the same board')
    train = [row for row in train_rows if row['features'] is not None]
    evaluation = [row for row in evaluation_rows if row['features'] is not None]
    def inputs(rows):
        full = np.array([row['features'] for row in rows])
        if feature_set == 'evaluation':
            return full[:, 4:7]
        if feature_set == 'board-and-line':
            return np.delete(full, [4, 5, 6], axis=1)
        return full

    test_x = inputs(evaluation)
    rules = predicted_rule(evaluation, rule_path)
    report = {'rules': measure(evaluation, {d:[rules[row['id']][d] for row in evaluation]
                                           for d in ['tactical', 'positional']}, binary=True)}
    models = {
        'prior': lambda: DummyClassifier(strategy='prior'),
        'logistic': lambda: make_pipeline(StandardScaler(), LogisticRegression(C=.25)),
        'small_boosted_tree': lambda: HistGradientBoostingClassifier(
            max_iter=80, max_leaf_nodes=5, min_samples_leaf=10, l2_regularization=1.0, random_state=0),
        **{f'small_neural_network_seed_{seed}': lambda seed=seed: make_pipeline(
            StandardScaler(), MLPClassifier(hidden_layer_sizes=(16,), activation='tanh',
                                           solver='lbfgs', alpha=3.0, max_iter=1000, random_state=seed))
            for seed in (11, 22, 33)},
    }
    for name, factory in models.items():
        by_dim = {}
        for d in ['tactical', 'positional']:
            eligible = [row for row in train if row[d] is not None]
            model = factory()
            model.fit(inputs(eligible), [int(row[d]) for row in eligible])
            by_dim[d] = model.predict_proba(test_x)[:, 1]
        report[name] = measure(evaluation, by_dim)
    return dict(trainPositions=len(train), suppliedTrainPositions=len(train_rows),
                evaluatedPositions=len(evaluation), suppliedEvaluationPositions=len(evaluation_rows),
                metrics=report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--train', type=Path, nargs=2, action='append', required=True,
                        metavar=('REFERENCE', 'ENGINE_DIRECTORY'))
    parser.add_argument('--test', type=Path, nargs=2, required=True,
                        metavar=('REFERENCE', 'ENGINE_DIRECTORY'))
    parser.add_argument('--rules', required=True, type=Path)
    parser.add_argument('--feature-set', choices=['full', 'evaluation', 'board-and-line'], default='full')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    if args.output.resolve().is_relative_to(repo):
        raise ValueError('Keep private experiment results outside the checkout')
    train = [row for pair in args.train for row in read_rows(*pair)]
    evaluation = read_rows(*args.test)
    result = dict(scope="Development pilot only. Previously reviewed course test; no new generalisation claim.",
                  assumptions=["Only moves present in the supplied legal engine candidates enter the comparison.",
                               "Neither course identity nor classifier predictions are training inputs.",
                               "Uncertain labels are excluded and no threshold or neural seed is selected by test performance."],
                  sklearn=sklearn.__version__, featureSet=args.feature_set,
                  referenceHashes=[hashlib.sha256(pair[0].read_bytes()).hexdigest() for pair in [*args.train, args.test]],
                  **run(train, evaluation, args.rules, args.feature_set))
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
