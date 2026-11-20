"""Nominate defences obstructed by the actual root move on an exact shared continuation."""
import argparse
from collections import Counter
from pathlib import Path
import json

import chess

def read(path):
    src=path.read_text(encoding="utf-8-sig").strip()
    if src.startswith("["):
        return json.loads(src)
    return [json.loads(line) for line in src.splitlines()]


def board_key(fen):
    board=chess.Board(fen)
    return min(board.epd(),board.mirror().epd())


def path_identity(board, uci):
    move=board.parse_uci(uci)
    return move.uci(),board.piece_at(move.from_square)


def initial(row):
    if "history" not in row or not row["history"]:
        return chess.Board(row["fen"])
    board=chess.Board(row["history"]["fen"])
    for uci in row["history"]["moves"]:
        board.push_uci(uci)
    if board.fen()!=row["fen"]:
        raise ValueError("History board mismatch in " + row["id"])
    return board


def pair(row):
    record=row.get("comparisonCandidates") or []
    roots={line["pvUci"][0]:line for line in record if line["pvUci"]}
    best,actual=next(iter(record),None),roots.get(row.get("playedMoveUci"))
    if (not best or not actual or best is actual or best["cp"] is None or actual["cp"] is None or
        best["depth"] != actual["depth"] or best["cp"]-actual["cp"]<90):
        return None
    probes={probe["moveUci"]:probe["lines"] for probe in row.get("replyProbes",[]) if probe["lines"]}
    good=probes.get(best["pvUci"][0],[])
    bad=probes.get(actual["pvUci"][0],[])
    if not good or not bad or good[0].get("cp") is None or bad[0].get("cp") is None:
        return None
    if bad[0]["cp"]-good[0]["cp"]<70 or any(
        abs(line["cp"]+reply["cp"])>120
        for line,reply in ((best,good[0]),(actual,bad[0]))
    ):
        return None
    return best,actual,good,bad


def blocker_disables(ok,bad,possible,blocked):
    # The defending piece must be the same before the move. Focus on exact
    # obstructions from a piece that has stayed on its root landing square.
    piece=ok.piece_at(possible.from_square)
    if not piece or piece!=bad.piece_at(possible.from_square):
        return None
    if blocked==possible.to_square:
        if bad.piece_at(blocked) and bad.piece_at(blocked).color==bad.turn:
            return "landing"
        return None
    if piece.piece_type not in (chess.BISHOP,chess.ROOK,chess.QUEEN):
        return None
    between=chess.between(possible.from_square,possible.to_square)
    if not (between & chess.BB_SQUARES[blocked]) or between & bad.occupied != chess.BB_SQUARES[blocked]:
        return None
    target=bad.piece_at(possible.to_square)
    if target and target.color==bad.turn:
        return None
    shadow=bad.copy(stack=False)
    shadow.remove_piece_at(blocked)
    return "ray" if shadow.is_legal(possible) else None


def nominees(row,max_shared=8):
    exact=pair(row)
    if not exact:
        return []
    best, actual, good, bad = exact
    base=initial(row)
    chosen, played=[base.parse_uci(line["pvUci"][0]) for line in (best,actual)]
    mover=base.piece_at(played.from_square)
    if not mover or mover.piece_type==chess.KING or played.promotion or base.is_castling(played):
        return []
    # Keep an unrestricted comparison. Near-ranked replies may nominate but
    # are independently checked at their actual reached boards.
    paths=[best["pvUci"][1:]] + [
        reply["pvUci"] for reply in good
        if reply.get("cp") is not None and good[0]["cp"]-reply["cp"] <= 60
    ]
    known=set()
    results=[]
    for path in paths:
        ok,bad_board=base.copy(),base.copy()
        ok.push(chosen)
        bad_board.push(played)
        shared=[]
        sans=[]
        for ply,uci in enumerate(path[:max_shared+1],1):
            possible=chess.Move.from_uci(uci)
            if not ok.is_legal(possible):
                break
            if not bad_board.is_legal(possible):
                if (ply%2==0 and not ok.can_claim_draw() and not bad_board.can_claim_draw() and
                    bad_board.piece_at(played.to_square)==mover and
                    (kind:=blocker_disables(ok,bad_board,possible,played.to_square))):
                    key=(ok.fen(),bad_board.fen(),uci)
                    if key not in known:
                        known.add(key)
                        results.append(dict(
                            id=row["id"], fen=row["fen"], better=chosen.uci(), played=played.uci(),
                            betterSan=base.san(chosen), playedSan=base.san(played),
                            path=shared[:], san=sans[:], resource=possible.uci(),
                            resourceSan=ok.san(possible), obstruction=kind,
                            square=chess.square_name(played.to_square), blocker=chess.piece_name(mover.piece_type),
                            betterFen=ok.fen(), playedFen=bad_board.fen(), betterCp=best["cp"], playedCp=actual["cp"],
                            game=row.get("game"),event=row.get("event"),site=row.get("site"),
                            history=row.get("history"),
                        ))
                break
            if possible.from_square==played.to_square or possible.to_square==played.to_square:
                break
            if ok.piece_at(possible.from_square) != bad_board.piece_at(possible.from_square):
                break
            # A shared UCI must describe the same action, including captures.
            if (ok.piece_at(possible.to_square)!=bad_board.piece_at(possible.to_square) or
                ok.is_en_passant(possible)!=bad_board.is_en_passant(possible) or
                ok.is_castling(possible)!=bad_board.is_castling(possible)):
                break
            shared.append(uci)
            sans.append(ok.san(possible))
            ok.push(possible)
            bad_board.push(possible)
    return results


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",type=Path)
    parser.add_argument("inputs",type=Path,nargs="+")
    args=parser.parse_args()
    rows=[]
    checked=Counter()
    results=[]
    seen=set()
    for source in args.inputs:
        found=read(source)
        checked[source.name]+=len(found)
        for row in found:
            if "comparisonCandidates" not in row or not row["comparisonCandidates"]:
                continue
            sig=board_key(row["fen"]),row.get("playedMoveUci")
            if sig in seen:
                continue
            seen.add(sig)
            candidates=nominees(row)
            results.extend(candidates)
    print("Inputs",dict(checked),"deduplicated paired",len(seen),flush=True)
    print("Nominations",len(results),Counter(item["obstruction"] for item in results),flush=True)
    for r in results:
        print(r["id"],r["betterSan"],r["playedSan"]," ".join(r["san"]),r["resourceSan"],r["obstruction"])
    with args.output.open("x",encoding="utf8") as out:
        json.dump(results,out,indent=2)


if __name__=="__main__":
    main()
