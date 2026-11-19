"""Freeze game-disjoint real classical decisions from the owner's existing audit.

Select one substantial recorded error and one near-best decision per game.
Prior losses choose strata only; fresh paired searches provide actual evidence.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import chess


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('moves', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--games', type=int, default=24)
    parser.add_argument('--exclude-sample', type=Path, action='append', default=[],
                        help='Exclude every source game in these earlier samples')
    parser.add_argument('--validation-only', action='store_true')
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Personal games must remain outside the source checkout')
    if args.games < 1:
        raise ValueError('Game count must be positive')
    source_hash = hashlib.sha256(args.moves.read_bytes()).hexdigest()
    excluded_games = set()
    for path in args.exclude_sample:
        sample = json.loads(path.read_text(encoding='utf-8'))
        if sample.get('sourceSha256') != source_hash:
            raise ValueError('Earlier game IDs belong to a different source export')
        excluded_games.update(row['sourceGroup'].removeprefix('owner-classical:') for row in sample['cases'])
    groups = defaultdict(lambda: defaultdict(list))
    for row in json.loads(args.moves.read_text(encoding='utf-8')):
        if row['id'] in excluded_games or row.get('pool') not in ['no increment', '60+30', '90+inc'] or not row.get('eligible') or not 12 <= row['ply'] <= 80:
            continue
        board = chess.Board(row['fen'])
        if not board.is_valid() or chess.Move.from_uci(row['uci']) not in board.legal_moves:
            raise ValueError('Recorded board/move mismatch')
        if board.legal_moves.count() < 4:
            continue
        stratum = 'recorded-error' if row['loss'] >= 100 else 'near-best' if row['loss'] <= 20 else None
        if stratum:
            groups[row['id']][stratum].append(row)
    eligible = sorted([game for game, rows in groups.items() if all(rows.get(key) for key in ['recorded-error', 'near-best'])],
                      key=lambda game: digest('classical-decisions-v1:' + game))
    if len(eligible) < args.games:
        raise ValueError(f'Need {args.games} new source games with both predefined strata; found {len(eligible)}')
    cases = []
    for index, game in enumerate(eligible[:args.games]):
        split = 'development' if not args.validation_only and index % 2 == 0 else 'validation'
        for stratum in ['recorded-error', 'near-best']:
            row = min(groups[game][stratum], key=lambda item: digest(item['fen']))
            cases.append(dict(id=f'classical-{game}-{row["ply"]}', sourceGroup=f'owner-classical:{game}', split=split,
                              category='owner-classical', stratum=stratum, fen=row['fen'], playedMoveUci=row['uci'],
                              ply=row['ply'], timeControlGroup=row['pool'], selectionLossCp=row['loss']))
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(dict(protocol=1, sourceSha256=source_hash,
                       selection=f'{args.games} hash-selected games with one >=100 cp prior error and one <=20 cp prior near-best move; game-disjoint split',
                       excludedGameCount=len(excluded_games),
                       note='Existing scores are stratification inputs, not tactical/positional labels or fresh evaluations', cases=cases), stream, indent=2)
    print(json.dumps(dict(cases=len(cases), games=args.games, excludedGames=len(excluded_games),
                          development=sum(row['split'] == 'development' for row in cases),
                          validation=sum(row['split'] == 'validation' for row in cases))))


if __name__ == '__main__':
    main()
