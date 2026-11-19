"""Experiment with checking a tactical choice shortly after the analysed move."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time

import chess
import chess.engine

ROOT = Path(__file__).resolve().parents[2]
VALUE = {
    chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
    chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 10_000,
}
FOLLOWUP_NODES = 750_000
REPLY_NODES = 1_000_000
EXPLORATORY_PLIES = 5


def load(path):
    return json.loads(Path(path).read_bytes())


def immediate_gain(board, capture):
    """Cheap nomination only. The decision verifier checks the real exchange."""
    if not board.is_legal(capture) or not board.is_capture(capture):
        return 0
    victim = board.piece_type_at(capture.to_square)
    attacker = board.piece_type_at(capture.from_square)
    if not victim or not attacker:
        return 0
    after = board.copy(stack=False)
    after.push(capture)
    recapture = any(move.to_square == capture.to_square for move in after.generate_legal_captures())
    return VALUE[victim] - (VALUE[attacker] if recapture else 0)


def new_threats(before, spent, board, response):
    if board.is_check():
        return []
    passive = board.copy(stack=False)
    passive.turn = before.turn
    passive.ep_square = None
    actual = board.copy(stack=False)
    actual.push(response)
    targets = []
    for take in passive.generate_legal_captures():
        victim = passive.piece_type_at(take.to_square)
        if not victim or victim == chess.PAWN or take.promotion:
            continue
        gain = immediate_gain(passive, take)
        if gain < 160 or immediate_gain(actual, take) >= 90:
            continue
        source = spent.from_square if take.from_square == spent.to_square else take.from_square
        if immediate_gain(before, chess.Move(source, take.to_square)) >= 90:
            continue
        targets.append(dict(move=take.uci(), gain=gain, named=passive.san(take)))
    return sorted(targets, key=lambda threat: (-threat['gain'], threat['move']))


def nominate(root):
    first = root[0]
    if first['depth'] < 16 or first['cp'] is None or first['mate'] is not None:
        return []
    choices = {}
    for rank, line in enumerate(root[:2]):
        if line['cp'] is None or first['cp'] - line['cp'] > 50:
            continue
        board = chess.Board(line['fen'])
        for index, uci in enumerate(line['pvUci'][:EXPLORATORY_PLIES]):
            move = chess.Move.from_uci(uci)
            before = board.copy(stack=False)
            board.push(move)
            reply_count = board.legal_moves.count()
            if index + 1 == len(line['pvUci']) or board.is_game_over() or reply_count < 2:
                break
            response = chess.Move.from_uci(line['pvUci'][index + 1])
            chosen = dict(
                fen=board.fen(), prefix=line['pvUci'][:index + 1],
                continuation=line['pvUci'][index + 1:], rank=rank,
                targets=new_threats(before, move, board, response),
                check=board.is_check(), replies=reply_count,
                capture=before.is_capture(move), responseCapture=board.is_capture(response),
            )
            choices.setdefault(board.fen(), chosen)
    return list(choices.values())


def single_probe(candidates):
    eligible = (
        candidate for candidate in candidates
        if len(candidate['prefix']) <= 3
        and (candidate['targets'] or (candidate['check'] and candidate['replies'] <= 4))
    )
    best = min(eligible, key=lambda candidate: (candidate['rank'], len(candidate['prefix'])), default=None)
    return [best] if best else []


def single_confirmation(candidate, lines):
    best = lines[0]
    if best['pvUci'][0] != candidate['continuation'][0] or best['cp'] is None or best['depth'] < 16:
        return []
    for index, alternative in enumerate(lines[1:3], 1):
        if len(alternative['pvUci']) < 2:
            continue
        if candidate['check']:
            admissible = -6 <= (alternative['mate'] or 0) <= -1
        else:
            admissible = (
                alternative['cp'] is not None and best['cp'] - alternative['cp'] >= 100
                and (len(candidate['prefix']) == 1 or candidate['responseCapture'])
                and alternative['pvUci'][1] in {target['move'] for target in candidate['targets']}
            )
        if admissible:
            return [(index, alternative)]
    return []


def search(board, engine, protocol, nodes, ranks):
    engine.configure({'Clear Hash': None})
    complete = protocol.CompleteVariations(board, ranks)
    start = time.perf_counter()
    with engine.analysis(board, chess.engine.Limit(nodes=nodes), multipv=ranks) as frames:
        for frame in frames:
            complete.add(frame)
    lines = []
    for info in complete.best or []:
        score = info['score'].pov(board.turn)
        lines.append(dict(
            fen=board.fen(), depth=info['depth'], cp=score.score(), mate=score.mate(),
            pvUci=[move.uci() for move in info['pv']],
        ))
    return lines, (time.perf_counter() - start) * 1000


def expand(case, exe, protocol, output, engine_hash, screen):
    path = output / (case['id'] + '.json')
    identity = dict(
        protocol=1, engineSha256=engine_hash, nodes=FOLLOWUP_NODES,
        confirmationNodes=REPLY_NODES, case=case, screen=screen,
    )
    if path.exists():
        if load(path)['identity'] != identity:
            raise ValueError(f'Cache provenance changed for {path.name}')
        return
    if screen == 'single':
        boards = single_probe(case['boards'])
    else:
        boards = [candidate for candidate in case['boards'] if candidate['targets'] or candidate['check']]

    result = dict(identity=identity, probes=[], requestedNodes=0, searchMs=0)
    if boards:
        with chess.engine.SimpleEngine.popen_uci(exe) as engine:
            engine.configure({'Threads': 1, 'Hash': 64})
            for candidate in boards:
                board = chess.Board(candidate['fen'])
                lines, elapsed = search(board, engine, protocol, FOLLOWUP_NODES, min(3, board.legal_moves.count()))
                probe = dict(prefix=candidate['prefix'], lines=lines, confirmation=[], queryMs=elapsed)
                result['requestedNodes'] += FOLLOWUP_NODES
                result['searchMs'] += elapsed
                if len(lines) > 1 and lines[0]['depth'] >= 16 and lines[0]['cp'] is not None:
                    nominated = single_confirmation(candidate, lines) if screen == 'single' else enumerate(lines[1:3], 1)
                    for index, alternative in nominated:
                        if alternative['cp'] is None and (alternative['mate'] or 0) >= 0:
                            continue
                        if alternative['cp'] is not None and lines[0]['cp'] - alternative['cp'] < 100:
                            continue
                        after = board.copy(stack=False)
                        after.push_uci(alternative['pvUci'][0])
                        if after.is_game_over():
                            continue
                        reply, reply_ms = search(after, engine, protocol, REPLY_NODES, 1)
                        probe['confirmation'].append(dict(rank=index, lines=reply, queryMs=reply_ms))
                        result['requestedNodes'] += REPLY_NODES
                        result['searchMs'] += reply_ms
                result['probes'].append(probe)
    protocol.atomic_json(path, result)


def main():
    parser = argparse.ArgumentParser(description=(
        'Screen tactical evidence inside competitive Stockfish continuations. '
        'Manifest rows name the cache directory, profile, reference and baseline report.'
    ))
    parser.add_argument('manifest', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 9))
    parser.add_argument('--screen', choices=('targeted', 'single'), default='single')
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(ROOT):
        raise ValueError('Keep raw analysis outside the checkout')
    engine_hash = hashlib.sha256(args.engine.read_bytes()).hexdigest()
    rows = {}
    for home, profile, references, baseline in load(args.manifest):
        existing = {row['id']: row['assessment']['position'] for row in load(baseline)['results']}
        for label in load(references)['cases']:
            case_id = label['id']
            if case_id in rows or not re.fullmatch(r'[a-zA-Z0-9_-]+', case_id):
                raise ValueError('Invalid or duplicate evaluation case')
            source = load(Path(home) / f'tournament-engine-{profile}' / (case_id + '.json'))
            if source['id'] != case_id or source['identity']['engine_sha256'] != engine_hash:
                raise ValueError('Root searches must match the case and engine')
            rows[case_id] = dict(id=case_id, reference=label, previous=existing[case_id], boards=nominate(source['deep']))

    args.output.mkdir(parents=True, exist_ok=True)
    active = [case for case in rows.values() if case['previous']['tactical']['support'] != 'supported']
    print(f'{len(rows)} positions, {len(active)} without a supported tactical explanation.', flush=True)
    spec = importlib.util.spec_from_file_location('decision_engine', Path(__file__).with_name('decision-evidence-engine.py'))
    protocol = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(protocol)

    def examine(case):
        expand(case, args.engine, protocol, args.output, engine_hash, args.screen)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for index, _ in enumerate(pool.map(examine, active), 1):
            if index % 20 == 0 or index == len(active):
                print(f'Completed {index}/{len(active)} positions', flush=True)


if __name__ == '__main__':
    main()
