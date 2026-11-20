"""Test whether the published checking move beats the direct recapture."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import sys
import chess

sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from search import engines,search

source,destination=map(Path,sys.argv[1:3])
exe=sys.argv[3]
puzzles=json.loads(source.read_bytes())["rows"]


def review(row):
    board=chess.Board(row["fen"])
    seq=[chess.Move.from_uci(m) for m in row["sourcePath"][:5]]
    for move in seq[:2]:
        board.push(move)
    check, answer, direct=seq[2:]
    if not board.is_legal(direct):
        return {"id":row["id"],"checkLegal":board.is_legal(check),"directLegal":False}
    board_after=board.copy()
    board_after.push(direct)
    king=board_after.king(board_after.turn)
    control=chess.Move(king,direct.to_square)
    king_takes=board_after.is_legal(control)
    checked=board.gives_check(check)
    after=board.copy()
    after.push(check)
    king_moves=after.piece_type_at(answer.from_square)==chess.KING
    reply=board.piece_type_at(direct.to_square)
    record={"id":row["id"],"fen":board.fen(),"check":check.uci(),"direct":direct.uci(),
            "directLegal":True,"kingCanTake":king_takes,"checkGivesCheck":checked,
            "kingMoves":king_moves,"targetRole":chess.piece_name(reply) if reply else None}
    if king_takes and checked and king_moves and reply==chess.ROOK:
        record["comparison"]=search(board,exe,3_000_000,2,[check,direct])
    return record


try:
    with destination.open("x",encoding="utf-8") as f, ThreadPoolExecutor(4) as pool:
        for item in pool.map(review,puzzles):
            f.write(json.dumps(item,separators=(",",":"))+"\n")
            f.flush()
finally:
    for runner in engines:
        runner.quit()
