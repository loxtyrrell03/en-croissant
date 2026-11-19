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


def probe(task):
    row, cache_directory, output, executable, engine_hash = task
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
    path = Path(output) / (row['id'] + '.json')
    if path.exists():
        if json.loads(path.read_text())['identity'] != identity:
            raise ValueError('Probe cache identity changed')
        return
    board = chess.Board(row['fen'])
    probes = []
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
                engine.configure({'Clear Hash': None})
                completed = root_search.CompleteVariations(after, ranks)
                started = time.perf_counter()
                observed_nodes = 0
                with engine.analysis(after, chess.engine.Limit(nodes=budget), multipv=ranks) as search:
                    for info in search:
                        observed_nodes = max(observed_nodes, info.get('nodes', 0))
                        completed.add(info)
                if not completed.best:
                    raise ValueError('No complete reply iteration')
                depth = completed.best[0]['depth']
                lines = [dict(fen=after.fen(), depth=depth, cp=info['score'].pov(after.turn).score(),
                              mate=info['score'].pov(after.turn).mate(), pvUci=[move.uci() for move in info['pv']])
                         for info in completed.best]
                attempts.append(dict(nodes=observed_nodes, requestedNodes=budget, depth=depth,
                                     milliseconds=(time.perf_counter() - started) * 1000))
                agrees = candidate['cp'] is not None and lines[0]['cp'] is not None and abs(candidate['cp'] + lines[0]['cp']) <= 90
                agrees = agrees or candidate['mate'] is not None and lines[0]['mate'] is not None and candidate['mate'] * lines[0]['mate'] < 0
                if depth >= identity['min_depth'] and agrees:
                    break
            probes.append(dict(moveUci=root, lines=lines, attempts=attempts))
    root_search.atomic_json(path, dict(id=row['id'], identity=identity, replyProbes=probes))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('root_cache', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--split', choices=['development', 'validation'], default='development')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Private evidence must remain outside the checkout')
    rows = [row for row in json.loads(args.sample.read_text())['cases'] if row['split'] == args.split]
    engine_hash = hashlib.sha256(args.engine.read_bytes()).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    tasks = [(row, str(args.root_cache), str(output), str(args.engine), engine_hash) for row in rows]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index, _ in enumerate(pool.map(probe, tasks)):
            if (index + 1) % 10 == 0:
                print(f'Probed {index + 1}/{len(rows)}', flush=True)
    root_search.atomic_json(output / 'receipt.json', dict(protocol=2, split=args.split, cases=len(rows),
        sample_sha256=hashlib.sha256(args.sample.read_bytes()).hexdigest(), engine_sha256=engine_hash))


if __name__ == '__main__':
    main()
