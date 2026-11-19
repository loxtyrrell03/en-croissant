"""Reproducible private Stockfish searches for decision-classifier experiments."""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import json
import os
import tempfile
import time

import chess
import chess.engine

PROTOCOL = 1


def atomic_json(path, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, indent=2)
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def inspect(task):
    row, executable, output, engine_hash = task
    path = Path(output) / (row['id'] + '.json')
    identity = dict(protocol=PROTOCOL, engine_sha256=engine_hash, fen=row['fen'],
                    nodes=[60000, 600000, 300000], threads=1, hash_mb=64)
    if path.exists():
        cached = json.loads(path.read_text(encoding='utf-8'))
        if cached.get('identity') != identity:
            raise ValueError(f'Existing result has different provenance: {path.name}')
        return row['id']
    board = chess.Board(row['fen'])
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({'Threads': 1, 'Hash': 64, 'UCI_ShowWDL': True})

        def search(position, nodes):
            engine.configure({'Clear Hash': None})
            ranks = min(3, position.legal_moves.count())
            iterations = {}
            started = time.perf_counter()
            with engine.analysis(position, chess.engine.Limit(nodes=nodes), multipv=ranks) as analysis:
                for info in analysis:
                    if not info.get('pv') or info.get('lowerbound') or info.get('upperbound'):
                        continue
                    iterations.setdefault(info['depth'], {})[info.get('multipv', 1)] = info
            elapsed = (time.perf_counter() - started) * 1000
            complete = [depth for depth, lanes in iterations.items() if len(lanes) == ranks]
            if not complete:
                raise ValueError('No complete engine iteration')
            lanes = iterations[max(complete)]
            infos = [lanes[index] for index in range(1, ranks + 1)]
            return [dict(fen=position.fen(), cp=info['score'].pov(position.turn).score(),
                         mate=info['score'].pov(position.turn).mate(), depth=info['depth'],
                         nodes=info['nodes'], pvUci=[move.uci() for move in info['pv']],
                         wdl=list(info['wdl'].pov(position.turn)), searchMs=elapsed)
                    for info in infos]

        shallow = search(board, 60000)
        deep = search(board, 600000)
        played = deep[-1]['pvUci'][0]
        reached = board.copy()
        reached.push_uci(played)
        reply = search(reached, 300000) if not reached.is_game_over() else []
        atomic_json(path, dict(identity=identity, id=row['id'], shallow=shallow,
                               deep=deep, played=played, reply=reply))
    return row['id']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--split', choices=['development', 'validation'], default='development')
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    if output.is_relative_to(repo):
        raise ValueError('Paid course outputs must stay outside the source checkout')
    sample = json.loads(args.sample.read_text(encoding='utf-8'))
    selected = [row for row in sample['cases'] if row['split'] == args.split]
    if not selected or len({row['id'] for row in selected}) != len(selected):
        raise ValueError('Sample must contain distinct cases for the selected split')
    engine_hash = hashlib.sha256(args.engine.read_bytes()).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    tasks = [(row, str(args.engine.resolve()), str(output), engine_hash) for row in selected]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index, _ in enumerate(pool.map(inspect, tasks)):
            if (index + 1) % 10 == 0:
                print(f'Completed {index + 1}/{len(selected)}', flush=True)
    atomic_json(output / 'receipt.json', dict(protocol=PROTOCOL, engine_sha256=engine_hash,
        sample_sha256=hashlib.sha256(args.sample.read_bytes()).hexdigest(), split=args.split,
        positions=len(selected), nodes=[60000, 600000, 300000], threads=1, hash_mb=64,
        category_scope='Course categories are weak labels'))


if __name__ == '__main__':
    main()
