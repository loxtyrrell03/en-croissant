"""Probe frozen chess representations for exact played-move diagnosis.

This offline benchmark ranks reviewed decisions using existing Stockfish
searches. It never produces app verdicts. See maia-branch-probe/protocol.json.
"""
import argparse
from collections import Counter, defaultdict, deque
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import sys
import time

import chess
from maia3.dataset import get_historical_tokens, get_legal_moves_mask, tokenize_board
from maia3.models import MAIA3Model
from maia3.uci import get_all_possible_moves, load_model, parse_args
from maia3.utils import mirror_move
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits
import torch


SEED = 47
ELO = 1900
PLY_SNAPSHOTS = (2, 4)
ARMS = (
    'evaluation-loss', 'score-logistic', 'line-logistic', 'line-tree',
    'line-network', 'line-maia-policy', 'line-maia-root', 'line-maia-branches',
    'line-random-branches',
)
NEURAL = ('line-maia-policy', 'line-maia-root', 'line-maia-branches')


def read(path):
    return json.loads(path.read_bytes())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def import_sibling(filename):
    name = filename.removesuffix('.py').replace('-', '_')
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def playable_branch(root, move_uci, root_line, reply_lines):
    """Prefer the separate leading reply when its exact child board matches."""
    if not root_line or root_line['pvUci'][0] != move_uci:
        raise ValueError(f'Root line does not start with {move_uci}')
    move = chess.Move.from_uci(move_uci)
    if move not in root.legal_moves:
        raise ValueError(f'Illegal first move {move_uci}')
    child = root.copy(stack=False)
    child.push(move)
    child_fen = child.fen()
    reply = reply_lines[0] if reply_lines else None
    if reply and chess.Board(reply['fen']).fen() != child_fen:
        raise ValueError(f'Reply frame belongs to a different child of {move_uci}')
    line = [move_uci, *reply['pvUci']] if reply else root_line['pvUci']
    boards = [root]
    for uci in line[:max(PLY_SNAPSHOTS)]:
        current = boards[-1].copy(stack=False)
        ply = chess.Move.from_uci(uci)
        if ply not in current.legal_moves:
            raise ValueError(f'Illegal continuation {uci} at {current.fen()}')
        current.push(ply)
        boards.append(current)
    return boards


def validate_split(training, testing):
    for attribute in ('id', 'game', 'event'):
        if {getattr(row, attribute) for row in training} & {getattr(row, attribute) for row in testing}:
            raise ValueError(f'Training and evaluation share {attribute}')

    def board_key(row):
        board = chess.Board(row.board + ' 0 1')
        normalized = board if board.turn == chess.WHITE else board.mirror()
        return ' '.join(normalized.fen().split()[:4])

    if {board_key(row) for row in training} & {board_key(row) for row in testing}:
        raise ValueError('Training and evaluation share a color-normalized board')


class Encoder:
    def __init__(self, checkpoint):
        torch.set_num_threads(1)
        torch.manual_seed(SEED)
        self.cfg = parse_args(['--model', 'maia3-5m', '--checkpoint', str(checkpoint),
                               '--device', 'cpu', '--no-use-amp'])
        self.pretrained = load_model(self.cfg)
        self.random = MAIA3Model(self.cfg).eval()
        self.move_indices = {move: index for index, move in enumerate(get_all_possible_moves())}
        self.model_times = defaultdict(list)

    @torch.inference_mode()
    def encode(self, histories, name):
        histories = [deque(map(tokenize_board, history), maxlen=self.cfg.history)
                     for history in histories]
        tokens = torch.stack([get_historical_tokens(history, self.cfg, 0., 0., 0., 0.)
                              for history in histories])
        elos = torch.full((len(histories),), ELO, dtype=torch.long)
        model = self.pretrained if name == 'pretrained' else self.random
        captured = []
        with model.last_ln.register_forward_hook(lambda _module, _args, out: captured.append(out)):
            start = time.perf_counter()
            logits, _, _ = model(tokens, elos, elos)
            elapsed = (time.perf_counter() - start) * 1000
        self.model_times[name].append(elapsed)
        if len(captured) != 1:
            raise RuntimeError('Expected one pooled embedding batch')
        return captured[0].numpy(), logits

    def policy(self, board, logits, uci):
        mask = get_legal_moves_mask(board, self.move_indices)
        if not mask.any():
            return np.zeros(3)
        legal_policy = logits.masked_fill(~mask, -torch.inf).softmax(dim=0)
        probabilities = legal_policy[mask].numpy()
        entropy = -np.sum(probabilities * np.log(probabilities.clip(min=1e-12)))
        probability = 0.
        if uci:
            if chess.Move.from_uci(uci) not in board.legal_moves:
                raise ValueError(f'Cannot score illegal move {uci}')
            key = uci if board.turn == chess.WHITE else mirror_move(uci)
            index = self.move_indices[key]
            probability = float(legal_policy[index])
        return np.array([probability, probabilities.max(), entropy])

    def features(self, root, best, played):
        branches = (best, played)
        histories = [[root]] + [branch[:2] for branch in branches]
        histories += [branch[:ply + 1] for ply in PLY_SNAPSHOTS for branch in branches]
        pretrained, policy = self.encode(histories, 'pretrained')
        random, _ = self.encode(histories, 'random')

        def contrast(embedded):
            # A terminal short line can end before a scheduled snapshot.
            # Carry forward its last board and expose actual depth separately.
            delta = np.concatenate([embedded[ix] - embedded[ix - 1] for ix in (4, 6)])
            lengths = [min(len(branch) - 1, ply) / ply
                       for ply in PLY_SNAPSHOTS for branch in branches]
            return np.concatenate([embedded[0], delta, lengths])

        probabilities = []
        for ix, branch in enumerate(branches, start=1):
            move = branch[0].uci(branch[1].peek())
            reply = branch[1].uci(branch[2].peek()) if len(branch) > 2 else None
            probabilities.extend([
                self.policy(root, policy[0], move),
                self.policy(branch[1], policy[ix], reply),
            ])
        return {
            'line-maia-policy': np.concatenate(probabilities),
            'line-maia-root': pretrained[0],
            'line-maia-branches': contrast(pretrained),
            'line-random-branches': contrast(random),
        }


def feature_rows(encoder, reports):
    output = {}
    elapsed = []
    for case in reports:
        row, frame = case['row'], case['frame']
        started = time.perf_counter()
        root = chess.Board(row['fen'])
        best_line, played_line = frame['best'], frame.get('played')
        best = playable_branch(root, best_line['pvUci'][0], best_line, frame['bestReply'])
        if row['playedMoveUci'] == best_line['pvUci'][0]:
            played = best
        elif played_line and frame['legalPair'] and frame['legalPlayed']:
            played = playable_branch(root, row['playedMoveUci'], played_line, frame['playedReply'])
        else:
            # Match the simple baselines on incomplete lines and record coverage.
            continue
        output[row['id']] = encoder.features(root, best, played)
        elapsed.append((time.perf_counter() - started) * 1000)
    return output, elapsed


def probe(training, testing, feature_map, model, score_control='evaluation-loss'):
    validate_split(training, testing)
    existing = model.model_specs(max_iterations=3000)
    specs = {name: existing[name] for name in ARMS if name in existing}
    predictions = model.fit(training, testing, specs)
    predictions[score_control] = {axis: np.array([row.scores[-1] for row in testing])
                                  for axis in model.AXES}
    for arm in (*NEURAL, 'line-random-branches'):
        by_axis = {}
        for axis in model.AXES[:2]:
            known = [row for row in training if row.label[axis] is not None]
            line_scaler, latent_scaler = StandardScaler(), StandardScaler()
            line_scaler.fit(np.stack([row.continuation for row in known]))
            latent_scaler.fit(np.stack([feature_map[row.id][arm] for row in known]))

            def inputs(rows):
                lines = line_scaler.transform(np.stack([row.continuation for row in rows]))
                latent = latent_scaler.transform(np.stack([feature_map[row.id][arm] for row in rows]))
                # Equal expected contribution from the feature blocks by
                # dimension, retaining the earlier line model's scale.
                latent *= np.sqrt(lines.shape[1] / latent.shape[1])
                return np.column_stack([lines, latent])

            fitted = LogisticRegression(C=.1).fit(inputs(known), [row.label[axis] for row in known])
            by_axis[axis] = fitted.predict_proba(inputs(testing))[:, 1]
        by_axis['mixed'] = np.minimum(by_axis['tactical'], by_axis['positional'])
        predictions[arm] = by_axis
    return predictions


def score(rows, predictions, axes):
    cells = {}
    for axis in axes:
        counts = Counter('positive' if row.label[axis] is True else
                         'negative' if row.label[axis] is False else 'uncertain' for row in rows)
        cells[axis] = {
            'reference': dict(counts),
            'incumbent': {
                'truePositives': sum(row.current[axis] and row.label[axis] is True for row in rows),
                'falsePositives': sum(row.current[axis] and row.label[axis] is False for row in rows),
            },
            'rankings': {},
        }
        by_event = defaultdict(list)
        for index, row in enumerate(rows):
            if not row.current[axis]:
                by_event[row.event].append(index)
        for arm, raw in predictions.items():
            probability = raw[axis]
            selected = []
            event_yield = {}
            for event, indices in by_event.items():
                slots = len({rows[index].game for index in indices}) // 4
                games = set()
                picks = []
                ordered = sorted(indices, key=lambda ix: (
                    -probability[ix], hashlib.sha256(rows[ix].id.encode()).digest()))
                for ix in ordered:
                    if len(picks) == slots:
                        break
                    if rows[ix].game not in games:
                        games.add(rows[ix].game)
                        picks.append(rows[ix])
                event_yield[event] = sum(row.label[axis] is True for row in picks)
                selected.extend(picks)
            known = [ix for indices in by_event.values() for ix in indices
                     if rows[ix].label[axis] is not None]
            labels = [rows[ix].label[axis] for ix in known]
            cells[axis]['rankings'][arm] = {
                'unresolvedAP': float(average_precision_score(labels, probability[known]))
                if len(set(labels)) == 2 else None,
                'slots': len(selected),
                'positives': sum(row.label[axis] is True for row in selected),
                'negatives': sum(row.label[axis] is False for row in selected),
                'uncertain': sum(row.label[axis] is None for row in selected),
                'positivesByEvent': event_yield,
                'selected': [row.id for row in selected],
            }
    return cells


def passes_gate(axis):
    rankings = axis['rankings']
    controls = [value for name, value in rankings.items() if name not in NEURAL]
    strongest = max(controls, key=lambda value: (value['positives'], -value['negatives']))
    return [
        arm for arm in NEURAL
        if rankings[arm]['positives'] >= strongest['positives'] + 2
        and rankings[arm]['negatives'] <= strongest['negatives']
        and sum(value > strongest['positivesByEvent'][event] for event, value in
                rankings[arm]['positivesByEvent'].items()) >= 2
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('protocol', type=Path)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--train', type=Path, nargs='+', required=True)
    parser.add_argument('--transfer', type=Path, nargs=3, required=True,
                        metavar=('SHELTER_A', 'SHELTER_B', 'PRIMARY'))
    args = parser.parse_args()
    protocol = read(args.protocol)
    inputs = {name: [sha256(path) for path in paths]
              for name, paths in [('training', args.train), ('transfer', args.transfer)]}
    if inputs != protocol['replays'] or sha256(args.checkpoint) != protocol['checkpoint']:
        raise ValueError('Replay or checkpoint differs from the frozen protocol')
    model = import_sibling('decision-evidence-line-model.py')
    mistakes = import_sibling('decision-evidence-mistake-model.py')
    model.EVENT_FAMILIES.update(protocol['eventFamilies'])
    encoder = Encoder(args.checkpoint)
    replays = [case for path in (*args.train, *args.transfer) for case in read(path)['results']]
    features, elapsed = feature_rows(encoder, replays)
    training = mistakes.read_reports(model, args.train, set(protocol['disputedTrainingLabels']))
    transfers = [mistakes.read_reports(model, [path], set()) for path in args.transfer]
    validate_split(training, [row for group in transfers for row in group])
    original = [len(training), *map(len, transfers)]
    training = [row for row in training if row.id in features]
    transfers = [[row for row in rows if row.id in features] for rows in transfers]
    with threadpool_limits(limits=1):
        results = {}
        for name, rows in zip(('shelter-a', 'shelter-b', 'primary'), transfers, strict=True):
            predictions = probe(training, rows, features, model)
            results[name] = score(rows, predictions, model.AXES)
    report = {
        'protocolSha256': sha256(args.protocol),
        'runnerSha256': sha256(Path(__file__)),
        'parameters': sum(value.numel() for value in encoder.pretrained.parameters()),
        'software': {name: importlib.metadata.version(name)
                     for name in ('maia3', 'torch', 'python-chess', 'numpy', 'scikit-learn')},
        'inputCounts': original,
        'scoredCounts': [len(training), *map(len, transfers)],
        'cost': {
            'additionalStockfishNodes': 0,
            'medianPretrainedForwardMs': float(np.median(encoder.model_times['pretrained'][1:])),
            'medianAllFeatureMsIncludingRandomControl': float(np.median(elapsed[1:])),
            'pretrainedPositionsPerDecision': 7,
        },
        'results': results,
        'promisingPrimaryArms': {axis: passes_gate(cell)
                                 for axis, cell in results['primary'].items()},
    }
    with args.output.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write('\n')


if __name__ == '__main__':
    main()
