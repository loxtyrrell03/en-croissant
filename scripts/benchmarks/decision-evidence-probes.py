"""Search separate opponent replies for the experimental decision classifier.

Reads existing versioned root searches; never opens the validation partition by
default. Retains exact identities and every completed adaptive search setting.
"""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import re
import time

import chess
import chess.engine

spec = importlib.util.spec_from_file_location('root_search', Path(__file__).with_name('decision-evidence-engine.py'))
root_search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(root_search)


def capture_nominations(before, root):
    after = before.copy()
    after.push_uci(root)
    target = chess.Move.from_uci(root).to_square
    root_piece = after.piece_at(target)
    values = {chess.PAWN:100,chess.KNIGHT:320,chess.BISHOP:330,chess.ROOK:500,chess.QUEEN:900,chess.KING:20000}
    nominations = []
    if root_piece and root_piece.color == before.turn and root_piece.piece_type != chess.KING:
        for move in after.legal_moves:
            capture_square = move.to_square + (-8 if after.turn else 8) if after.is_en_passant(move) else move.to_square
            if not after.is_capture(move) or capture_square != target:
                continue
            captured = values[root_piece.piece_type]
            capturer = values[after.piece_at(move.from_square).piece_type]
            reached = after.copy()
            reached.push(move)
            recapturable = any(reached.is_capture(reply) and reply.to_square == move.to_square for reply in reached.legal_moves)
            if captured < capturer and recapturable:
                continue
            nominations.append((capturer, move.uci(), move))
    return sorted(nominations)


def search_replies(engine, position, ranks, budget):
    engine.configure({'Clear Hash': None})
    completed = root_search.CompleteVariations(position, ranks)
    started = time.perf_counter()
    observed_nodes = 0
    with engine.analysis(position, chess.engine.Limit(nodes=budget), multipv=ranks) as search:
        for info in search:
            observed_nodes = max(observed_nodes, info.get('nodes', 0))
            completed.add(info)
    if not completed.best:
        raise ValueError('No complete reply iteration')
    lines = [dict(fen=position.fen(), depth=info['depth'], cp=info['score'].pov(position.turn).score(),
                  mate=info['score'].pov(position.turn).mate(), pvUci=[move.uci() for move in info['pv']])
             for info in completed.best]
    attempt = dict(nodes=observed_nodes, requestedNodes=budget, depth=lines[0]['depth'],
                   milliseconds=(time.perf_counter() - started) * 1000)
    return lines, attempt


def probe(task):
    row, cache_directory, output, executable, engine_hash, capture_resources, position_choices = task
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', row['id']):
        raise ValueError('Invalid case identifier')
    source_path = Path(cache_directory) / (row['id'] + '.json')
    source_bytes = source_path.read_bytes()
    source = json.loads(source_bytes)
    if source['identity']['fen'] != row['fen'] or source['identity']['engine_sha256'] != engine_hash or source['identity']['protocol'] != root_search.PROTOCOL:
        raise ValueError('Root cache does not match the source or engine')
    identity = dict(protocol=2, root_sha256=hashlib.sha256(source_bytes).hexdigest(),
                    engine_sha256=engine_hash, budgets=[1000000, 4000000], min_depth=16,
                    root_choices=2, threads=1, hash_mb=64)
    if capture_resources:
        identity['capture_resource_limit'] = 3
    if position_choices:
        identity['position_reply_budget'] = 1000000
    path = Path(output) / (row['id'] + '.json')
    if path.exists():
        if json.loads(path.read_text())['identity'] != identity:
            raise ValueError('Probe cache identity changed')
        return
    board = chess.Board(row['fen'])
    probes = []
    position_probes = []
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({'Threads': 1, 'Hash': 64})
        candidates = source.get('comparison', source['deep'])
        for candidate in [candidates[0], candidates[-1]]:
            root = candidate['pvUci'][0]
            if any(item['moveUci'] == root for item in probes):
                continue
            after = board.copy()
            after.push_uci(root)
            if after.is_game_over():
                continue
            ranks = min(3, after.legal_moves.count())
            attempts = []
            lines = []
            for budget in identity['budgets']:
                lines, attempt = search_replies(engine, after, ranks, budget)
                attempts.append(attempt)
                agrees = candidate['cp'] is not None and lines[0]['cp'] is not None and abs(candidate['cp'] + lines[0]['cp']) <= 90
                agrees = agrees or candidate['mate'] is not None and lines[0]['mate'] is not None and candidate['mate'] * lines[0]['mate'] < 0
                if attempt['depth'] >= identity['min_depth'] and agrees:
                    break
            targeted = []
            if capture_resources and candidate is candidates[0]:
                nominations = capture_nominations(board, root)
                for _, uci, move in sorted(nominations)[:identity['capture_resource_limit']]:
                    existing = next((line for line in lines if line['pvUci'][0] == uci), None)
                    if existing:
                        targeted.append(dict(line=existing, attempts=[], source='existing-reply-frame'))
                        continue
                    engine.configure({'Clear Hash':None})
                    completed = root_search.CompleteVariations(after, 1, [move])
                    started = time.perf_counter(); observed_nodes = 0
                    with engine.analysis(after, chess.engine.Limit(nodes=1000000), multipv=1, root_moves=[move]) as search:
                        for info in search:
                            observed_nodes = max(observed_nodes,info.get('nodes',0)); completed.add(info)
                    if not completed.best:
                        raise ValueError('No complete targeted reply iteration')
                    info = completed.best[0]
                    targeted.append(dict(line=dict(fen=after.fen(),depth=info['depth'],cp=info['score'].pov(after.turn).score(),
                                                   mate=info['score'].pov(after.turn).mate(),pvUci=[m.uci() for m in info['pv']]),
                                         attempts=[dict(nodes=observed_nodes,requestedNodes=1000000,depth=info['depth'],milliseconds=(time.perf_counter()-started)*1000)],
                                         source='targeted-capture'))
            probes.append(dict(moveUci=root, lines=lines, attempts=attempts, targetedCaptures=targeted))
        if position_choices:
            # Precompute both runners-up. The audit only uses the one query
            # nominated by the production policy.
            for candidate in source['deep'][1:3]:
                root = candidate['pvUci'][0]
                if any(item['moveUci'] == root for item in probes):
                    continue
                after = board.copy()
                after.push_uci(root)
                if after.is_game_over():
                    continue
                ranks = min(3, after.legal_moves.count())
                lines, attempt = search_replies(engine, after, ranks, identity['position_reply_budget'])
                position_probes.append(dict(moveUci=root, lines=lines, attempt=attempt))
    result = dict(id=row['id'], identity=identity, replyProbes=probes)
    if position_choices:
        result['positionReplyProbes'] = position_probes
    root_search.atomic_json(path, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('root_cache', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--split', choices=['development', 'validation'], default='development')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    parser.add_argument('--capture-resources', action='store_true')
    parser.add_argument('--position-choices', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Private evidence must remain outside the checkout')
    rows = [row for row in json.loads(args.sample.read_text())['cases'] if row['split'] == args.split]
    engine_hash = hashlib.sha256(args.engine.read_bytes()).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    tasks = [(row, str(args.root_cache), str(output), str(args.engine), engine_hash,
              args.capture_resources, args.position_choices) for row in rows]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index, _ in enumerate(pool.map(probe, tasks)):
            if (index + 1) % 10 == 0:
                print(f'Probed {index + 1}/{len(rows)}', flush=True)
    root_search.atomic_json(output / 'receipt.json', dict(protocol=2, split=args.split, cases=len(rows),
        sample_sha256=hashlib.sha256(args.sample.read_bytes()).hexdigest(), engine_sha256=engine_hash,
        capture_resources=args.capture_resources, position_choices=args.position_choices))


if __name__ == '__main__':
    main()
