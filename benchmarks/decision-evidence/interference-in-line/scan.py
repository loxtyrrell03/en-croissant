"""Review whether an actual capture uses an opponent guard's cut line."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import chess

VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330, chess.ROOK: 500,
          chess.QUEEN: 900, chess.KING: 20000}


def read(file):
    data=Path(file).read_bytes().strip()
    return json.loads(data) if data[:1] in (b"[", b"{") else None


def on_board(move):
    return chess.Move.from_uci(move)


def gain_at(board, square):
    target = board.piece_at(square)
    if target is None:
        return 0
    recovered = 0
    for move in list(board.generate_legal_captures(to_mask=chess.BB_SQUARES[square])):
        board.push(move)
        amount = VALUES[target.piece_type] - gain_at(board, square)
        board.pop()
        recovered = max(recovered, amount)
    return recovered


def exchange(board, move):
    if not board.is_legal(move) or not board.is_capture(move):
        return None
    taken=board.piece_at(move.to_square)
    if taken is None:
        return None
    after=board.copy(stack=False)
    after.push(move)
    return VALUES[taken.piece_type]-gain_at(after,move.to_square)


def ray_type(piece, source, target):
    file_gap = chess.square_file(source) - chess.square_file(target)
    rank_gap = chess.square_rank(source) - chess.square_rank(target)
    if file_gap == 0 or rank_gap == 0:
        return piece.piece_type in (chess.ROOK, chess.QUEEN)
    return abs(file_gap) == abs(rank_gap) and piece.piece_type in (chess.BISHOP,chess.QUEEN)


def qualify(initial, moves):
    if len(moves) < 3:
        return []
    states=[initial.copy(stack=False)]
    try:
        for uci in moves[:9]:
            current=states[-1].copy()
            current.push_uci(uci)
            states.append(current)
    except ValueError:
        return []
    root=on_board(moves[0])
    interposer=states[1].piece_at(root.to_square)
    if not interposer or interposer.piece_type==chess.KING or root.promotion:
        return []
    verified=[]
    for payoff_index in range(2,min(len(states)-1,8),2):
        payoff=on_board(moves[payoff_index])
        target=initial.piece_at(payoff.to_square)
        before=states[payoff_index]
        if (target is None or target.color==initial.turn or target.piece_type==chess.KING or
            payoff.from_square in (root.from_square,root.to_square)
            or not before.is_capture(payoff) or payoff.promotion):
            continue
        if any(move.from_square in (root.to_square,payoff.from_square,payoff.to_square)
               or move.to_square in (root.to_square,payoff.from_square,payoff.to_square)
               for move in map(on_board,moves[1:payoff_index])):
            continue
        for guard,piece in initial.piece_map().items():
            if piece.color == initial.turn or not ray_type(piece,guard,payoff.to_square):
                continue
            between=chess.between(guard,payoff.to_square)
            if not between & chess.BB_SQUARES[root.to_square]:
                continue
            if any(move.from_square==guard or move.to_square==guard for move in map(on_board,moves[:payoff_index])):
                continue
            after=states[payoff_index+1]
            keep=on_board(chess.square_name(guard)+chess.square_name(payoff.to_square))
            restored=after.copy(stack=False)
            restored.remove_piece_at(root.to_square)
            prior=initial.copy(stack=False)
            prior_gain=None
            if prior.is_legal(payoff) and prior.is_capture(payoff):
                prior.push(payoff)
                prior_gain=exchange(prior,keep)
            witness=dict(interposer=chess.square_name(root.to_square),guard=chess.square_name(guard),
                         target=chess.square_name(payoff.to_square), attacker=chess.square_name(payoff.from_square),
                         payoffIndex=payoff_index,
                         guardCapture=keep.uci(), priorGain=prior_gain,
                         restoredGain=exchange(restored,keep), actualGain=exchange(before,payoff),
                         afterMate=after.is_checkmate(),
                         actualRecapture=after.is_legal(keep))
            if (
                prior_gain is not None and prior_gain>=90 and
                witness["restoredGain"] is not None and witness["restoredGain"]>=90 and
                witness["actualGain"] is not None and witness["actualGain"]>=90 and not witness["actualRecapture"]
            ):
                witness["kind"]="used-cut"
            else:
                witness["kind"]="near-miss"
            verified.append(witness)
    return verified


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    raw=read(args.corpus)
    found=[]
    for item in raw["cases"]:
        board=chess.Board(item["fen"])
        branch=qualify(board,item["line"])
        if branch:
            opts={x["kind"] for x in branch}
            found.append(dict(item, hypotheses=branch,
                              caseKind="used-cut" if "used-cut" in opts else "near-miss"))
    print(dict(Counter(x["caseKind"] for x in found)),dict(Counter((x["caseKind"],x["split"]) for x in found)))
    with args.output.open("x",encoding="utf-8") as stream:
        json.dump(found,stream,separators=(",",":"))
if __name__=="__main__":
    main()
