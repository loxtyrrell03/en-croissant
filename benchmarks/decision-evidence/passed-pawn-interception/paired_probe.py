"""Two separately searched defences at the liquidation checkpoint."""
from importlib.util import spec_from_file_location, module_from_spec
import argparse
import json
from pathlib import Path
import sys
from time import perf_counter

import chess
import chess.engine

from interception import examples, material, replay, relative_rank

source = Path.cwd() / "scripts/benchmarks/decision-evidence-engine.py"
spec = spec_from_file_location("engine_search", source)
helper = module_from_spec(spec)
spec.loader.exec_module(helper)

def search(engine, board, roots, budget):
    start=perf_counter()
    frame=helper.CompleteVariations(board, 1, roots)
    final_nodes=0
    with engine.analysis(board, chess.engine.Limit(nodes=budget), multipv=1,
                         root_moves=roots, game=object()) as stream:
        for row in stream:
            frame.add(row)
            final_nodes=max(final_nodes,row.get("nodes",0))
    if frame.best is None:
        return None
    score=frame.best[0]["score"].relative
    pv=frame.best[0]["pv"]
    return {
        "fen":board.fen(),
        "cp":score.score(),
        "mate":score.mate(),
        "pvUci":[m.uci() for m in pv],
        "san":board.variation_san(pv[:14]),
        "depth":frame.best[0]["depth"],
        "nodes":final_nodes,
        "elapsedMs":round((perf_counter()-start)*1000,3),
    }

def pawn_outcome(board, square, variation):
    """Require the pawn itself to convert or the intercepting piece to be lost."""
    line = replay(board, variation["pvUci"])
    defender=board.turn
    pawn=chess.Piece(chess.PAWN,not defender)
    for i, step in enumerate(line[:-1]):
        if i>12:
            break
        m=step.move
        after=line[i+1].board
        if not m.promotion or step.pieces.get(m.from_square)!=square or step.board.piece_at(m.from_square)!=pawn:
            continue
        if after.is_checkmate():
            return dict(kind="promotion",move=step.san,trail=[],loss=None,ply=i+1)
        end=i+6
        if len(line)<=i+3:
            return None
        original=step.pieces[m.from_square]
        for j in range(i+1, min(end,len(line)-1)):
            ply=line[j]
            if ply.board.turn != defender or ply.pieces.get(ply.move.to_square) != original:
                continue
            # A promoting pawn can force the same exchange via an intervening
            # check, even when its promoted piece disappears immediately.
            target=ply.move.to_square
            loss=material(step.board,defender)-material(line[j+1].board,defender)
            if loss>=65 and step.board.is_capture(m):
                return dict(kind="promotion",move=step.san,trail=[s.san for s in line[i+1:j+1]],
                            loss=loss,ply=i+1)
            for k in range(j+1,min(j+4,len(line)-1)):
                takeback=line[k]
                if takeback.move.to_square != target:
                    if not (takeback.board.is_check() or line[k+1].board.is_check()):
                        break
                    continue
                if takeback.board.turn == defender or takeback.pieces.get(target) != ply.pieces.get(ply.move.from_square):
                    return None
                loss=material(step.board,defender)-material(line[k+1].board,defender)
                if loss>=65:
                    return dict(kind="promotion",move=step.san,trail=[s.san for s in line[i+1:k+1]],
                                loss=loss,ply=i+1)
                return None
            return None
        final=line[min(i+4,len(line)-1)]
        retained=any(orig==original and final.board.piece_at(sq)==chess.Piece(m.promotion,not defender)
                     for sq,orig in final.pieces.items())
        loss=material(step.board,defender)-material(final.board,defender)
        return (dict(kind="promotion",move=step.san,trail=[],loss=loss,ply=i+1)
                if retained and loss>=65 else None)
    for i, step in enumerate(line[:-2]):
        if i>10:
            break
        m=step.move
        next_=line[i+1]
        if step.board.turn!=defender or step.pieces.get(m.to_square)!=square:
            continue
        if step.board.piece_at(m.to_square)!=pawn or next_.move.to_square!=m.to_square:
            continue
        if step.board.piece_type_at(m.from_square) in (chess.KING,chess.PAWN):
            continue
        end=i+2
        while end<len(line)-1 and end<=i+3 and line[end].move.to_square==m.to_square:
            end+=1
        cost=material(step.board,defender)-material(line[end].board,defender)
        if cost>=65:
            return dict(kind="interception",move=step.san,
                        trail=[x.san for x in line[i+1:end]],loss=cost,ply=i+1)
    return None

def verify(engine, board, square, budget):
    moves=list(board.legal_moves)
    capture=[x for x in moves if x.to_square == square]
    avoid=[x for x in moves if x not in capture]
    if not capture:
        return None
    capture_line=search(engine, board, capture, budget)
    avoid_line=search(engine, board, avoid, budget) if avoid else None
    inside = pawn_outcome(board,square,capture_line) if capture_line else None
    outside = pawn_outcome(board,square,avoid_line) if avoid_line else None
    # A materially sound deferral is a counterexample. A short incomplete
    # line cannot confirm either a pawn conversion or a costly liquidation.
    proved=bool(inside and (outside if avoid else True))
    return dict(capture=capture_line,other=avoid_line,inside=inside,outside=outside,
                checkedCaptureMoves=len(capture),checkedOtherMoves=len(avoid),proved=proved)

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("stockfish", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--nodes", type=int, default=1_200_000)
    args=parser.parse_args()
    raw=args.input.read_text(encoding="utf-8")
    rows=json.loads(raw) if raw.startswith("[") else [json.loads(x) for x in raw.splitlines()]
    candidates=[item for row in rows for item in examples(row)]
    with chess.engine.SimpleEngine.popen_uci(str(args.stockfish)) as engine, args.output.open("x",encoding="utf-8") as out:
        engine.configure({"Threads":1,"Hash":48})
        for row in candidates:
            chosen=row["sacrifice"]
            board=chess.Board(chosen["fen"])
            square=chess.parse_square(chosen["square"])
            if row["repeat"]["fen"]!=chosen["fen"]:
                result={"status":"different-checkpoints"}
            else:
                result=verify(engine,board,square,args.nodes)
            item=dict(id=row["id"],proof=result,witness=row)
            if not result or not result.get("proved"):
                print(row["id"],"unverified",result and (result.get("inside"),result.get("outside")),flush=True)
            else:
                print(row["id"],result["inside"],result["outside"],flush=True)
            out.write(json.dumps(item,separators=(",",":"))+"\n")
            out.flush()
