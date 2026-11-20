"""Compare the same immediate pawn promotion on paired and independent routes."""
from pathlib import Path
from collections import Counter
import argparse
import json
import sys

import chess
sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/passed-pawn-interception"))
from interception import material, relative_rank, replay, pair


def liquidation(path):
    """Follow the promoted piece until both sides have finished recapturing."""
    lead = path[0]
    place = lead.move.to_square
    if not lead.move.promotion or lead.board.is_capture(lead.move):
        return None
    captures = []
    for step in path[1:5]:
        if not step.move or step.move.to_square != place or not step.board.is_capture(step.move):
            break
        victim = step.board.piece_type_at(place)
        captures.append(victim)
    if len(captures) < 2 or captures[1] not in (chess.ROOK, chess.QUEEN):
        return None
    end = 1+len(captures)
    if len(path) <= end or path[end].board.is_check() or path[end].board.can_claim_draw():
        return None
    return end, tuple(captures)


def active_rooks(path, owner, pawn):
    outcomes = {}
    for index in range(1,min(8,len(path)-4),2):
        step = path[index]
        move = step.move
        if not move or step.board.piece_at(move.from_square) != chess.Piece(chess.ROOK, not owner):
            continue
        if step.board.piece_at(move.to_square) != chess.Piece(chess.PAWN, owner):
            continue
        if relative_rank(not owner, move.to_square) < 6:
            continue
        rook = step.pieces.get(move.from_square)
        victim = step.pieces.get(move.to_square)
        if rook is None or victim is None or victim == pawn:
            continue
        poses = path[index+1:index+5]
        if all(len(item.board.pieces(chess.ROOK, not owner)) >= 2 and
               item.pieces.get(pawn) == pawn and item.board.piece_at(pawn) == chess.Piece(chess.PAWN,owner) and
               any(item.pieces.get(square)==rook and relative_rank(not owner,square)>=6
                   for square in item.board.pieces(chess.ROOK,not owner)) for item in poses):
            outcomes[(rook,victim,move.to_square)] = (index,step.san)
    return outcomes


def compare(row):
    # App-grade input uses both a same-depth paired root and
    # separately corroborated reply positions.
    context = pair(row)
    if not context:
        return None
    board, choices, replies, paths, tracks = context
    if (choices[0]["depth"] < 16 or min(r["depth"] for r in replies) < 16 or
        any(line["mate"] is not None for line in [*choices,*replies]) or
        any(abs(l["cp"]+r["cp"])>90 for l,r in zip(choices,replies,strict=True))):
        return None
    better, repeat, played, separate = tracks
    a,b = liquidation(better),liquidation(repeat)
    if not a or not b or a != b:
        return None
    through, taken = a
    pawn = better[0].move.from_square
    owner = board.turn
    if any(item.move.from_square == pawn and item.move.promotion
           for line in (played,separate) for item in line[:through] if item.move):
        return None
    if [item.move for item in better[:through]] != [item.move for item in repeat[:through]]:
        return None
    # Compare the material after both lines have settled. A different
    # forced reply is allowed outside this same-square exchange.
    material_example = None
    positional_example = None
    for end in range(max(through+2,6), min(11,*(len(line)-1 for line in tracks))+1):
        boards = [line[end].board for line in tracks]
        if any(bd.is_check() or bd.can_claim_draw() for bd in boards):
            continue
        balance = [material(bd,owner) for bd in boards]
        quiet = all(material(line[end-1].board,owner)==total
                    for line,total in zip(tracks,balance,strict=True))
        if material_example is None and quiet and min(balance[:2])-max(balance[2:])>=90:
            material_example = dict(through=end,balance=balance)
        if positional_example is None and max(balance)-min(balance)<=110:
            if any(len(bd.pieces(chess.ROOK,not owner))>1 for bd in boards[:2]):
                continue
            raw = [active_rooks(line[:end+1],owner,pawn) for line in (played,separate)]
            for common in raw[0].keys() & raw[1].keys():
                rook,victim,target = common
                # Reaching the same pawn/rook square after the stronger
                # choice would defeat the positional comparison.
                if any(any(item.pieces.get(target)==rook
                           or victim not in item.pieces.values() for item in line[:end+1])
                       for line in (better,repeat)):
                    continue
                positional_example = dict(through=end,balance=balance,capture=raw[0][common][1],
                   rookOrigin=chess.square_name(rook),pawnOrigin=chess.square_name(victim),
                   square=chess.square_name(target))
                break
    proof = dict(id=row["id"], liquidation=[item.san for item in better[:through]],
                 material=material_example,positional=positional_example,
                 split=row.get("stratum"))
    return proof


def records(path):
    text=path.read_text(encoding="utf-8")
    return json.loads(text) if text.lstrip().startswith("[") else [json.loads(line) for line in text.splitlines()]


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs",type=Path,nargs="+")
    args=parser.parse_args()
    for f in args.inputs:
        rows=records(f)
        print(f.name,len(rows),Counter(r.get("skipped","compared") for r in rows))
        for row in rows:
            found=compare(row)
            if found:
                print(json.dumps(found))
