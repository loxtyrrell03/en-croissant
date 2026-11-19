"""Build same-budget counterfactual reply searches for the learned ranker.

The shortlist is the low-cost MultiPV frame already recorded after the
actual move. One forced Stockfish query per reply provides the downstream
label. Model inputs never include the result of that query.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time

import chess
import chess.engine

spec = importlib.util.spec_from_file_location('root_search', Path(__file__).with_name('decision-evidence-engine.py'))
root_search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(root_search)
NODE_BUDGET = 1_000_000


def examine(task):
    row, root_directory, output_directory, executable, engine_hash = task
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', row['id']):
        raise ValueError('Invalid case identifier')
    filename = row['id'] + '.json'
    raw = (root_directory / filename).read_bytes()
    source = json.loads(raw)
    provenance = source['identity']
    if (provenance['fen'] != row['fen'] or provenance['played_move'] != row['playedMoveUci']
            or provenance['engine_sha256'] != engine_hash or provenance['protocol'] != root_search.PROTOCOL):
        raise ValueError('Root evidence belongs to a different decision or engine')
    path = output_directory / filename
    identity = dict(protocol=1, rootSha256=hashlib.sha256(raw).hexdigest(),
                    engineSha256=engine_hash, nodes=NODE_BUDGET, threads=1, hashMb=64)
    if path.exists():
        if json.loads(path.read_bytes())['identity'] != identity:
            raise ValueError('Rank candidate cache identity changed')
        return
    collection = dict(id=row['id'], identity=identity, replies=[])
    best = source['comparison'][0]
    played = next(r for r in source['comparison'] if r['pvUci'][0] == source['played'])
    if (best['cp'] is None or played['cp'] is None or best['depth'] < 16
            or best['cp'] - played['cp'] < 100 or not source['reply']):
        root_search.atomic_json(path, collection)
        return
    board = chess.Board(row['fen'])
    board.push_uci(source['played'])
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({'Threads': 1, 'Hash': 64})
        for candidate in source['reply']:
            move = board.parse_uci(candidate['pvUci'][0])
            completed = root_search.CompleteVariations(board, 1, [move])
            engine.configure({'Clear Hash': None})
            started = time.perf_counter()
            nodes = 0
            with engine.analysis(board, chess.engine.Limit(nodes=NODE_BUDGET),
                                 multipv=1, root_moves=[move]) as search:
                for info in search:
                    nodes = max(nodes, info.get('nodes', 0))
                    completed.add(info)
            duration = (time.perf_counter() - started) * 1000
            if not completed.best:
                raise ValueError('No complete targeted reply search')
            line = completed.best[0]
            collection['replies'].append(dict(
                moveUci=move.uci(), nodes=nodes, milliseconds=duration,
                line=dict(fen=board.fen(), depth=line['depth'], cp=line['score'].pov(board.turn).score(),
                          mate=line['score'].pov(board.turn).mate(), pvUci=[m.uci() for m in line['pv']])))
    root_search.atomic_json(path, collection)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('root_cache', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--split', choices=['development', 'validation'], required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep raw analysis and experiment files outside the checkout')
    raw = args.sample.read_bytes()
    rows = [row for row in json.loads(raw)['cases'] if row['split'] == args.split]
    if not rows or len({row['id'] for row in rows}) != len(rows):
        raise ValueError('The selected sample must contain distinct cases')
    engine_hash = hashlib.sha256(args.engine.read_bytes()).hexdigest()
    args.output.mkdir(parents=True, exist_ok=True)
    tasks = [(row, args.root_cache, args.output, str(args.engine.resolve()), engine_hash)
             for row in rows]
    with ProcessPoolExecutor(max_workers=4) as workers:
        for i, _ in enumerate(workers.map(examine, tasks), 1):
            if i % 10 == 0:
                print(f'Completed reply candidates for {i}/{len(rows)} cases', flush=True)
    root_search.atomic_json(args.output / 'receipt.json', dict(
        protocol=1, split=args.split, nodesPerQuery=NODE_BUDGET, cases=len(rows),
        sampleSha256=hashlib.sha256(raw).hexdigest(), engineSha256=engine_hash))


if __name__ == '__main__':
    main()
