"""Reserve event-disjoint games for the prespecified wider promotion horizon."""
import argparse
from collections import defaultdict,Counter
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
from urllib.request import urlopen

import chess
import chess.pgn
from sample_transfer import board_key, kind, material, signature


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for field in ("manifest","first","output"):
        p.add_argument(field,type=Path)
    p.add_argument("prior",type=Path,nargs="+")
    args=p.parse_args()
    first=json.loads(args.first.read_bytes())
    known=[*first,*[row for file in args.prior for row in json.loads(file.read_bytes())]]
    excluded={signature(h["fen"],h["moves"]) for row in known if (h:=row.get("history"))
              and len(h["moves"])>=24}
    old_boards={board_key(chess.Board(row["fen"])) for row in known}
    old_events={row["event"] for row in first}
    used=set()
    pool=defaultdict(list)
    for ref in json.loads(args.manifest.read_bytes()):
        slug=ref["event"]
        if slug in old_events or "buongoma" in slug or "amateur" in slug:
            continue
        with urlopen(ref["url"],timeout=15) as reply:
            raw=reply.read(1_500_001)
        if len(raw)>1_500_000:
            raise ValueError("Round exceeded the bounded PGN budget")
        if sha256(raw).hexdigest()!=ref["sha256"]:
            print("Changed round",ref["round"],flush=True)
            continue
        stream=StringIO(raw.decode("utf-8-sig",errors="replace"))
        while (game:=chess.pgn.read_game(stream)) is not None:
            if game.errors or game.headers.get("Result","*")=="*":
                continue
            moves=list(game.mainline_moves())
            if len(moves)<45:
                continue
            ucis=[move.uci() for move in moves]
            board=game.board()
            start=board.fen()
            key=signature(start,ucis)
            if key in excluded or key in used:
                continue
            used.add(key)
            items=[]
            for ply,move in enumerate(moves):
                if 40<=ply<len(moves)-8:
                    if board_key(board) in old_boards:
                        break
                    k=kind(board,moves[ply:ply+3],material(board))
                    if k and k[0]=="pawn":
                        token=sha256(f"deferred-promotion-v1:{key}:{ply}".encode()).hexdigest()
                        items.append((k[1],dict(
                            id="deferred-promotion-"+token[:16], stratum="pawn", event=slug,game=key,
                            site=f"https://lichess.org/broadcast/{slug}/round/{ref['round']}",
                            fen=board.fen(),playedMoveUci=move.uci(),ply=ply,
                            history={"fen":start,"moves":ucis[:ply]},
                        )))
                board.push(move)
            else:
                if items:
                    pool[slug].append(min(items,key=lambda item:(item[0],item[1]["id"])))
    rows=[]
    for event, candidates in sorted(pool.items()):
        count=0
        for _,row in sorted(candidates,key=lambda item:(item[0],item[1]["id"])):
            identity=board_key(chess.Board(row["fen"]))
            if identity in old_boards:
                continue
            rows.append(row)
            old_boards.add(identity)
            count+=1
            if count>=9:
                break
    with args.output.open("x",encoding="utf-8") as out:
        json.dump(rows,out,separators=(",",":"))
    print(len(rows),"frozen positions",dict(Counter(r["event"] for r in rows)),
          sha256(args.output.read_bytes()).hexdigest(),flush=True)


if __name__=="__main__":
    main()
