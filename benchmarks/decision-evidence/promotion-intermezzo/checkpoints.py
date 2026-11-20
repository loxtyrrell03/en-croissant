"""Search exact counterfactual positions after the same legal sequence."""
from pathlib import Path
import json
import sys
import chess

sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from gather import root_board
from search import engines,search

w,l,exe=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
cases=json.loads((w/"mixed-structure-after-tactics/mixed.json").read_bytes())
nyc=next(row for row in cases if "42ce922" in row["id"])
peace=next(row for row in cases if "7451432" in row["id"])
output={}
try:
    board=root_board(nyc)
    controls=[]
    for uci in ("c1e1","c1d1"):
        local=board.copy()
        path=[uci,"a8c8","b6d4","g7d4","f2d4","c8c1"]
        for step in path:
            local.push_uci(step)
        moves=local.legal_moves.count()
        control={"root":uci,"path":path,"qD1Legal":chess.Move.from_uci("d4d1") in local.legal_moves,
                 "broad":search(local,exe,5_000_000,min(3,moves))}
        if control["qD1Legal"]:
            not_qd1=[move for move in local.legal_moves if move!=chess.Move.from_uci("d4d1")]
            control["withoutQd1"]=search(local,exe,5_000_000,1,not_qd1)
        controls.append(control)
    output["nyc"]=controls

    board=root_board(peace)
    options=[move for move in board.legal_moves if move.promotion]
    output["peacePromotions"]=search(board,exe,6_000_000,len(options),options)
    (l/"checkpoints.json").write_text(json.dumps(output,indent=2),encoding="utf-8")
finally:
    for item in engines:
        item.quit()
