"""Deterministically sample classical rook placements and check evasions."""

import argparse
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn

SPEC = importlib.util.spec_from_file_location(
    'tournament', Path(__file__).with_name('decision-evidence-tournament.py'),
)
tournament = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tournament)
MINOR = {chess.KNIGHT, chess.BISHOP}


def rook_first(board, moves, index):
    choice = moves[index]
    if board.is_capture(choice) or board.is_check() or board.gives_check(choice):
        return None
    side = board.turn
    if board.is_castling(choice):
        square = chess.square(5 if board.is_kingside_castling(choice) else 3, chess.square_rank(choice.from_square))
    elif board.piece_type_at(choice.from_square) == chess.ROOK:
        square = choice.to_square
    else:
        return None
    file = chess.square_file(square)
    line = board.copy(stack=False)
    line.push(choice)
    if any(chess.square_file(p) == file for p in line.pieces(chess.PAWN, side)):
        return None
    for next_ply in range(index+1, min(index+7, len(moves))):
        step = moves[next_ply]
        if line.turn == side and step.from_square == square:
            if chess.square_file(step.to_square) != file:
                return None
            square = step.to_square
            if line.is_capture(step):
                row = chess.square_rank(square) if side else 7-chess.square_rank(square)
                if (row >= 4 and moves[next_ply-1].to_square == square
                        and line.piece_type_at(square) in MINOR and not line.gives_check(step)):
                    return 'rook-recapture'
                return None
        elif line.turn != side and step.to_square == square:
            return None
        line.push(step)
    return None


def check_case(board, node):
    mover = not board.turn
    if not board.is_check() or not 2 <= board.legal_moves.count() <= 4:
        return None
    before = node.eval()
    after = node.next().eval() if node.next() else None
    if before is None or after is None:
        return None
    old, new = before.pov(mover), after.pov(mover)
    if old.score() is None or abs(old.score()) > 800:
        return None
    if new.mate() in (3, 4, 5):
        return 'mate-after-evasion'
    if new.score() is not None and abs(old.score()-new.score()) <= 25:
        return 'stable-evasion'
    return None


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    parser.add_argument('--event',nargs=2,action='append',required=True)
    parser.add_argument('--exclude-sample',action='append',type=Path, default=[])
    parser.add_argument('--each',type=int,default=12)
    args=parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError('Use a private working path')
    excluded_games,excluded_positions=set(),set()
    exclusions=[]
    for path in args.exclude_sample:
        raw=path.read_bytes()
        exclusions.append(tournament.digest(raw))
        for row in json.loads(raw)['cases']:
            excluded_positions.add(tournament.board_key(row['fen']))
            excluded_games.add(row.get('sourceGroup'))
    possibilities=[]
    events={}
    for name,path_string in args.event:
        path=Path(path_string)
        events[name]={'sha256':tournament.digest(path.read_bytes())}
        with path.open(encoding='utf-8-sig') as stream:
            while game:=chess.pgn.read_game(stream):
                board=game.board()
                if game.errors or type(board) is not chess.Board or not board.is_valid():
                    continue
                if game.headers.get('Result') not in ('1-0','0-1','1/2-1/2'):
                    continue
                nodes=list(game.mainline())
                moves=[n.move for n in nodes]
                key=tournament.digest((tournament.board_key(board.fen())+' '+' '.join(m.uci() for m in moves)).encode())
                if key in excluded_games:
                    continue
                for index,node in enumerate(nodes):
                    fen,ply=board.fen(),board.ply()
                    eligible=26<=ply<=119 and board.legal_moves.count()>=5 and tournament.board_key(fen) not in excluded_positions
                    rook=rook_first(board,moves,index) if eligible else None
                    board.push(node.move)
                    if not eligible:
                        continue
                    checks=check_case(board,node)
                    for stratum in filter(None,(rook,checks)):
                        possibilities.append(dict(fen=fen,ply=ply,playedMoveUci=node.move.uci(),id=f'coordination-{name}-{key[:16]}-{ply}',
                                                  sourceGroup=key,event=name,split='validation',stratum=stratum,category='public-classical-broadcast'))
    selected=[]
    counts={}
    for stratum in ('mate-after-evasion','rook-recapture','stable-evasion'):
        count=0
        for row in sorted(possibilities,key=lambda r:tournament.order(r['id'])):
            if row['stratum']!=stratum or row['sourceGroup'] in excluded_games or tournament.board_key(row['fen']) in excluded_positions:
                continue
            selected.append(row)
            excluded_games.add(row['sourceGroup'])
            excluded_positions.add(tournament.board_key(row['fen']))
            count+=1
            if count==args.each:
                break
        counts[stratum]=count
    with args.output.open('x',encoding='utf-8') as out:
        json.dump(dict(protocol=1,events=events,exclusions=exclusions,cases=selected,strata=counts),out,indent=2)
    print(counts)

if __name__=='__main__':
    main()
