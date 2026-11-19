"""Sample classical broadcast decisions without using scores or predictions.

The ordinary stratum samples one late-opening, middlegame or endgame ply
per game. A separate challenge stratum samples quiet recorded moves in
positions with an absolute pin. Neither stratum supplies the reference label.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import chess
import chess.pgn


def digest(value):
    return hashlib.sha256(value).hexdigest()


def order(value):
    return digest(('tournament-v1:' + value).encode())


def board_key(fen):
    return ' '.join(fen.split()[:4])


def read_games(path, excluded_boards):
    games = {}
    with path.open(encoding='utf-8-sig') as stream:
        while game := chess.pgn.read_game(stream):
            board = game.board()
            if game.errors or type(board) is not chess.Board or not board.is_valid():
                continue
            moves = list(game.mainline_moves())
            if len(moves) < 28 or game.headers.get('Result') not in {'1-0', '0-1', '1/2-1/2'}:
                continue
            game_key = digest((board_key(board.fen()) + ' ' + ' '.join(move.uci() for move in moves)).encode())
            pool = []
            overlap = False
            for move in moves:
                fen = board.fen()
                ply = board.ply()
                overlap |= board_key(fen) in excluded_boards
                if 26 <= ply <= 119 and board.legal_moves.count() >= 5:
                    quiet = not board.is_check() and not board.is_capture(move) and not board.gives_check(move)
                    has_pin = any(board.is_pinned(piece.color, square)
                                  for square, piece in board.piece_map().items()
                                  if piece.piece_type != chess.KING)
                    pool.append({
                        'fen': fen, 'ply': ply, 'playedMoveUci': move.uci(),
                        'phase': 'late-opening' if ply < 38 else 'middlegame' if ply < 68 else 'late-game',
                        'pinChallenge': quiet and has_pin,
                    })
                board.push(move)
            if not overlap and pool:
                games[game_key] = pool
    return games


def select_event(event, games, ordinary_limit, pin_limit, seen_boards, seen_games):
    rows = []
    for stratum, limit in [('ordinary', ordinary_limit), ('quiet-with-pin', pin_limit)]:
        available = 0
        for game in sorted(games, key=order):
            if available >= limit:
                break
            if game in seen_games:
                continue
            pool = [row for row in games[game]
                    if (stratum == 'ordinary' or row['pinChallenge'])
                    and board_key(row['fen']) not in seen_boards]
            if not pool:
                continue
            chosen = min(pool, key=lambda row: order(f'{game}:{row["ply"]}'))
            row = {key: value for key, value in chosen.items() if key != 'pinChallenge'}
            rows.append(dict(row, id=f'tournament-{event}-{game[:16]}-{row["ply"]}',
                             sourceGroup=game, event=event, stratum=stratum,
                             split='validation', category='public-classical-broadcast'))
            seen_games.add(game)
            seen_boards.add(board_key(row['fen']))
            available += 1
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--event', action='append', nargs=4, required=True,
                        metavar=('EVENT', 'PGN', 'ORDINARY_LIMIT', 'PIN_LIMIT'))
    parser.add_argument('--exclude-sample', type=Path, action='append', default=[])
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep sampled positions outside the checkout')
    seen_boards = set()
    exclusion_hashes = []
    for path in args.exclude_sample:
        raw = path.read_bytes()
        exclusion_hashes.append(digest(raw))
        seen_boards.update(board_key(row['fen']) for row in json.loads(raw)['cases'])
    exclusions = set(seen_boards)
    cases = []
    seen_games = set()
    events = {}
    for event, pgn, ordinary, pin in args.event:
        ordinary, pin = int(ordinary), int(pin)
        if not re.fullmatch(r'[a-z0-9-]+', event) or event in events or ordinary < 1 or pin < 0:
            raise ValueError('Use unique event IDs, a positive ordinary limit and nonnegative challenge limit')
        path = Path(pgn)
        games = read_games(path, exclusions)
        selected = select_event(event, games, ordinary, pin, seen_boards, seen_games)
        if not selected:
            raise ValueError(f'No eligible games for {event}')
        events[event] = {
            'sha256': digest(path.read_bytes()), 'eligibleGames': len(games),
            'ordinaryLimit': ordinary, 'pinLimit': pin,
            'ordinary': sum(row['stratum'] == 'ordinary' for row in selected),
            'pinChallenge': sum(row['stratum'] == 'quiet-with-pin' for row in selected),
        }
        cases.extend(selected)
    result = dict(protocol=1, events=events, exclusions=exclusion_hashes, cases=cases,
                  scope='Classical broadcast games. One legal decision per game. Challenge rows are separate; no model or engine evaluations enter selection.')
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(dict(cases=len(cases), events=events)))


if __name__ == '__main__':
    main()
