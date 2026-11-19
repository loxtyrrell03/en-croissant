"""Select classical decisions from recorded changes to the king's pawn cover.

The recorded continuation and broadcast score nominate cases. Candidate labels,
verified replay outcomes and deep engine assessments do not enter selection.
"""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import chess
import chess.pgn

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def position_key(fen):
    return ' '.join(fen.split()[:4])

def board_rank(square, color):
    return chess.square_rank(square) if color else 7 - chess.square_rank(square)

def nearby_pawns(board, side, king):
    return [s for s in board.pieces(chess.PAWN, side)
            if abs(chess.square_file(s) - chess.square_file(king)) <= 1
            and 1 <= board_rank(s, side) <= 2]

def recorded_exposure(boards, moves, start):
    board = boards[start]
    side = board.turn
    king = board.king(side)
    if king is None or board_rank(king, side) > 1:
        return None
    shield = nearby_pawns(board, side, king)
    if len(shield) < 2:
        return None
    files = {chess.square_file(s): s for s in shield}
    for departure in range(start, min(start + 5, len(moves)), 2):
        position, move = boards[departure], moves[departure]
        if move.from_square not in shield or not position.is_capture(move):
            continue
        column = chess.square_file(move.from_square)
        if any(chess.square_file(pawn) == column
               for pawn in boards[departure + 1].pieces(chess.PAWN, side)):
            continue
        compatible = False
        for entry in range(departure + 1, min(start + 10, len(moves)), 2):
            position, attack = boards[entry], moves[entry]
            after = boards[entry + 1]
            if position.king(side) != king or after.king(side) != king:
                break
            neighbor = files.get(chess.square_file(attack.to_square))
            if (neighbor is not None and neighbor != move.from_square
                    and attack.to_square == neighbor
                    and position.piece_at(neighbor) == chess.Piece(chess.PAWN, side)
                    and position.is_capture(attack)):
                return 'second-shield-pawn'
            if (chess.square_file(attack.to_square) == column
                    and position.piece_type_at(attack.from_square) in (chess.ROOK, chess.QUEEN)
                    and after.is_check()):
                return 'heavy-piece-check'
            compatible = True
        if compatible:
            return 'cover-capture-control'
    return None

def nominations(path, event, excluded_boards, excluded_games):
    with path.open(encoding='utf-8-sig') as stream:
        while game := chess.pgn.read_game(stream):
            nodes = list(game.mainline())
            board = game.board()
            if game.errors or type(board) is not chess.Board or not board.is_valid():
                continue
            if (len(nodes) < 28 or game.headers.get('Result') not in {'1-0','0-1','1/2-1/2'}
                    or game.headers.get('Variant','Standard') != 'Standard'):
                continue
            moves = [n.move for n in nodes]
            game_id = sha((position_key(board.fen()) + ' ' + ' '.join(m.uci() for m in moves)).encode())
            if game_id in excluded_games:
                continue
            boards = [board]
            for move in moves:
                board = board.copy(stack=False)
                board.push(move)
                boards.append(board)
            for i in range(24, min(114, len(moves) - 9)):
                board = boards[i]
                fen = board.fen()
                if position_key(fen) in excluded_boards:
                    continue
                kind = recorded_exposure(boards, moves, i)
                if kind is None:
                    continue
                prior, after = nodes[i].parent.eval(), nodes[i].eval()
                loss = None
                if prior and after:
                    pre_cp = prior.pov(board.turn).score()
                    post_cp = after.pov(board.turn).score()
                    if pre_cp is not None and post_cp is not None:
                        loss = pre_cp - post_cp
                row = dict(id=f'shelter-{event}-{game_id[:16]}-{board.ply()}',
                           sourceGroup=game_id, event=event, fen=fen, ply=board.ply(),
                           playedMoveUci=moves[i].uci(), category='public-classical-broadcast',
                           stratum=kind, split='validation', phase='middlegame')
                if loss is not None:
                    row['broadcastLossCp'] = loss
                yield row

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path)
    parser.add_argument('--event', action='append', nargs=2, metavar=('ID','PGN'), required=True)
    parser.add_argument('--exclude', type=Path, action='append', default=[])
    parser.add_argument('--per-stratum', type=int, default=6)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Keep generated samples outside the checkout until reviewed')
    if args.per_stratum < 1:
        raise ValueError('Require a positive quota')
    boards, games, digests = set(), set(), []
    for file in args.exclude:
        raw = file.read_bytes()
        digests.append(sha(raw))
        for case in json.loads(raw)['cases']:
            boards.add(position_key(case['fen']))
            if case.get('sourceGroup'):
                games.add(case['sourceGroup'])
    pool, events = [], {}
    for event,path in args.event:
        path = Path(path)
        rows=list(nominations(path,event,boards,games))
        events[event]=dict(pgnSha256=sha(path.read_bytes()), nominations=dict(Counter(x['stratum'] for x in rows)))
        pool.extend(rows)
    result = []
    for kind in ('second-shield-pawn','heavy-piece-check','cover-capture-control'):
        available = [r for r in pool if r['stratum'] == kind]
        def order(r):
            loss = r.get('broadcastLossCp')
            enriched = loss is not None and (loss >= 70 if kind != 'cover-capture-control' else abs(loss) <= 25)
            return (not enriched, sha(('shelter-v1:'+r['id']).encode()))
        count = 0
        for r in sorted(available,key=order):
            key=position_key(r['fen'])
            if r['sourceGroup'] in games or key in boards:
                continue
            games.add(r['sourceGroup'])
            boards.add(key)
            result.append(r)
            count += 1
            if count == args.per_stratum:
                break
    counts = Counter(r['stratum'] for r in result)
    if not counts:
        raise ValueError(f'No cases found: {events}')
    with args.out.open('x',encoding='utf8') as out:
        json.dump(dict(protocol=1, cases=result, events=events, exclusions=sorted(digests),
                       scope='Recorded OTB shelter transitions nominate one actual played choice per game. '
                             'Annotated losses and controls get priority. Classifier outputs are blind.'),
                  out,indent=2)
        out.write('\n')
    print(events)
    print(dict(counts))

if __name__ == '__main__':
    main()
