import argparse
import json
from pathlib import Path
import sys
import chess

sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/passed-pawn-interception"))
from interception import material,replay

def line(arm):
    return next(iter(arm.get("lines",[])),None)

def value(item):
    if not item:return None
    if item["mate"] is not None:
        return 8000 if item["mate"]>0 else -8000
    return item["cp"]

def san(item,n=12):
    board=chess.Board(item["fen"])
    return board.variation_san([chess.Move.from_uci(m) for m in item["pvUci"][:n]]) if item else "--"

def promo_origins(track, owner):
    outcomes={}
    for ply,step in enumerate(track):
        if step.move and step.board.turn==owner and step.move.promotion:
            original=step.pieces.get(step.move.from_square)
            outcomes[original]=(ply+1,step.san)
    return outcomes

def captured_origins(track, owner):
    result={}
    for ply,step in enumerate(track):
        if not step.move or step.board.turn==owner or not step.board.is_capture(step.move):
            continue
        square=step.move.to_square
        if step.board.is_en_passant(step.move):
            square+=(-8 if step.board.turn else 8)
        if step.board.piece_type_at(square)==chess.PAWN:
            continue
        result[step.pieces.get(square)]=(ply+1,step.san)
    return result

def shared_consequence(good,bad,without):
    frames=[replay(chess.Board(arm["fen"]),arm["pvUci"][:12]) for arm in (good,bad,without)]
    if not all(frames):
        return None
    roots=[track[0].board for track in frames]
    color=roots[0].turn
    source=[promo_origins(track,not color) for track in frames]
    common=set(source[1]) & set(source[2]) - set(source[0])
    if common:
        square=min(common)
        return ("promotion",chess.square_name(square),source[1][square],source[2][square])
    if without["mate"] is not None and bad["mate"] is not None and min(without["mate"],bad["mate"])<0 and max(without["mate"],bad["mate"])<0 and (good["mate"] is None or good["mate"]>0):
        return ("allowed-mate",bad["mate"],without["mate"])
    tiles=[captured_origins(track,color) for track in frames]
    recurring=set(tiles[1]) & set(tiles[2]) - set(tiles[0])
    for square in sorted(recurring):
        for i in range(max(tiles[1][square][0],tiles[2][square][0])+1,min(map(len,frames))):
            good_b,bad_b,without_b=(track[i].board for track in frames)
            current=[material(pos,color)-material(root,color) for pos,root in zip((good_b,bad_b,without_b),roots)]
            if any(track[i].board.is_check() or
                material(track[i-1].board,color)!=material(track[i].board,color) for track in frames):
                continue
            if current[0]-max(current[1:])>=90:
                return ("material",chess.square_name(square),i,tiles[1][square],tiles[2][square],current)
    return None

def compare(row):
    good,bad,without = [line(row[k]) for k in ("good","bad","excludedResource")]
    values=[value(a) for a in (good,bad,without)]
    if not all(a is not None for a in values):
        return None
    if good["pvUci"][0]!=row["resource"]:
        return None
    best,lost,omitted=values
    if best-max(lost,omitted)<90:
        return None
    if abs(best-row["betterCp"])>120 or abs(lost-row["playedCp"])>150:
        return None
    if min(good["depth"],bad["depth"],without["depth"])<16:
        return None
    consequence=shared_consequence(good,bad,without)
    return {"best":best,"blocked":lost,"excluded":omitted,"consequence":consequence}

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("file",type=Path)
    args=p.parse_args()
    rows=[json.loads(line) for line in args.file.read_text().splitlines()[1:]]
    for row in rows:
        print(row["id"],row["betterSan"],row["playedSan"]," ".join(row["san"]),row["resourceSan"],row["obstruction"],row["betterCp"],row["playedCp"])
        for arm in ("good","bad","excludedResource"):
            pvs=row[arm]["lines"]
            if pvs:print(" ",arm,[(value(pv),pv["depth"],san(pv,10)) for pv in pvs[:2]])
        print(" ",compare(row))
