"""Compare frozen Leela representations on classical chess diagnosis.

Reuse the reviewed Maia experiment and saved Stockfish searches. These are
research rankings. No chess claims follow from a model score.
"""
import argparse
import json
from pathlib import Path
import time

import chess
import numpy as np
import onnx
import onnxruntime
from onnx import TensorProto, helper
from threadpoolctl import threadpool_limits


SNAPSHOTS = (2, 4)
CANDIDATES = ('line-leela-root', 'line-leela-branches', 'line-leela-wdl')
LATENT_ARMS = (*CANDIDATES, 'line-random-board-branches')
ATTENTION_OUTPUT = '/encoder9/ln2'
WDL_OUTPUT = '/output/wdl'


def planes(board):
    """Encode the classical 112-plane format with Lc0's FEN-only fill."""
    mover = board.turn
    result = np.zeros((112, 64), dtype=np.float32)
    cursor = board.copy()
    for age in range(8):
        for side, color in enumerate((mover, not mover)):
            for piece in chess.PIECE_TYPES:
                for square in cursor.pieces(piece, color):
                    relative = square if mover else chess.square_mirror(square)
                    result[13 * age + 6 * side + piece - 1, relative] = 1
        if cursor.is_repetition(2):
            result[13 * age + 12].fill(1)
        if cursor.move_stack:
            cursor.pop()
        elif cursor.board_fen() == chess.STARTING_BOARD_FEN and cursor.fen() == chess.STARTING_FEN:
            break
        elif cursor.ep_square is not None:
            # In a history-free FEN, this is the only earlier move we know.
            offset = -8 if cursor.turn else 8
            destination = cursor.ep_square + offset
            origin = cursor.ep_square - offset
            cursor.remove_piece_at(destination)
            cursor.set_piece_at(origin, chess.Piece(chess.PAWN, not cursor.turn))
            cursor.ep_square = None
    for side, color in enumerate((mover, not mover)):
        result[104 + 2 * side].fill(board.has_queenside_castling_rights(color))
        result[105 + 2 * side].fill(board.has_kingside_castling_rights(color))
    result[108].fill(not mover)
    result[109].fill(board.halfmove_clock)
    result[111].fill(1)
    return result.reshape(112, 8, 8)


class Encoder:
    def __init__(self, path):
        graph = onnx.load(path)
        if not any(node.input and node.input[0] == ATTENTION_OUTPUT
                   and '/value/embed/matmul' in node.output for node in graph.graph.node):
            raise ValueError('Expected the final attention layer of the pinned T1 network')
        graph.graph.output.append(helper.make_tensor_value_info(
            ATTENTION_OUTPUT, TensorProto.FLOAT, [None, 256]))
        session_options = onnxruntime.SessionOptions()
        session_options.intra_op_num_threads = 4
        session_options.inter_op_num_threads = 1
        self.session = onnxruntime.InferenceSession(
            graph.SerializeToString(), session_options, providers=['CPUExecutionProvider'])
        self.project = np.random.default_rng(47).standard_normal(
            (112 * 64, 256), dtype=np.float32) / np.sqrt(112 * 64)
        self.forward_ms = []
        self.feature_ms = []

    def features(self, root, best, other):
        start = time.perf_counter()
        branches = (best, other)
        boards = [root]
        complete = []
        for ply in SNAPSHOTS:
            complete.append(all(len(branch) > ply for branch in branches))
            boards.extend(branch[min(ply, len(branch) - 1)] for branch in branches)
        inputs = np.stack([planes(board) for board in boards])
        forward = time.perf_counter()
        embedded, wdl = self.session.run(
            [ATTENTION_OUTPUT, WDL_OUTPUT], {'/input/planes': inputs})
        self.forward_ms.append((time.perf_counter() - forward) * 1000)
        if embedded.shape != (len(boards) * 64, 256) or wdl.shape != (len(boards), 3):
            raise ValueError('Unexpected attention or evaluation shape')
        if not np.isfinite(embedded).all() or not np.allclose(wdl.sum(axis=1), 1, atol=1e-6):
            raise ValueError('Invalid network output')
        root_perspective = np.stack([
            value if board.turn == root.turn else value[::-1]
            for board, value in zip(boards, wdl, strict=True)])
        pooled = embedded.reshape(len(boards), 64, 256).mean(axis=1)
        projected = inputs.reshape(len(boards), -1) @ self.project

        def contrast(values):
            differences = [
                values[ix + 1] - values[ix] if available else np.zeros_like(values[0])
                for ix, available in zip((1, 3), complete, strict=True)]
            return np.concatenate([values[0], *differences, complete])

        result = {
            'line-leela-root': pooled[0],
            'line-leela-branches': contrast(pooled),
            'line-leela-wdl': contrast(root_perspective),
            'line-random-board-branches': contrast(projected),
        }
        self.feature_ms.append((time.perf_counter() - start) * 1000)
        return result


def branch(probe, root, move, line, replies):
    """Use the existing exact-frame checks, retaining known line history."""
    verified = probe.playable_branch(root, move, line, replies)
    current = root.copy()
    boards = [current.copy()]
    for reached in verified[1:]:
        current.push(reached.peek())
        boards.append(current.copy())
    return boards


def mistake_features(probe, encoder, cases):
    result = {}
    for case in cases:
        row, frame = case['row'], case['frame']
        root = chess.Board(row['fen'])
        best = frame['best']
        move = row['playedMoveUci']
        leader = branch(probe, root, best['pvUci'][0], best, frame['bestReply'])
        if move == best['pvUci'][0]:
            alternative = leader
        elif frame['played'] and frame['legalPair'] and frame['legalPlayed']:
            alternative = branch(probe, root, move, frame['played'], frame['playedReply'])
        else:
            continue
        result[row['id']] = encoder.features(root, leader, alternative)
    return result


def position_features(probe, encoder, frames):
    result = {}
    for case_id, (fen, lines) in frames.items():
        root = chess.Board(fen)
        lead, alternative = [
            branch(probe, root, line['pvUci'][0], line, [])
            for line in (lines[0], lines[min(1, len(lines) - 1)])]
        result[case_id] = encoder.features(root, lead, alternative)
    return result


def evaluate(probe, model, training, testing, features, control):
    training = [row for row in training if row.id in features]
    testing = [row for row in testing if row.id in features]
    predictions = probe.probe(training, testing, features, model, score_control=control,
                              extra_arms=LATENT_ARMS)
    result = probe.score(testing, predictions, model.AXES)
    return {'training': len(training), 'test': len(testing), 'results': result,
            'promisingArms': {axis: probe.passes_gate(cell, candidates=CANDIDATES)
                              for axis, cell in result.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('protocol', type=Path)
    parser.add_argument('network', type=Path)
    parser.add_argument('onnx', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--mistakes', nargs=4, type=Path, required=True,
                        metavar=('TRAIN_A', 'TRAIN_B', 'TRAIN_C', 'TEST'))
    parser.add_argument('--positions', nargs=6, type=Path, required=True,
                        metavar=('TRAIN', 'MANIFEST', 'TEST_SAMPLE', 'LABELS', 'ROOTS', 'WORKER'))
    parser.add_argument('--position-replay', nargs=2, type=Path, action='append', default=[],
                        metavar=('INPUT', 'WORKER'))
    args = parser.parse_args()
    position = load_position_runner()
    probe = position.load_probe()
    model = probe.import_sibling('decision-evidence-line-model.py')
    mistakes = probe.import_sibling('decision-evidence-mistake-model.py')
    protocol = probe.read(args.protocol)
    inputs = {
        'mistakes': [probe.sha256(path) for path in args.mistakes],
        'positions': [probe.sha256(path) for path in args.positions],
        'positionReplays': [[probe.sha256(path) for path in group]
                            for group in args.position_replay],
    }
    if (inputs != protocol['replays'] or probe.sha256(args.network) != protocol['networkSha256']
            or probe.sha256(args.onnx) != protocol['onnxSha256']):
        raise ValueError('Input differs from the frozen protocol')
    model.EVENT_FAMILIES.update(protocol['eventFamilies'])
    encoder = Encoder(args.onnx)

    mistake_training = mistakes.read_reports(
        model, args.mistakes[:3], set(protocol['disputedTrainingLabels']))
    mistake_test = mistakes.read_reports(model, args.mistakes[3:], set())
    cases = [case for path in args.mistakes for case in probe.read(path)['results']]
    probe.validate_split(mistake_training, mistake_test)

    replay, manifest = args.positions[:2]
    position_training = model.load(replay, manifest)
    position_test, frames = position.load_transfer(probe, model, args.positions[2:])
    replays = [(position_test, frames)]
    replays.extend(load_additional_positions(probe, model, paths)
                   for paths in args.position_replay)
    all_test_positions = [row for rows, _ in replays for row in rows]
    for attribute in ('id', 'board', 'game'):
        if len({getattr(row, attribute) for row in all_test_positions}) != len(all_test_positions):
            raise ValueError(f'Repeated {attribute} across the position replays')
    probe.validate_split(position_training, all_test_positions)
    profiles = {group['name']: group for group in probe.read(manifest)}
    train_frames = {}
    for case in probe.read(replay)['results']:
        row, profile = case['row'], profiles[case['source']]
        path = Path(profile['cache']) / f"tournament-engine-{profile['profile']}" / f"{row['id']}.json"
        train_frames[row['id']] = row['fen'], probe.read(path)['deep'][:3]
    with threadpool_limits(limits=1):
        features = mistake_features(probe, encoder, cases)
        mistake_results = evaluate(probe, model, mistake_training, mistake_test,
                                   features, 'evaluation-loss')
        features = position_features(probe, encoder, train_frames)
        position_results = []
        for rows, replay_frames in replays:
            features.update(position_features(probe, encoder, replay_frames))
            position_results.append(evaluate(probe, model, position_training, rows,
                                             features, 'stockfish-gap'))
        pooled = evaluate(probe, model, position_training, all_test_positions,
                          features, 'stockfish-gap')
    result = {
        'protocolSha256': probe.sha256(args.protocol), 'runnerSha256': probe.sha256(Path(__file__)),
        'mistakeInputCounts': [len(mistake_training), len(mistake_test)],
        'positionInputCounts': [len(position_training), *[len(rows) for rows, _ in replays]],
        'cost': {'additionalStockfishNodes': 0, 'networkBoardsPerDecision': 5,
                 'cpuThreads': 4, 'medianNetworkMs': float(np.median(encoder.forward_ms[1:])),
                 'medianFeatureMs': float(np.median(encoder.feature_ms[1:]))},
        'mistakes': mistake_results, 'positions': position_results, 'positionsPooled': pooled,
    }
    with args.output.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(result, output, indent=2, allow_nan=False)
        output.write('\n')


def load_position_runner():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'maia_position', Path(__file__).with_name('decision-evidence-maia-position-probe.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_additional_positions(probe, model, paths):
    inputs, reports = map(probe.read, paths)
    reports = {row['id']: row for row in reports}
    rows, frames = [], {}
    for item in inputs:
        case_id, fen, lines = item['id'], item['fen'], item['candidates']
        report = reports[case_id]
        if item['label'] != report['label']:
            raise ValueError(f'Different reference for {case_id}')
        current = {axis: report['baseline'][axis]['support'] == 'supported'
                   for axis in model.AXES[:2]}
        label = {axis: item['label'][axis] for axis in model.AXES[:2]}
        for values in (current, label):
            values['mixed'] = model.joint(values['tactical'], values['positional'])
        scores, continuation = model.features(fen, lines)
        rows.append(model.Decision(case_id, ' '.join(fen.split()[:4]), item['sourceGroup'],
                                   item['event'], label, current, scores, continuation))
        frames[case_id] = fen, lines
    if len(rows) != len(frames) or len({row.game for row in rows}) != len(rows):
        raise ValueError('Repeated decision or game in position replay')
    return rows, frames


if __name__ == '__main__':
    main()
