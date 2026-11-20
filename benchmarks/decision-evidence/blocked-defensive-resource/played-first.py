"""Start from the played move's independently searched reply."""
import argparse
from collections import Counter
from pathlib import Path
import json

import chess
from nominate import board_key,initial,read,pair,blocker_disables


def nominate_played_path(row):
    compared=pair(row)
    if not compared:
        return []
    best,actual,good_replies,played_replies=compared
    base=initial(row)
    good,bad=base.copy(),base.copy()
    chosen,played=[base.parse_uci(line["pvUci"][0]) for line in (best,actual)]
    blocker=base.piece_at(played.from_square)
    if not blocker or blocker.piece_type==chess.KING or played.promotion or base.is_castling(played):
        return []
    good.push(chosen)
    bad.push(played)
    path=[]
    san=[]
    # Two defender turns after the selected root are enough to measure
    # whether orienting around the actual reply improves search coverage.
    for i,uci in enumerate(played_replies[0]["pvUci"][:4],1):
        move=bad.parse_uci(uci)
        if (not good.is_legal(move) or played.to_square in (move.from_square,move.to_square) or
            good.piece_at(move.from_square)!=bad.piece_at(move.from_square) or
            good.piece_at(move.to_square)!=bad.piece_at(move.to_square) or
            good.is_en_passant(move)!=bad.is_en_passant(move) or good.is_castling(move)!=bad.is_castling(move)):
            break
        path.append(uci)
        san.append(good.san(move))
        good.push(move)
        bad.push(move)
        if i%2==0 or good.can_claim_draw() or bad.can_claim_draw() or bad.is_game_over():
            continue
        moves={}
        for candidate in good.legal_moves:
            if bad.is_legal(candidate):continue
            specific=blocker_disables(good,bad,candidate,played.to_square)
            if not specific:continue
            shadow=bad.copy(stack=False)
            shadow.remove_piece_at(played.to_square)
            if not shadow.is_legal(candidate):continue
            moves[candidate.uci()]=dict(san=good.san(candidate),kind=specific)
        if not moves:
            continue
        return [dict(id=row["id"],fen=row["fen"],better=chosen.uci(),played=played.uci(),
            betterSan=base.san(chosen),playedSan=base.san(played),path=path,san=san,moves=moves,
            square=chess.square_name(played.to_square),blocker=chess.piece_name(blocker.piece_type),
            betterFen=good.fen(),playedFen=bad.fen(),betterCp=best["cp"],playedCp=actual["cp"],
            game=row.get("game"),event=row.get("event"),site=row.get("site"),history=row.get("history"))]
    return []


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("output",type=Path)
    p.add_argument("source",type=Path,nargs="+")
    args=p.parse_args()
    seen=set()
    hits=[]
    for source in args.source:
        for row in read(source):
            key=board_key(row["fen"]),row.get("playedMoveUci")
            if key in seen:continue
            seen.add(key)
            hits.extend(nominate_played_path(row))
    print(len(seen),"positions",len(hits),"nominations",Counter(len(x["path"]) for x in hits),flush=True)
    with args.output.open("x",encoding="utf8") as f:
        json.dump(hits,f,indent=2)

if __name__=="__main__":
    main()
