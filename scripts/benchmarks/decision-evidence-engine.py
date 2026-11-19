"""Reproducible private Stockfish searches for decision-classifier experiments."""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import tempfile
import time

import chess
import chess.engine

PROTOCOL = 2


class CompleteVariations:
    """Retain whole ordered UCI MultiPV frames, never mutable per-rank leftovers.

    A search can publish another frame at the same depth while reordering roots.
    Keeping the latest value for each rank can splice two frames and duplicate a
    root. Commit only a contiguous, unique, score-ordered 1..N frame instead.
    """
    def __init__(self, board, ranks, root_moves=None):
        self.board = board
        self.ranks = ranks
        self.allowed = set(root_moves) if root_moves is not None else None
        self.frame = []
        self.best = None

    def add(self, info):
        if 'depth' not in info or 'score' not in info or not info.get('pv'):
            return
        rank = info.get('multipv', 1)
        if rank == 1:
            self.frame = []
        if info.get('lowerbound') or info.get('upperbound') or rank != len(self.frame) + 1:
            self.frame = []
            return
        if self.frame and info['depth'] != self.frame[0]['depth']:
            self.frame = []
            return
        self.frame.append({**info, 'pv': list(info['pv'])})
        if rank != self.ranks:
            return
        roots = [item['pv'][0] for item in self.frame]
        scores = [item['score'].pov(self.board.turn) for item in self.frame]
        valid = (len(set(roots)) == self.ranks and all(move in self.board.legal_moves for move in roots)
                 and (self.allowed is None or all(move in self.allowed for move in roots))
                 and all(scores[i] <= scores[i-1] for i in range(1, len(scores))))
        if valid and (self.best is None or info['depth'] >= self.best[0]['depth']):
            self.best = [dict(item, pv=list(item['pv'])) for item in self.frame]
        self.frame = []


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
    row, executable, output, engine_hash, minimum_depth, maximum_root_nodes = task
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', row['id']):
        raise ValueError('Invalid case identifier')
    path = Path(output) / (row['id'] + '.json')
    identity = dict(protocol=PROTOCOL, engine_sha256=engine_hash, fen=row['fen'],
                    nodes=[60000, 600000, 300000], threads=1, hash_mb=64)
    if minimum_depth:
        identity.update(minimum_depth=minimum_depth, maximum_root_nodes=maximum_root_nodes)
    if row.get('playedMoveUci'):
        identity.update(played_move=row['playedMoveUci'], comparison_nodes='Final adaptive root budget' if minimum_depth else 600000)
    if path.exists():
        cached = json.loads(path.read_text(encoding='utf-8'))
        if cached.get('identity') != identity:
            raise ValueError(f'Existing result has different provenance: {path.name}')
        return row['id']
    board = chess.Board(row['fen'])
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({'Threads': 1, 'Hash': 64, 'UCI_ShowWDL': True})

        def search(position, nodes, root_moves=None):
            engine.configure({'Clear Hash': None})
            ranks = min(3, len(root_moves) if root_moves is not None else position.legal_moves.count())
            completed = CompleteVariations(position, ranks, root_moves)
            started = time.perf_counter()
            with engine.analysis(position, chess.engine.Limit(nodes=nodes), multipv=ranks, root_moves=root_moves) as analysis:
                for info in analysis:
                    completed.add(info)
            elapsed = (time.perf_counter() - started) * 1000
            if not completed.best:
                raise ValueError('No complete engine iteration')
            infos = completed.best
            return [dict(fen=position.fen(), cp=info['score'].pov(position.turn).score(),
                         mate=info['score'].pov(position.turn).mate(), depth=info['depth'],
                         nodes=info['nodes'], pvUci=[move.uci() for move in info['pv']],
                         wdl=list(info['wdl'].pov(position.turn)), searchMs=elapsed)
                    for info in infos]

        shallow = search(board, 60000)
        deep = search(board, 600000)
        attempts = [dict(nodes=600000, depth=deep[0]['depth'], searchMs=deep[0]['searchMs'])]
        budget = 600000
        while minimum_depth and deep[0]['depth'] < minimum_depth and budget < maximum_root_nodes:
            budget = min(budget * 4, maximum_root_nodes)
            deep = search(board, budget)
            attempts.append(dict(nodes=budget, depth=deep[0]['depth'], searchMs=deep[0]['searchMs']))
        played = row.get('playedMoveUci') or deep[-1]['pvUci'][0]
        if chess.Move.from_uci(played) not in board.legal_moves:
            raise ValueError('The recorded played move is not legal on the supplied board')
        comparison = None
        if row.get('playedMoveUci'):
            selected_roots = list(dict.fromkeys([deep[0]['pvUci'][0], played]))
            comparison = search(board, budget, [chess.Move.from_uci(move) for move in selected_roots])
        reached = board.copy()
        reached.push_uci(played)
        reply = search(reached, 300000) if not reached.is_game_over() else []
        result = dict(identity=identity, id=row['id'], shallow=shallow, deep=deep, played=played, reply=reply)
        result['rootAttempts'] = attempts
        if comparison is not None:
            result['comparison'] = comparison
        atomic_json(path, result)
    return row['id']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--split', choices=['development', 'validation'], default='development')
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    parser.add_argument('--minimum-depth', type=int, default=0, choices=[0,16,18,20])
    parser.add_argument('--maximum-root-nodes', type=int, default=9600000, choices=[600000,2400000,9600000])
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
    tasks = [(row, str(args.engine.resolve()), str(output), engine_hash, args.minimum_depth, args.maximum_root_nodes) for row in selected]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for index, _ in enumerate(pool.map(inspect, tasks)):
            if (index + 1) % 10 == 0:
                print(f'Completed {index + 1}/{len(selected)}', flush=True)
    atomic_json(output / 'receipt.json', dict(protocol=PROTOCOL, engine_sha256=engine_hash,
        sample_sha256=hashlib.sha256(args.sample.read_bytes()).hexdigest(), split=args.split,
        positions=len(selected), nodes=[60000, 600000, 300000], threads=1, hash_mb=64,
        comparison_nodes_per_recorded_move='Final adaptive root budget' if args.minimum_depth else 600000,
        minimum_depth=args.minimum_depth, maximum_root_nodes=args.maximum_root_nodes,
        category_scope='Source categories and existing labels require independent review'))


if __name__ == '__main__':
    main()
