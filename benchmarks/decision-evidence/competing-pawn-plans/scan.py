"""Independent replay of pawn contacts and their immediate structural effects."""

import chess

VALUES = dict(zip(range(1,7),(100,320,330,500,900,0)))
def replay(fen, moves):
    b=chess.Board(fen)
    balance=0
    side=b.turn
    states=[]
    for u in moves[:14]:
        m=b.parse_uci(u)
        piece=b.piece_at(m.from_square)
        captured=b.piece_at(m.to_square)
        value=VALUES[captured.piece_type] if captured else (100 if b.is_en_passant(m) else 0)
        if m.promotion: value+=VALUES[m.promotion]-100
        balance+=(1 if b.turn==side else -1)*value
        after=b.copy(stack=False)
        after.push(m)
        states.append((b,m,after,b.san(m),piece,captured,balance))
        b=after
    return states

def rook_use(states, end, file, colour, delayed):
    exchange = states[end][1].to_square
    possible = states[end][2].piece_at(exchange) == chess.Piece(chess.PAWN, not colour)
    for before, move, after, san, piece, captured, _ in states[end+1:end+6]:
        if int(after.pieces(chess.PAWN, colour)) & chess.BB_FILES[file]:
            return None
        if (piece == chess.Piece(chess.ROOK, colour) and not after.is_check()
            and chess.square_file(move.to_square)==file):
            if captured:
                if delayed and possible and chess.square_file(move.from_square)==file and move.to_square==exchange:
                    return san
            else:
                targets = [square for square in after.attacks(move.to_square)
                           if chess.square_file(square)==file and (square>=32)==colour
                           and not (after.occupied_co[colour]&chess.BB_SQUARES[square])]
                if len(targets)>=2:
                    return san
        if exchange in (move.to_square,move.from_square):
            possible=False
    return None


def observe_pawn_contacts(fen, moves, delayed=False):
    try: states=replay(fen,moves)
    except ValueError:return []
    result=[]
    for start in range(0,min(5,len(states)),2):
        before,step,after,san,actor,victim,eq=states[start]
        if victim or actor.piece_type!=chess.PAWN or after.is_check() or step.promotion: continue
        targets=[s for s in after.attacks(step.to_square) & after.pieces(chess.PAWN,not actor.color)]
        for target in targets:
            for nxt in range(start+1,min(start+5,len(states))):
                a,m,b,s,p,v,e=states[nxt]
                contact={m.from_square,m.to_square}=={step.to_square,target} and p.piece_type==chess.PAWN and v and v.piece_type==chess.PAWN
                if not contact:
                    if {m.from_square,m.to_square}&{step.to_square,target}: break
                    continue
                end=nxt
                if delayed:
                    for at in range(nxt+1,min(nxt+5,len(states))):
                        _, move, _, _, _, captured, _ = states[at]
                        if move.to_square==m.to_square and captured:
                            end=at
                            break
                        if m.to_square in (move.from_square,move.to_square) or move.promotion or captured:
                            break
                while end+1<len(states):
                    a2,m2,b2,s2,p2,v2,e2=states[end+1]
                    if m2.to_square!=m.to_square or not v2:break
                    end+=1
                through=end+2
                if not through<len(states) or end==nxt: break
                tail=states[end:through+1]
                settled=max(abs(x[6]) for x in tail)<=100 and all(x[6]==tail[0][6] for x in tail)
                if not settled or states[through][2].is_check(): break
                for col in {chess.square_file(step.to_square),chess.square_file(target)}:
                    file_mask=chess.BB_FILES[col]
                    for side in (chess.WHITE,chess.BLACK):
                        if (int(before.pieces(chess.PAWN,side))&file_mask) and all(not(int(x[2].pieces(chess.PAWN,side))&file_mask) for x in tail):
                            if not any(move.from_square%8==col and piece.piece_type==chess.PAWN and piece.color==side or move.to_square%8==col and cap and cap.piece_type==chess.PAWN and cap.color==side for _,move,_,_,piece,cap,_ in states[nxt:end+1]):
                                continue
                            later = rook_use(states,end,col,side,delayed)
                            result.append(dict(move=step.uci(),target=chess.square_name(target),
                                file=chess.FILE_NAMES[col],side="white" if side else "black",start=start+1,
                                through=through+1,episode=" ".join(x[3] for x in states[nxt:end+1]),
                                rook=later))
                break
    return result
