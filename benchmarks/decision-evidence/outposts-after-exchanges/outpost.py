"""Follow a tactical exchange into a stable knight or bishop square."""
from collections import defaultdict
from pathlib import Path
import json,sys
import chess
from interception import material,relative_rank,replay

def supports(board, square, side):
    file=chess.square_file(square)
    if relative_rank(side,square)<5:
        return None
    piece=board.piece_at(square)
    if not piece or piece.color!=side or piece.piece_type not in (chess.KNIGHT,chess.BISHOP):
        return None
    opposing=board.pieces(chess.PAWN,not side)
    if any(abs(chess.square_file(s)-file)==1 and relative_rank(side,s)>relative_rank(side,square) for s in opposing):
        return None
    helpers=board.attackers(side,square)&board.pieces(chess.PAWN,side)
    return [s for s in helpers if not board.is_pinned(side,s) or square in board.pin(side,s)] or None

def local_context(row):
    comparison=row.get("comparisonCandidates") or []
    if len(comparison)!=2:return None
    better,played=comparison
    choices={r["moveUci"]:r["lines"][0] for r in row.get("replyProbes",[]) if r["lines"]}
    raw=[better,played,choices.get(better["pvUci"][0]),choices.get(played["pvUci"][0])]
    if (
        not all(line and line.get("cp") is not None and line.get("mate") is None for line in raw)
        or played["pvUci"][0]!=row.get("playedMoveUci")
        or better["depth"]!=played["depth"]
        or min(raw[2]["depth"],raw[3]["depth"])<16
        or better["cp"]-played["cp"]<60
        or raw[3]["cp"]-raw[2]["cp"]<40
        or any(abs(a["cp"]+b["cp"])>90 for a,b in zip(raw[:2],raw[2:]))
    ):return None
    board=chess.Board(row["fen"])
    trails=[replay(board,a["pvUci"][:14]) for a in raw[:2]]
    trails.extend([replay(board,[a["pvUci"][0],*b["pvUci"][:13]]) for a,b in zip(raw[:2],raw[2:])])
    return (board,trails) if all(len(t)>=5 for t in trails) else None

def candidates(board, frames, linked):
    actor=not board.turn
    pending={}
    for i,(before,after) in enumerate(zip(frames,frames[1:])):
        move=before.move
        if before.board.turn!=actor:continue
        from_,to=move.from_square,move.to_square
        piece=before.board.piece_at(from_)
        if not piece or piece.piece_type not in (chess.KNIGHT,chess.BISHOP):continue
        origin=before.pieces.get(from_)
        pawn=before.board.piece_at(to)
        if (pawn==chess.Piece(chess.PAWN,not actor)):
            pending[origin]=(i,to,before.pieces.get(to),before.san)
        check=pending.get(origin)
        if not check or not (0<i-check[0]<=4) or i>8:continue
        supporters=supports(after.board,to,actor)
        if not supporters or supports(board,to,actor) or origin==to:continue
        cap,entry,victim,san=check
        if victim is None or board.piece_at(victim)!=chess.Piece(chess.PAWN,not actor):continue
        old_attacks=chess.BB_PAWN_ATTACKS[not actor][victim]
        if linked and not (old_attacks&(chess.BB_SQUARES[entry]|chess.BB_SQUARES[to])
                           or victim in (entry,to)):
            continue
        if any(
            they.board.turn!=actor and any(
                m.to_square==to and they.board.piece_type_at(m.from_square)==chess.KING
                for m in they.board.generate_legal_captures()
            ) for they in frames[i+1:i+5]
        ):continue
        yield dict(start=i+1,origin=origin,square=to,victim=victim,capture=san,entry=before.san)

def scan(board,traces,linked=True):
    actor=not board.turn
    better,played,other_better,other=traces
    lookup=defaultdict(list)
    for b in candidates(board,other,linked):
        lookup[(b["origin"],b["square"],b["victim"])].append(b)
    for a in candidates(board,played,linked):
        for b in lookup[(a["origin"],a["square"],a["victim"])]:
            square=a["square"]
            length=min(map(len,traces))-1
            for through in range(max(a["start"],b["start"])+3,min(12,length)+1):
                if any(any(
                    frame.pieces.get(square)!=v["origin"] or not supports(frame.board,square,actor)
                    for frame in branch[v["start"]:through+1])
                    for v,branch in ((a,played),(b,other))
                ):continue
                if any(any(supports(f.board,square,actor) for f in t[:through+1])
                       for t in (better,other_better)):
                    break
                # The strategic feature must survive the end of the exchange
                # at a matched, non-checking and materially comparable horizon.
                if any(t[through].board.is_check() or
                       material(t[through].board,actor)!=material(t[through-1].board,actor) for t in traces):
                    continue
                net=[material(t[through].board,actor) for t in traces]
                if max(net)-min(net)>110:continue
                return dict(first=a,repeated=b,through=through,material=net,
                            lines=[[f.san for f in t[:through]] for t in traces])
    return None

if __name__=="__main__":
    for file in sys.argv[1:]:
        text=Path(file).read_text(encoding="utf8")
        rows=json.loads(text) if text.startswith("[") else [json.loads(s) for s in text.splitlines()]
        result=[]
        for r in rows:
            c=local_context(r)
            if not c:continue
            a=scan(*c)
            b=scan(*c,linked=False)
            if a or b:result.append(dict(id=r["id"],linked=a,domain=b))
        print(Path(file).name,len(result))
        for r in result:print(r)
