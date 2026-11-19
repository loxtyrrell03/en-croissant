"""Screen learned position rankings against grouped classical-game references.

The models see three legal Stockfish continuations and no reference or app
diagnosis features. App diagnoses are used only to define the unresolved search
pool and report the incumbent. A ranking is a search suggestion, not evidence.
"""

import argparse
import hashlib
import json
from dataclasses import dataclass
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
from threadpoolctl import threadpool_limits


AXES = ('tactical', 'positional', 'mixed')
MATERIAL = (0, 1, 3, 3, 5, 9, 0)
# Sections of the same tournament share a fold.
EVENT_FAMILIES = {
    'naycc-u14-2026': 'naycc-2026',
    'naycc-u16-2026': 'naycc-2026',
    'naycc-u18-2026': 'naycc-2026',
    'naycc-g16-2026': 'naycc-2026',
}


def read(path):
    return json.loads(path.read_bytes())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative_rank(square, color):
    rank = chess.square_rank(square)
    return rank if color else 7 - rank


def pawn_features(board, color):
    pawns = list(board.pieces(chess.PAWN, color))
    enemies = list(board.pieces(chess.PAWN, not color))
    files = [chess.square_file(square) for square in pawns]
    enemy_files = {chess.square_file(square) for square in enemies}
    doubled = len(files) - len(set(files))
    isolated = sum(file - 1 not in files and file + 1 not in files for file in files)
    advanced = sum(max(0, relative_rank(square, color) - 3) for square in pawns)
    passed_ranks = [
        relative_rank(square, color) for square in pawns
        if not any(abs(chess.square_file(other) - chess.square_file(square)) <= 1
                   and relative_rank(other, color) > relative_rank(square, color)
                   for other in enemies)
    ]
    rooks = [chess.square_file(square) for square in board.pieces(chess.ROOK, color)]
    open_rooks = sum(file not in files and file not in enemy_files for file in rooks)
    semi_open_rooks = sum(file not in files and file in enemy_files for file in rooks)
    return [len(pawns), doubled, isolated, advanced, len(passed_ranks),
            max(passed_ranks, default=0), open_rooks, semi_open_rooks]


def board_features(board, side):
    result = []
    for color in (side, not side):
        counts = [len(board.pieces(role, color)) for role in range(1, 6)]
        target = board.king(color)
        neighbors = chess.SquareSet(chess.BB_KING_ATTACKS[target])
        cover = len(neighbors & board.pieces(chess.PAWN, color))
        pressure = sum(board.is_attacked_by(not color, square) for square in neighbors)
        occupied = chess.SquareSet(board.occupied_co[color])
        activity = sum(len(board.attacks(square) - occupied)
                       for role in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
                       for square in board.pieces(role, color))
        result.extend([*counts, *pawn_features(board, color), cover, pressure, activity])
    return np.asarray(result, dtype=float)


def material(board, color):
    return sum(MATERIAL[role] * (len(board.pieces(role, color)) -
                                  len(board.pieces(role, not color)))
               for role in range(chess.PAWN, chess.KING))


def evaluation(line):
    if line['mate'] is not None:
        return 12 if line['mate'] > 0 else -12
    return np.clip(line['cp'] / 100, -12, 12)


def replay(board, line, initial):
    branch = board.copy(stack=False)
    initial_material = material(board, board.turn)
    observations, changes = [], []
    for uci in line['pvUci'][:12]:
        move = branch.parse_uci(uci)
        if not move:
            raise ValueError('A Stockfish continuation contained a null move')
        capture = chess.PAWN if branch.is_en_passant(move) else branch.piece_type_at(move.to_square)
        taking = branch.is_capture(move)
        mover = branch.piece_type_at(move.from_square)
        castling = branch.is_castling(move)
        branch.push(move)
        observations.append([
            mover, MATERIAL[capture or 0] if taking else 0, int(taking),
            int(branch.is_check()), int(bool(move.promotion)), int(castling),
            min(30, branch.legal_moves.count()), material(branch, board.turn) - initial_material,
        ])
        changes.append(board_features(branch, board.turn) - initial)
    if not observations:
        raise ValueError('An analyzed root had an empty continuation')
    observations = np.asarray(observations)
    changes = np.asarray(changes)
    last = changes[-1]
    stable = np.all(changes[-3:] == last, axis=0) * last if len(changes) >= 3 else np.zeros_like(last)
    early = observations[:4]
    return np.concatenate((
        [len(observations)], observations[0], np.sum(early[:, 2:6], axis=0),
        np.sum(observations[:, 2:6], axis=0),
        [np.min(observations[:, -1]), np.max(observations[:, -1]), observations[-1, -1]],
        np.abs(changes[:4]).max(axis=0), stable,
    ))


def features(fen, lines):
    board = chess.Board(fen)
    initial = board_features(board, board.turn)
    if not 1 <= len(lines) <= 3:
        raise ValueError('Expected one to three Stockfish root choices')
    if any(not line['pvUci'] for line in lines):
        raise ValueError('An analyzed root had an empty continuation')
    if any(line['fen'] != fen for line in lines):
        raise ValueError('Stockfish lines belong to a different board')
    if len({line['pvUci'][0] for line in lines}) != len(lines):
        raise ValueError('Stockfish root choices must be distinct')
    scores = [evaluation(line) for line in lines]
    # Repeat the last line's features when MultiPV is short, with the count as
    # an explicit mask. Such roots cannot be mistaken for three distinct lines.
    branches = [replay(board, line, initial) for line in lines]
    scores.extend([scores[-1]] * (3 - len(scores)))
    branches.extend([branches[-1]] * (3 - len(branches)))
    minimal = np.asarray([len(lines), int(board.is_check()), board.legal_moves.count(),
                          material(board, board.turn), *scores,
                          scores[0] - scores[1], scores[0] - scores[2]])
    compared = np.stack(branches)
    full = np.concatenate((minimal, initial, compared[0], compared.mean(axis=0),
                           np.ptp(compared, axis=0)))
    return minimal, full


def joint(tactical, positional):
    if tactical is False or positional is False:
        return False
    if tactical is True and positional is True:
        return True
    return None


@dataclass
class Decision:
    id: str
    board: str
    game: str
    event: str
    label: dict
    current: dict
    scores: np.ndarray
    continuation: np.ndarray


def load(replay_path, manifest):
    profiles = {row['name']: row for row in read(manifest)}
    decisions = []
    for case in read(replay_path)['results']:
        row = case['row']
        if row['stratum'] != 'ordinary':
            raise ValueError('The screening cohort must be ordinary games')
        profile = profiles[case['source']]
        root = Path(profile['cache']) / f"tournament-engine-{profile['profile']}" / f"{row['id']}.json"
        raw = read(root)
        if (raw['identity']['fen'] != row['fen'] or case['label']['id'] != row['id']
                or case['label']['scope'] != 'position-character'):
            raise ValueError(f"Different board or label for {row['id']}")
        positions = case['report']['position']
        current = {axis: positions[axis]['support'] == 'supported' for axis in AXES[:2]}
        label = {axis: case['label'][axis] for axis in AXES[:2]}
        for values in (current, label):
            values['mixed'] = joint(values['tactical'], values['positional'])
        board, event = row['fen'], row['event']
        scores, continuation = features(board, raw['deep'][:3])
        decisions.append(Decision(row['id'], ' '.join(board.split()[:4]), row['sourceGroup'],
                                  EVENT_FAMILIES.get(event, event), label, current,
                                  scores, continuation))
    for attr in ('id', 'board', 'game'):
        if len({getattr(row, attr) for row in decisions}) != len(decisions):
            raise ValueError(f'Repeated {attr} in the screening cohort')
    return decisions


def assert_disjoint(training, testing):
    for attr in ('id', 'board', 'game', 'event'):
        if {getattr(row, attr) for row in training} & {getattr(row, attr) for row in testing}:
            raise ValueError(f'Training and evaluation share {attr}')


def model_specs(max_iterations=600):
    def neural(seed):
        return make_pipeline(StandardScaler(),
                             MLPClassifier(hidden_layer_sizes=(12, 6), solver='lbfgs',
                                           alpha=4., random_state=seed, max_iter=max_iterations))

    return {
        'prior': ('scores', [lambda: DummyClassifier(strategy='prior')]),
        'score-logistic': ('scores', [lambda: make_pipeline(StandardScaler(), LogisticRegression(C=.1))]),
        'line-logistic': ('continuation', [lambda: make_pipeline(StandardScaler(), LogisticRegression(C=.1))]),
        'line-tree': ('continuation', [lambda: HistGradientBoostingClassifier(
            max_iter=60, max_leaf_nodes=4, min_samples_leaf=14, l2_regularization=4.,
            learning_rate=.06)]),
        'score-network': ('scores', [lambda seed=seed: neural(seed) for seed in (17, 47, 79)]),
        'line-network': ('continuation', [lambda seed=seed: neural(seed) for seed in (17, 47, 79)]),
    }


def fit(training, testing, specs):
    assert_disjoint(training, testing)
    predictions = {}
    for name, (attribute, factories) in specs.items():
        testing_inputs = np.stack([getattr(row, attribute) for row in testing])
        by_axis = {}
        for axis in AXES[:2]:
            labeled = [row for row in training if row.label[axis] is not None]
            inputs = np.stack([getattr(row, attribute) for row in labeled])
            targets = [row.label[axis] for row in labeled]
            if len(set(targets)) != 2:
                raise ValueError(f'Both labels are required to fit the {axis} axis')
            member_predictions = [
                factory().fit(inputs, targets).predict_proba(testing_inputs)[:, 1]
                for factory in factories
            ]
            by_axis[axis] = np.mean(member_predictions, axis=0)
        by_axis['mixed'] = np.minimum(by_axis['tactical'], by_axis['positional'])
        predictions[name] = by_axis
    return predictions


def grouped_predictions(decisions, specs):
    predictions = {}
    groups = sorted({decision.event for decision in decisions})
    for group in groups:
        training = [row for row in decisions if row.event != group]
        testing = [row for row in decisions if row.event == group]
        predictions[group] = fit(training, testing, specs)
    return groups, predictions


def metrics(decisions, probabilities, axis):
    known = [(row.label[axis], value) for row, value in zip(decisions, probabilities, strict=True)
             if row.label[axis] is not None]
    labels, scores = map(list, zip(*known)) if known else ([], [])
    return {
        'positives': labels.count(True),
        'negatives': labels.count(False),
        'uncertain': len(decisions) - len(labels),
        'averagePrecision': (float(average_precision_score(labels, scores))
                             if len(set(labels)) == 2 else None),
        # The minimum of the two heads is a rank, not a joint probability.
        'brier': float(brier_score_loss(labels, scores)) if labels and axis != 'mixed' else None,
    }


def select(decisions, probabilities, axis):
    # Allocate review to one fifth of unresolved boards in each event. Unknown
    # references still take a slot. Stable hash tie-breaking is label-blind.
    unresolved = [(row, p) for row, p in zip(decisions, probabilities, strict=True)
                  if not row.current[axis]]
    count = len(unresolved) // 5
    order = sorted(unresolved, key=lambda pair: (-pair[1], hashlib.sha256(pair[0].id.encode()).digest()))
    return [row for row, _ in order[:count]]


def score(decisions, groups, predictions, specs):
    report = {}
    for axis in AXES:
        known = [row for row in decisions if row.label[axis] is not None]
        current_tp = sum(row.label[axis] is True and row.current[axis] for row in known)
        current_fp = sum(row.label[axis] is False and row.current[axis] for row in known)
        report[axis] = {'incumbent': {'tp': current_tp, 'fp': current_fp}, 'models': {}}
        for name in specs:
            all_rows, all_scores, selected, per_event = [], [], [], {}
            for group in groups:
                rows = [row for row in decisions if row.event == group]
                values = predictions[group][name][axis]
                picks = select(rows, values, axis)
                per_event[group] = {
                    'reviewedPositives': sum(row.label[axis] is True for row in picks),
                    'reviewedNegatives': sum(row.label[axis] is False for row in picks),
                    'uncertainReferences': sum(row.label[axis] is None for row in picks),
                    'selected': [row.id for row in picks],
                }
                selected.extend(picks)
                all_rows.extend(rows)
                all_scores.extend(values)
            report[axis]['models'][name] = {
                **metrics(all_rows, all_scores, axis),
                'reviewSlots': len(selected),
                'reviewedPositives': sum(row.label[axis] is True for row in selected),
                'reviewedNegatives': sum(row.label[axis] is False for row in selected),
                'uncertainReferences': sum(row.label[axis] is None for row in selected),
                'events': per_event,
            }
    return report


def score_positional_in_tactical_positions(decisions, groups, predictions, specs):
    # Secondary diagnostic. Conditioning on the reference is for evaluation
    # only, to distinguish mixed positions from purely tactical ones.
    indices = {
        group: [(index, row) for index, row in enumerate(
            row for row in decisions if row.event == group) if row.label['tactical'] is True]
        for group in groups
    }
    rows = [row for group in groups for _, row in indices[group]]
    return {name: metrics(rows, [
        predictions[group][name]['positional'][index]
        for group in groups for index, _ in indices[group]
    ], 'positional') for name in specs}


def screen(report):
    """Frozen futility screen for the two neural arms, never an app threshold."""
    results = {}
    for axis in ('positional', 'mixed'):
        models = report[axis]['models']
        controls = [model for name, model in models.items() if not name.endswith('-network')]
        for name in ('score-network', 'line-network'):
            candidate = models[name]
            best_ap = max(control['averagePrecision'] for control in controls)
            best_yield = max(control['reviewedPositives'] for control in controls)
            most_specific = min(control['reviewedNegatives'] for control in controls
                                if control['reviewedPositives'] == best_yield)
            results[f'{axis}:{name}'] = (
                candidate['averagePrecision'] >= best_ap + .03
                and candidate['reviewedPositives'] >= best_yield + 2
                and candidate['reviewedNegatives'] <= most_specific
            )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('worker_replay', type=Path)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--network-max-iterations', type=int, default=600,
                        help='Change only the neural optimizer budget for a convergence check')
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep position rankings outside the checkout')
    decisions = load(args.worker_replay, args.manifest)
    specs = model_specs(args.network_max_iterations)
    with threadpool_limits(limits=1):
        groups, predictions = grouped_predictions(decisions, specs)
    report = score(decisions, groups, predictions, specs)
    result = {
        'workerReplaySha256': sha256(args.worker_replay),
        'manifestSha256': sha256(args.manifest),
        'scriptSha256': sha256(Path(__file__)),
        'scikitLearn': sklearn.__version__,
        'pythonChess': chess.__version__,
        'networkMaxIterations': args.network_max_iterations,
        'games': len(decisions),
        'groups': groups,
        'featureCounts': {name: len(getattr(decisions[0], name)) for name in ('scores', 'continuation')},
        'metrics': report,
        'positionalInReviewedTacticalPositions': score_positional_in_tactical_positions(
            decisions, groups, predictions, specs),
        'passesDevelopmentScreen': screen(report),
    }
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, indent=2)


if __name__ == '__main__':
    main()
