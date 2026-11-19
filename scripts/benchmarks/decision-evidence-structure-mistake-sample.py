"""Sample real classical decisions around pawn captures that change structure."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import chess
import chess.pgn


def sha(data):
    return sha256(data).hexdigest()


def key(fen):
    return ' '.join(fen.split()[:4])


def pawn_structure(position, square, side):
    counts = [0] * 8
    for pawn in position.pieces(chess.PAWN, side):
        counts[chess.square_file(pawn)] += 1
    file = chess.square_file(square)
    return counts[file] > 1, not any(counts[max(0, file - 1):file] + counts[file + 1:file + 2])


def geometry(frames, moves, index):
    for at in (index, index + 2):
        before, after, move = frames[at], frames[at + 1], moves[at]
        if (before.piece_type_at(move.from_square) != chess.PAWN or
                not before.is_capture(move) or move.promotion):
            continue
        old = pawn_structure(before, move.from_square, before.turn)
        new = pawn_structure(after, move.to_square, before.turn)
        if new[0] and not old[0]:
            return 'doubled'
        if new[1] and not old[1]:
            return 'isolated'
    return None


def nominations(path, event, excluded_boards, excluded_games):
    with path.open(encoding='utf-8-sig') as stream:
        while game := chess.pgn.read_game(stream):
            board = game.board()
            nodes = list(game.mainline())
            if (game.errors or type(board) is not chess.Board or not board.is_valid() or
                    game.headers.get('Result') not in {'1-0','0-1','1/2-1/2'} or len(nodes) < 26):
                continue
            moves = [node.move for node in nodes]
            game_id = sha((key(board.fen()) + ' ' + ' '.join(m.uci() for m in moves)).encode())
            if game_id in excluded_games:
                continue
            frames = [board]
            for m in moves:
                board = board.copy(stack=False)
                board.push(m)
                frames.append(board)
            for i in range(22, min(110, len(nodes) - 7)):
                fen = frames[i].fen()
                if key(fen) in excluded_boards:
                    continue
                previous, current = nodes[i].parent.eval(), nodes[i].eval()
                if previous is None or current is None:
                    continue
                pre, post = (ev.pov(frames[i].turn).score() for ev in (previous, current))
                if pre is None or post is None or abs(pre) > 400:
                    continue
                loss = pre - post
                shape = geometry(frames, moves, i)
                if shape and 60 <= loss <= 420:
                    stratum = shape
                elif shape and abs(loss) <= 20:
                    stratum = 'structure-control'
                elif not shape and 90 <= loss <= 300:
                    stratum = 'ordinary-loss'
                else:
                    continue
                yield dict(id=f'structure-{event}-{game_id[:16]}-{frames[i].ply()}',
                           category='public-classical-broadcast', split='validation',
                           fen=fen, event=event, phase='middlegame', ply=frames[i].ply(),
                           sourceGroup=game_id, playedMoveUci=moves[i].uci(),
                           stratum=stratum, broadcastLossCp=loss)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path)
    parser.add_argument('--event', action='append', required=True, nargs=2)
    parser.add_argument('--exclude', action='append', default=[], type=Path)
    parser.add_argument('--per-stratum', type=int, default=6)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep generated samples outside the checkout until reviewed')
    if args.per_stratum < 1:
        raise ValueError('Use a positive sample quota per stratum')
    boards, games, exclusions = set(), set(), []
    for path in args.exclude:
        raw = path.read_bytes()
        exclusions.append(sha(raw))
        for row in json.loads(raw)['cases']:
            boards.add(key(row['fen']))
            if row.get('sourceGroup'):
                games.add(row['sourceGroup'])
    pool, events = [], {}
    for event, pgn in args.event:
        path = Path(pgn)
        rows = list(nominations(path,event,boards,games))
        events[event] = dict(sha256=sha(path.read_bytes()), nominations=dict(Counter(r['stratum'] for r in rows)))
        pool.extend(rows)
    result = []
    for stratum in ('doubled','isolated','structure-control','ordinary-loss'):
        rows = sorted((row for row in pool if row['stratum'] == stratum),
                      key=lambda row: sha(('structure-v1:' + row['id']).encode()))
        count = 0
        for row in rows:
            board, game = key(row['fen']), row['sourceGroup']
            if board in boards or game in games:
                continue
            result.append(row)
            boards.add(board)
            games.add(game)
            count += 1
            if count == args.per_stratum:
                break
    if not result:
        raise ValueError('No qualifying annotated classical decisions')
    with args.out.open('x',encoding='utf8',newline='\n') as stream:
        json.dump(dict(protocol=1, cases=result, events=events, exclusions=sorted(exclusions)),stream,indent=2)
        stream.write('\n')
    print(events)
    print(Counter(r['stratum'] for r in result))


if __name__ == '__main__':
    main()
