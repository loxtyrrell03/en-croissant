"""Compare learned nominations for unresolved played-move diagnoses.

Features come from legally replayed matched Stockfish continuations.
The incumbent diagnosis is only used to determine which cases need review.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import chess
import numpy as np


def load_module(path):
    spec = importlib.util.spec_from_file_location('line_model', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def read_reports(model, paths, disputed):
    result = []
    for path in paths:
        for case in model.read(path)['results']:
            row, label = case['row'], case['label'].copy()
            if label['scope'] != 'mistake-mechanism' or label['moveUci'] != row['playedMoveUci']:
                raise ValueError('A reference must match the actual played move')
            if row['id'] in disputed:
                label['positional'] = None
            label['mixed'] = model.joint(label['tactical'], label['positional'])
            current = {axis: (case['report']['mistake'] or {}).get(axis, {}).get('support') == 'supported'
                       for axis in model.AXES[:2]}
            current['mixed'] = current['tactical'] and current['positional']
            board = chess.Board(row['fen'])
            frame = case['frame']
            best = frame['best']
            if best['fen'] != row['fen']:
                raise ValueError('Best line belongs to a different position')
            played = frame['played'] if frame['legalPair'] and frame['legalPlayed'] else None
            played_is_best = row['playedMoveUci'] == best['pvUci'][0]
            if played:
                if played['fen'] != row['fen'] or played['pvUci'][0] != row['playedMoveUci']:
                    raise ValueError('Played line belongs to a different decision')
            initial = model.board_features(board, board.turn)
            leader = model.replay(board, best, initial)
            other = model.replay(board, played, initial) if played else (
                leader if played_is_best else np.zeros_like(leader))
            base_eval = model.evaluation(best)
            played_eval = model.evaluation(played) if played else base_eval
            scores = np.array([int(played is not None), int(played_is_best),
                               int(board.is_check()), board.legal_moves.count(),
                               model.material(board, board.turn), base_eval,
                               played_eval, base_eval - played_eval])
            features = np.concatenate((scores, initial, leader, other, leader - other))
            result.append(model.Decision(
                row['id'], ' '.join(row['fen'].split()[:4]), row['sourceGroup'],
                model.EVENT_FAMILIES.get(row['event'], row['event']), label, current, scores, features))
    if len({row.id for row in result}) != len(result):
        raise ValueError('A sample contains duplicate decision IDs')
    return result


def score_transfer(model, testing, predictions):
    score = {}
    for name, predictions_by_axis in predictions.items():
        score[name] = {}
        for axis, values in predictions_by_axis.items():
            cell = model.metrics(testing, values, axis)
            unresolved = [(row, value) for row, value in zip(testing, values, strict=True)
                          if not row.current[axis]]
            unresolved.sort(key=lambda pair: (-pair[1], hashlib.sha256(pair[0].id.encode()).digest()))
            nominated = unresolved[:len(testing) // 4]
            cell.update(
                reviewSlots=len(nominated),
                reviewedPositives=sum(row.label[axis] is True for row, _ in nominated),
                reviewedNegatives=sum(row.label[axis] is False for row, _ in nominated),
                uncertainReferences=sum(row.label[axis] is None for row, _ in nominated),
            )
            score[name][axis] = cell
    return score


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_model', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--train', type=Path, nargs='+', required=True)
    parser.add_argument('--transfer', type=Path, nargs='+', required=True)
    parser.add_argument('--uncertain-positional', nargs='*', default=[])
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(args.base_model.resolve().parents[2]):
        raise ValueError('Write raw experimental scores outside the repository')
    model = load_module(args.base_model)
    model.EVENT_FAMILIES.update({
        'asian-disabilities-men-2026': 'asian-disabilities-2026',
        'asian-disabilities-women-2026': 'asian-disabilities-2026',
        'european-youth-g18-2026': 'european-youth-2026',
        'european-youth-u16-2026': 'european-youth-2026',
        'grand-swiss-open-2025': 'grand-swiss-2025',
        'grand-swiss-women-2025': 'grand-swiss-2025',
        'guernsey-challengers-2026': 'guernsey-2026',
        'guernsey-open-2026': 'guernsey-2026',
        'biel-mto-2026': 'biel-2026',
        'biel-ato-2026': 'biel-2026',
    })
    training = read_reports(model, args.train, set(args.uncertain_positional))
    specs = model.model_specs(max_iterations=3000)
    with model.threadpool_limits(limits=1):
        unlabeled = list(read_reports(model, args.transfer, set()))
        predictions = model.fit(training, unlabeled, specs)
        transfer = {}
        offset = 0
        for path in args.transfer:
            size = len(model.read(path)['results'])
            cohort = unlabeled[offset:offset+size]
            subset = {name: {axis: values[offset:offset+size] for axis, values in by_axis.items()}
                      for name, by_axis in predictions.items()}
            transfer[path.parent.name] = dict(
                decisions=size, events=sorted({row.event for row in cohort}),
                scores=score_transfer(model, cohort, subset),
            )
            offset += size
        groups, predictions = model.grouped_predictions(training, specs)
        development = model.score(training, groups, predictions, specs)
    output = dict(protocol=1, scope='played-move diagnostic nomination, no added engine searches',
                  versions={'scikitLearn': model.sklearn.__version__, 'pythonChess': chess.__version__},
                  originalFeatureModelSha256=model.sha256(args.base_model),
                  trainingSize=len(training), trainingEvents=list(groups),
                  sourceReportHashes={key: [model.sha256(path) for path in paths]
                                      for key, paths in [('train', args.train), ('transfer', args.transfer)]},
                  uncertainPositionalTrainingLabels=args.uncertain_positional,
                  transfer=transfer, groupedDevelopment=development)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(output, stream, indent=2)
        stream.write('\n')


if __name__ == '__main__':
    main()
