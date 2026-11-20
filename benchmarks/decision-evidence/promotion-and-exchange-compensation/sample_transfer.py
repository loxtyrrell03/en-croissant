"""Freeze a public classical transfer sample before searching any continuations."""
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn
sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from sample import board_key, classical_sources


def signature(fen, moves):
    return sha256((fen+" "+" ".join(moves[:24])).encode()).hexdigest()


def kind(board, moves, material):
    side = board.turn
    ranks = chess.BB_RANK_6 if side else chess.BB_RANK_3
    if material <= 32 and board.pieces_mask(chess.PAWN,side) & ranks:
        # Prefer an observed push to the seventh, then legally available pushes.
        pawns = list(chess.SquareSet(board.pieces_mask(chess.PAWN,side) & ranks))
        proposals = [chess.Move(s,s+(8 if side else -8)) for s in pawns]
        if any(board.is_legal(move) for move in proposals):
            return "pawn", 0 if moves[0] in proposals else 1
    if (
        21 <= material <= 50 and len(board.pieces(chess.ROOK,side)) == 2
        and board.piece_type_at(moves[0].from_square) == chess.ROOK
        and board.is_capture(moves[0]) and len(moves) >= 3
        and moves[0].to_square == moves[1].to_square == moves[2].to_square
        and board.piece_type_at(moves[2].from_square) == chess.ROOK
        and board.piece_type_at(moves[1].from_square) in (chess.BISHOP,chess.KNIGHT)
    ):
        return "exchange", 0
    return None


def material(board):
    return sum(len(board.pieces(role, side))*value
               for role,value in [(1,1),(2,3),(3,3),(4,5),(5,9)] for side in (0,1))


def pick(work, old, out):
    archived = [rec for file in old for rec in json.loads(file.read_bytes())]
    known_boards = {board_key(chess.Board(rec["fen"])) for rec in archived}
    excluded_games = {signature(h["fen"], h["moves"]) for r in archived
                      if (h:=r.get("history")) and len(h["moves"])>=24}
    known_games=set()
    pool=defaultdict(list)
    for file,(event,fallback) in sorted(classical_sources(work).items()):
        if "buongoma" in event or "amateur" in event:
            continue
        with file.open(encoding="utf-8-sig",errors="replace") as stream:
            while (game:=chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result","*")=="*":
                    continue
                moves=list(game.mainline_moves())
                if len(moves)<45:
                    continue
                all_uci=[move.uci() for move in moves]
                board=game.board()
                start=board.fen()
                key=signature(start,all_uci)
                if key in excluded_games or key in known_games:
                    continue
                known_games.add(key)
                local=defaultdict(list)
                for ply,move in enumerate(moves):
                    if 30 <= ply < len(moves)-8:
                        identity = board_key(board)
                        if identity in known_boards:
                            break
                        stratum = kind(board,moves[ply:ply+3],material(board))
                        token = sha256(f"compensation-trial:{key}:{ply}".encode()).hexdigest()
                        control = 0 if ply>=50 and int(token[:4],16)<100 else None
                        if stratum or control is not None:
                            label,quality = stratum or ("control",0)
                            site=game.headers.get("Site","")
                            if not site.startswith("https://lichess.org/broadcast/"):
                                site=fallback
                            local[label].append((quality, dict(
                                id="compensation-"+token[:16],stratum=label,event=event,game=key,
                                fen=board.fen(),site=site,ply=ply,playedMoveUci=move.uci(),
                                history={"fen":start,"moves":all_uci[:ply]},
                            )))
                    board.push(move)
                else:
                    for label,picks in local.items():
                        pool[label].append(min(picks,key=lambda choice:(choice[0],choice[1]["id"])))
    selected=[]
    used=set()
    root_keys=set()
    from_event=Counter()
    for label,limit in (("exchange",28),("pawn",64),("control",24)):
        left=sorted(pool[label],key=lambda option:(option[0],option[1]["id"]))
        for _ in range(limit):
            unique=[(quality,r) for quality,r in left if r["game"] not in used
                    and board_key(chess.Board(r["fen"])) not in root_keys]
            if not unique:
                break
            quality,item=min(unique,key=lambda option:
                (option[0],from_event[option[1]["event"]],option[1]["id"]))
            chosen = board_key(chess.Board(item["fen"]))
            root_keys.add(chosen)
            selected.append(item)
            used.add(item["game"])
            from_event[item["event"]] += 1
    with out.open("x",encoding="utf-8") as file:
        json.dump(selected,file,separators=(",",":"))
    print(len(known_games),"games screened",dict(Counter(row["stratum"] for row in selected)),
          len(from_event),"events",sha256(out.read_bytes()).hexdigest(),flush=True)


if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("work",type=Path)
    p.add_argument("output",type=Path)
    p.add_argument("prior",type=Path,nargs="+")
    a = p.parse_args()
    pick(a.work,a.prior,a.output)
