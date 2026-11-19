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


def read_games(path, excluded_boards, *, broadcast_loss=False):
    games = {}
    with path.open(encoding='utf-8-sig') as stream:
        while game := chess.pgn.read_game(stream):
            board = game.board()
            if game.errors or type(board) is not chess.Board or not board.is_valid():
                continue
            nodes = list(game.mainline())
            moves = [node.move for node in nodes]
            if len(moves) < 28 or game.headers.get('Result') not in {'1-0', '0-1', '1/2-1/2'}:
                continue
            game_key = digest((board_key(board.fen()) + ' ' + ' '.join(move.uci() for move in moves)).encode())
            pool = []
            overlap = False
            for node in nodes:
                move = node.move
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
                    if broadcast_loss:
                        before, after = node.parent.eval(), node.eval()
                        if before and after:
                            prior_cp = before.pov(board.turn).score()
                            next_cp = after.pov(board.turn).score()
                            if prior_cp is not None and next_cp is not None and abs(prior_cp) <= 400:
                                pool[-1]['broadcastLossCp'] = prior_cp - next_cp
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


def select_mistakes(event, split, games, limit, seen_boards, seen_games):
    """Select two disjoint positions per game using annotation scores only."""
    rows = []
    for game in sorted(games, key=order):
        if len(rows) >= 2 * limit:
            break
        if game in seen_games:
            continue
        pool = [row for row in games[game]
                if row['ply'] <= 99 and 'broadcastLossCp' in row
                and board_key(row['fen']) not in seen_boards]
        errors = [row for row in pool if row['broadcastLossCp'] >= 120]
        controls = [row for row in pool if abs(row['broadcastLossCp']) <= 20]
        if not errors or not controls:
            continue
        error = min(errors, key=lambda row: order(f'{game}:{row["ply"]}'))
        controls = [row for row in controls if board_key(row['fen']) != board_key(error['fen'])]
        if not controls:
            continue
        control = min(controls, key=lambda row: order(f'{game}:{row["ply"]}'))
        for stratum, selected in [('broadcast-loss', error), ('broadcast-control', control)]:
            row = {key: val for key, val in selected.items() if key != 'pinChallenge'}
            cases = dict(row, id=f'mistake-{event}-{game[:16]}-{row["ply"]}',
                         sourceGroup=game, event=event, stratum=stratum, split=split,
                         category='public-classical-broadcast')
            rows.append(cases)
            seen_boards.add(board_key(row['fen']))
        seen_games.add(game)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--event', action='append', nargs=4,
                      metavar=('EVENT', 'PGN', 'ORDINARY_LIMIT', 'PIN_LIMIT'))
    mode.add_argument('--mistake-event', action='append', nargs=4,
                      metavar=('EVENT', 'PGN', 'SPLIT', 'GAME_LIMIT'))
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
    for event, pgn, first, second in args.event or args.mistake_event:
        if not re.fullmatch(r'[a-z0-9-]+', event) or event in events:
            raise ValueError('Use unique event IDs')
        path = Path(pgn)
        games = read_games(path, exclusions, broadcast_loss=bool(args.mistake_event))
        if args.mistake_event:
            split, limit = first, int(second)
            if split not in {'development', 'validation'} or limit < 1:
                raise ValueError('Provide a valid split and positive game limit')
            selected = select_mistakes(event, split, games, limit, seen_boards, seen_games)
            counts = dict(split=split, games=len(selected) // 2, gameLimit=limit)
        else:
            ordinary, pin = int(first), int(second)
            if ordinary < 1 or pin < 0:
                raise ValueError('Provide a positive ordinary limit and nonnegative challenge limit')
            selected = select_event(event, games, ordinary, pin, seen_boards, seen_games)
            counts = dict(ordinaryLimit=ordinary, pinLimit=pin,
                          ordinary=sum(row['stratum'] == 'ordinary' for row in selected),
                          pinChallenge=sum(row['stratum'] == 'quiet-with-pin' for row in selected))
        if not selected:
            raise ValueError(f'No eligible games for {event}')
        events[event] = {
            'sha256': digest(path.read_bytes()), 'eligibleGames': len(games),
            **counts,
        }
        cases.extend(selected)
    scope = ('Classical broadcasts. Two decisions per game stratified only by existing broadcast scores. Whole events held out.'
             if args.mistake_event else
             'Classical broadcast games. One legal decision per game. Challenge rows are separate; no model or engine evaluations enter selection.')
    result = dict(protocol=1, events=events, exclusions=exclusion_hashes, cases=cases, scope=scope)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(dict(cases=len(cases), events=events)))


if __name__ == '__main__':
    main()
