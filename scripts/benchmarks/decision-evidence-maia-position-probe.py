"""Compare frozen chess representations on position character before a move."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import chess
import numpy as np
from sklearn.model_selection import GroupKFold
from threadpoolctl import threadpool_limits


def load_probe():
    source = Path(__file__).with_name('decision-evidence-maia-probe.py')
    spec = importlib.util.spec_from_file_location('maia_probe', source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def position_features(probe, encoder, fen, lines):
    board = chess.Board(fen)
    best, runner_up = (lines[0], lines[min(1, len(lines) - 1)])
    main, other = [probe.playable_branch(board, line['pvUci'][0], line, [])
                   for line in (best, runner_up)]
    return encoder.features(board, main, other)


def load_transfer(probe, model, paths):
    sample, reference, engine, worker = [probe.read(path) for path in paths]
    labels = {item['id']: item for item in reference['cases']}
    roots = {item['id']: item for item in engine['rows']}
    reports = {item['id']: item['reports']['original'] for item in worker['results']}
    rows, frames = [], {}
    for item in sample['cases']:
        case_id, fen = item['id'], item['fen']
        if labels[case_id]['scope'] != 'position-character' or roots[case_id]['fen'] != fen:
            raise ValueError(f'Different label or board for {case_id}')
        lines = roots[case_id]['frames']['original']['lines'][:3]
        frames[case_id] = (fen, lines)
        label = {axis: labels[case_id][axis] for axis in model.AXES[:2]}
        current = {axis: reports[case_id]['position'][axis]['support'] == 'supported'
                   for axis in model.AXES[:2]}
        for values in (current, label):
            values['mixed'] = model.joint(values['tactical'], values['positional'])
        scores, continuation = model.features(fen, lines)
        rows.append(model.Decision(case_id, ' '.join(fen.split()[:4]), item['sourceGroup'],
                                   item['event'], label, current, scores, continuation))
    for attr in ('id', 'board', 'game'):
        if len({getattr(row, attr) for row in rows}) != len(rows):
            raise ValueError(f'Repeated {attr} in the position transfer')
    return rows, frames


def grouped_predictions(probe, model, rows, features):
    groups = [row.event for row in rows]
    predictions = {}
    covered = set()
    for fit, test in GroupKFold(n_splits=5).split(rows, groups=groups):
        result = probe.probe([rows[index] for index in fit], [rows[index] for index in test],
                             features, model, score_control='stockfish-gap')
        if set(test) & covered:
            raise ValueError('Repeated validation row')
        covered.update(test)
        for arm, values in result.items():
            destination = predictions.setdefault(arm, {axis: np.full(len(rows), np.nan)
                                                       for axis in model.AXES})
            for axis, ranks in values.items():
                destination[axis][test] = ranks
    if len(covered) != len(rows):
        raise ValueError('A validation row had no prediction')
    return predictions


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('protocol', type=Path)
    p.add_argument('checkpoint', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--train', type=Path, nargs=2, required=True, metavar=('REPLAY', 'MANIFEST'))
    p.add_argument('--transfer', type=Path, nargs=4, required=True,
                   metavar=('SAMPLE', 'REFERENCE', 'ROOTS', 'WORKER'))
    args = p.parse_args()
    probe = load_probe()
    protocol = probe.read(args.protocol)
    if {name: [probe.sha256(path) for path in paths] for name, paths in
        [('training', args.train), ('transfer', args.transfer)]} != protocol['replays']:
        raise ValueError('Inputs do not match the frozen replay hashes')
    if probe.sha256(args.checkpoint) != protocol['checkpoint']:
        raise ValueError('Checkpoint does not match the frozen weights')

    model = probe.import_sibling('decision-evidence-line-model.py')
    replay, manifest_path = args.train
    manifest = probe.read(manifest_path)
    training = model.load(replay, manifest_path)
    testing, frames = load_transfer(probe, model, args.transfer)
    probe.validate_split(training, testing)
    sources = {source['name']: source for source in manifest}
    for case in probe.read(replay)['results']:
        row, source = case['row'], sources[case['source']]
        path = Path(source['cache']) / f"tournament-engine-{source['profile']}" / f"{row['id']}.json"
        frames[row['id']] = (row['fen'], probe.read(path)['deep'][:3])
    encoder = probe.Encoder(args.checkpoint)
    features = {case_id: position_features(probe, encoder, fen, lines)
                for case_id, (fen, lines) in frames.items()}
    with threadpool_limits(limits=1):
        grouped = grouped_predictions(probe, model, training, features)
        external = probe.probe(training, testing, features, model, score_control='stockfish-gap')
    transfer = probe.score(testing, external, model.AXES)
    report = {
        'protocolSha256': probe.sha256(args.protocol),
        'runnerSha256': probe.sha256(Path(__file__)),
        'sharedRunnerSha256': probe.sha256(Path(probe.__file__)),
        'counts': {'training': len(training), 'transfer': len(testing)},
        'cost': {'additionalStockfishNodes': 0,
                 'medianPretrainedForwardMs': float(np.median(encoder.model_times['pretrained'][1:]))},
        'groupedDevelopment': probe.score(training, grouped, model.AXES),
        'transfer': transfer,
        'promisingTransferArms': {axis: probe.passes_gate(cell) for axis, cell in transfer.items()},
    }
    with args.output.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write('\n')


if __name__ == '__main__':
    main()
