"""Freeze a public classical sample enriched for physically obstructed defences."""
import argparse
from collections import Counter,defaultdict
from hashlib import sha256
from pathlib import Path
import json
import sys

import chess
import chess.pgn
sys.path.insert(0,str(Path.cwd()/"benchmarks/decision-evidence/reply-search-allocation"))
from sample import classical_sources
from nominate import board_key,read

SEED="blocked-defensive-resource-18738d62"
TARGETS={"checking-obstruction":72,"quiet-pressure":50,"control":40}


def defended(board, blocker, kind):
    # Only sample potential check defences or direct replies to a threatened
    # major piece. Removing the blocker is an enrichment filter, not evidence.
    shadow=board.copy(stack=False)
    shadow.remove_piece_at(blocker)
    for move in shadow.legal_moves:
        if board.is_legal(move):
            continue
        if move.to_square==blocker:
            return True
        if (shadow.piece_type_at(move.from_square) in (chess.QUEEN,chess.ROOK,chess.BISHOP)
            and chess.between(move.from_square,move.to_square) & chess.BB_SQUARES[blocker]):
            return True
    return False


def stratum(board, sequence):
    move=sequence[0]
    actor=board.turn
    piece=board.piece_at(move.from_square)
    if not piece or piece.piece_type not in (chess.QUEEN,chess.ROOK,chess.BISHOP,chess.KNIGHT):
        return None
    if board.is_capture(move) or board.is_check():
        return None
    # Track just the original mover until its first subsequent move.
    pos=board.copy(stack=False)
    pos.push(move)
    offered=False
    for reply in sequence[1:7]:
        next_side=pos.turn
        if reply.from_square==move.to_square or reply.to_square==move.to_square:
            break
        moved=pos.piece_at(reply.from_square)
        pos.push(reply)
        if next_side==actor:
            continue
        if pos.is_check() and defended(pos,move.to_square,"check"):
            return "checking-obstruction"
        if moved.piece_type not in (chess.QUEEN,chess.ROOK):
            continue
        attacked=pos.attacks(reply.to_square) & (pos.pieces(chess.ROOK,actor) | pos.pieces(chess.QUEEN,actor))
        if attacked and defended(pos,move.to_square,"pressure"):
            offered=True
    return "quiet-pressure" if offered else None


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("prior",type=Path,nargs="+")
    args=parser.parse_args()
    excluded=[row for file in args.prior for row in read(file)]
    old={board_key(row["fen"]) for row in excluded}
    old_sites={row["site"] for row in excluded if row.get("site")}
    old_events={row.get("event") for row in read(args.prior[-1])}
    sources=classical_sources(args.work)
    pool=defaultdict(list)
    seen=set()
    game_count=0
    for file,(event,site) in sorted(sources.items()):
        if event in old_events:
            continue
        with file.open(encoding="utf-8-sig",errors="replace") as stream:
            while (game:=chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result","*")=="*" or not game.headers.get("White"):
                    continue
                game_site=game.headers.get("Site")
                if game_site in old_sites:
                    continue
                nodes=list(game.mainline())
                moves=[node.move for node in nodes]
                if len(moves)<35:
                    continue
                uci=[move.uci() for move in moves]
                key=sha256((event+" "+" ".join(uci[:34])).encode()).hexdigest()
                if key in seen:
                    continue
                seen.add(key)
                game_count+=1
                board=game.board()
                local=[]
                for ply,node in enumerate(nodes):
                    if ply>=25 and board_key(board.fen()) in old:
                        break
                    if 23<=ply<len(nodes)-4:
                        old_eval,new_eval=node.parent.eval(),node.eval()
                        loss=None if old_eval is None or new_eval is None else (
                            old_eval.pov(board.turn).score(mate_score=5000)
                            -new_eval.pov(board.turn).score(mate_score=5000)
                        )
                        kind=None
                        if loss is not None and loss>=80:
                            kind=stratum(board,moves[ply:ply+7])
                        if loss is not None and abs(loss)<=15 and stratum(board,moves[ply:ply+7]):
                            kind="control"
                        if kind:
                            token=sha256(f"{SEED}:{key}:{ply}".encode()).hexdigest()[:16]
                            selected_site=game_site if game_site and game_site.startswith("https://lichess.org/broadcast/") else site
                            local.append(dict(id="blocked-defence-"+token,event=event,game=key,site=selected_site,
                                fen=board.fen(),playedMoveUci=uci[ply],recorded=uci[ply:ply+7],stratum=kind,
                                priorAnnotatedLossCp=loss,ply=ply,history=dict(fen=game.board().fen(),moves=uci[:ply])))
                    board.push(node.move)
                else:
                    for case in local: pool[case["stratum"]].append(case)
    chosen=[]
    seen_games=set()
    seen_boards=set()
    counts=Counter()
    for arm,cap in TARGETS.items():
        for _ in range(cap):
            candidates=[item for item in pool[arm] if item["game"] not in seen_games and item["fen"] not in seen_boards]
            if not candidates:
                break
            item=min(candidates,key=lambda row:(counts[row["event"]]//3,row["id"]))
            seen_games.add(item["game"])
            seen_boards.add(item["fen"])
            counts[item["event"]]+=1
            chosen.append(item)
    args.output.write_text(json.dumps(chosen,separators=(",",":")),encoding="utf8")
    print(len(chosen),len(counts),"events",game_count,"scanned",
          Counter(x["stratum"] for x in chosen),"candidates", {k:len(v) for k,v in pool.items()},flush=True)

if __name__=="__main__":
    main()
