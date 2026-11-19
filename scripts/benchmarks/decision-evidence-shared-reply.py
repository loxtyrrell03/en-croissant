"""Cache at most one fixed-budget control query per known played move.

The TypeScript audit applies the application's local nomination before using
these results. This runner caches the broader legal shared-reply candidates
so nomination changes can be measured on the same exact engine inputs.
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
BUDGET = 1_000_000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inspect(task):
    row, root_dir, probe_dir, output, executable, engine_hash = task
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', row['id']):
        raise ValueError('Invalid case identifier')
    name = row['id'] + '.json'
    root_bytes = (root_dir / name).read_bytes()
    probe_bytes = (probe_dir / name).read_bytes()
    root = json.loads(root_bytes)
    probes = json.loads(probe_bytes)
    if (root['identity']['fen'] != row['fen'] or root['played'] != row.get('playedMoveUci')
            or root['identity']['engine_sha256'] != engine_hash or
            probes['identity']['root_sha256'] != sha(root_bytes)):
        raise ValueError('Mismatched root and reply evidence')
    identity = dict(rootSha256=sha(root_bytes), probeSha256=sha(probe_bytes),
                    engineSha256=engine_hash, protocol=1, budget=BUDGET, threads=1, hashMb=64)
    path = output / name
    if path.exists():
        if json.loads(path.read_bytes())['identity'] != identity:
            raise ValueError('Shared reply cache identity has changed')
        return
    result = dict(id=row['id'], identity=identity, sharedReply=None, requestedNodes=0, milliseconds=0)
    choices = root.get('comparison') or []
    best = choices[0] if choices else None
    played = next((line for line in choices if line['pvUci'][0] == root['played']), None)
    opponent = next((group['lines'][0] for group in probes['replyProbes']
                     if group['moveUci'] == root['played'] and group['lines']), None)
    if (best and played and opponent and best['pvUci'][0] == root['deep'][0]['pvUci'][0]
            and best['cp'] is not None and played['cp'] is not None and opponent['cp'] is not None
            and best['depth'] >= 16 and opponent['depth'] >= 16
            and best['cp'] - played['cp'] >= 100 and abs(played['cp'] + opponent['cp']) <= 90
            and played['pvUci'][1:2] == opponent['pvUci'][:1]):
        board = chess.Board(row['fen'])
        board.push_uci(best['pvUci'][0])
        reply = chess.Move.from_uci(opponent['pvUci'][0])
        if board.is_legal(reply):
            hit = next((line for group in probes['replyProbes'] if group['moveUci'] == best['pvUci'][0]
                        for line in group['lines'] if line['depth'] >= 16 and line['pvUci'][0] == reply.uci()), None)
            if hit is None:
                complete = root_search.CompleteVariations(board, 1, [reply])
                with chess.engine.SimpleEngine.popen_uci(executable) as engine:
                    engine.configure({'Threads': 1, 'Hash': 64})
                    start = time.perf_counter()
                    with engine.analysis(board, chess.engine.Limit(nodes=BUDGET),
                                         multipv=1, root_moves=[reply]) as frames:
                        for info in frames:
                            complete.add(info)
                    result.update(requestedNodes=BUDGET, milliseconds=(time.perf_counter() - start) * 1000)
                if complete.best:
                    line = complete.best[0]
                    score = line['score'].pov(board.turn)
                    hit = dict(fen=board.fen(), depth=line['depth'], cp=score.score(),
                               mate=score.mate(), pvUci=[m.uci() for m in line['pv']])
            if hit is not None:
                result['sharedReply'] = dict(betterMoveUci=best['pvUci'][0], playedMoveUci=root['played'], line=hit)
    root_search.atomic_json(path, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('root_cache', type=Path)
    parser.add_argument('reply_cache', type=Path)
    parser.add_argument('engine', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--split', choices=['development', 'validation'], default='validation')
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep raw analysis outside the checkout')
    rows = [row for row in json.loads(args.sample.read_bytes())['cases'] if row['split'] == args.split]
    if not rows or len({row['id'] for row in rows}) != len(rows):
        raise ValueError('The selected split must contain distinct cases')
    args.output.mkdir(parents=True, exist_ok=True)
    engine_hash = sha(args.engine.read_bytes())
    tasks = [(row, args.root_cache, args.reply_cache, args.output, str(args.engine.resolve()), engine_hash)
             for row in rows]
    with ProcessPoolExecutor(max_workers=4) as pool:
        for i, _ in enumerate(pool.map(inspect, tasks), 1):
            if i % 10 == 0:
                print(f'Checked shared replies for {i}/{len(rows)} decisions', flush=True)


if __name__ == '__main__':
    main()
