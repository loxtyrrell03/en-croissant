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
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Personal games must remain outside the source checkout')
    groups = defaultdict(lambda: defaultdict(list))
    for row in json.loads(args.moves.read_text(encoding='utf-8')):
        if row.get('pool') not in ['no increment', '60+30', '90+inc'] or not row.get('eligible') or not 12 <= row['ply'] <= 80:
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
    if len(eligible) < 24:
        raise ValueError('Need 24 source games with both predefined strata')
    cases = []
    for index, game in enumerate(eligible[:24]):
        split = 'development' if index % 2 == 0 else 'validation'
        for stratum in ['recorded-error', 'near-best']:
            row = min(groups[game][stratum], key=lambda item: digest(item['fen']))
            cases.append(dict(id=f'classical-{game}-{row["ply"]}', sourceGroup=f'owner-classical:{game}', split=split,
                              category='owner-classical', stratum=stratum, fen=row['fen'], playedMoveUci=row['uci'],
                              ply=row['ply'], timeControlGroup=row['pool'], selectionLossCp=row['loss']))
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(dict(protocol=1, sourceSha256=hashlib.sha256(args.moves.read_bytes()).hexdigest(),
                       selection='24 hash-selected games with one >=100 cp prior error and one <=20 cp prior near-best move; game-disjoint split',
                       note='Existing scores are stratification inputs, not tactical/positional labels or fresh evaluations', cases=cases), stream, indent=2)
    print(json.dumps(dict(cases=len(cases), games=24, development=24, validation=24)))


if __name__ == '__main__':
    main()
