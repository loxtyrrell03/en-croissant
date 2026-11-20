"""Build a blind review packet from independent Stockfish continuations."""
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from pathlib import Path
from threading import local,Lock
import hashlib
import importlib.util
import json
import sys
from time import monotonic

import chess
import chess.engine

LAB=Path(sys.argv[1])
EXE=sys.argv[2]
SOURCE=Path(sys.argv[3])
BUDGET=1_800_000
CHECK=1_650_000
spec=importlib.util.spec_from_file_location("search_core",Path.cwd()/"scripts/benchmarks/decision-evidence-engine.py")
engine_search=importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine_search)
V=[0,100,320,330,500,900,0]
state=local()
engines=[]

def engine():
    if not hasattr(state,"engine"):
        state.engine=chess.engine.SimpleEngine.popen_uci(EXE)
        state.engine.configure({"Threads":1,"Hash":64})
        engines.append(state.engine)
    return state.engine

def record(board,pv):
    moves=[]
    for move in pv:
        if move not in board.legal_moves:
            return []
        moves.append({"uci":move.uci(),"san":board.san(move)})
        board.push(move)
    return moves

def search(board,budget,ranks=2,root_moves=None):
    count=min(ranks,len(root_moves) if root_moves is not None else board.legal_moves.count())
    exact=engine_search.CompleteVariations(board,count,root_moves)
    with engine().analysis(board,chess.engine.Limit(nodes=budget),multipv=count,
                           root_moves=root_moves,game=object()) as stream:
        for info in stream:
            exact.add(info)
    if not exact.best:
        return []
    return [{
        "fen":board.fen(),"cp":info["score"].relative.score(),"mate":info["score"].relative.mate(),
        "depth":info["depth"],"nodes":info["nodes"],"variation":record(board.copy(stack=False),info["pv"][:18]),
    } for info in exact.best]

def total(board,color):
    return sum(V[k]*(len(board.pieces(k,color))-len(board.pieces(k,not color)))
               for k in range(chess.PAWN,chess.QUEEN+1))


def occupied_posts(root, line):
    board=root.copy(stack=False)
    side=not root.turn
    features={}
    materials=[]
    for index, step in enumerate(line):
        board.push_uci(step["uci"])
        materials.append(total(board,side))
        for square in board.pieces(chess.KNIGHT,side) | board.pieces(chess.BISHOP,side):
            rank=chess.square_rank(square) if side else 7-chess.square_rank(square)
            if rank < 4:
                continue
            file=chess.square_file(square)
            guards=[pawn for pawn in board.attackers(side,square) & board.pieces(chess.PAWN,side)
                    if not board.is_pinned(side,pawn) or square in board.pin(side,pawn)]
            if not guards:
                continue
            under_attack=bool(board.attackers(not side,square) & board.pieces(chess.PAWN,not side))
            file_challenge=any(abs(chess.square_file(pawn)-file)==1 and
                (chess.square_rank(pawn)>chess.square_rank(square) if side else
                 chess.square_rank(pawn)<chess.square_rank(square))
                for pawn in board.pieces(chess.PAWN,not side))
            if under_attack or file_challenge:
                continue
            key=chess.square_name(square)
            features.setdefault(key, []).append({
                "ply":index+1,"guard":[chess.square_name(s) for s in guards],
                "role":board.piece_at(square).symbol(),
                "legalCapture":any(m.to_square==square for m in board.generate_legal_captures()),
            })
    return dict(posts=features,material=materials)

def review(row):
    item={k:row[k] for k in ("id","event","phase","site","fen","playedMoveUci")}
    if row.get("skipped"):
        return dict(item,excluded=row["skipped"])
    root=chess.Board(row["fen"])
    item["pairLoss"]=row["comparisonCandidates"][0]["cp"]-row["comparisonCandidates"][1]["cp"]
    item["choices"]=[]
    for branch in row["comparisonCandidates"]:
        move=root.parse_uci(branch["pvUci"][0])
        san=root.san(move)
        child=root.copy(stack=False)
        child.push(move)
        lines=search(child,BUDGET,ranks=2) if not child.is_game_over() else []
        for ln in lines:
            ln["variation"].insert(0,dict(uci=move.uci(),san=san))
            ln.update(occupied_posts(root,ln["variation"]))
        item["choices"].append(dict(move=san,lines=lines))
    return item

rows=json.loads(SOURCE.read_text(encoding="utf-8"))
start=monotonic()
try:
    with ThreadPoolExecutor(5) as pool, (LAB/"deep-review.jsonl").open("x",encoding="utf8") as output:
        for n,row in enumerate(pool.map(review,rows),1):
            output.write(json.dumps(row,separators=(",",":"))+"\n")
            output.flush()
            if n%20==0: print(n,round(monotonic()-start,1),flush=True)
finally:
    for item in engines:
        item.quit()
