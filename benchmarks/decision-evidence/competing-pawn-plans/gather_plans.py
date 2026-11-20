"""Freeze game-disjoint pawn-contact positions, then search exact choices."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.engine
import chess.pgn

import scan


def digest(data):
    return sha256(data).hexdigest()


def identify(board, moves):
    return digest("|".join((board.fen(), *moves[:24])).encode())


def canonical(board):
    return min(board.epd(), board.mirror().epd())


class Broadcast(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def select(paths, excluded_games, excluded_boards):
    for path in paths:
        candidates = []
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=Broadcast)) is not None:
                if game.errors or game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2"):
                    continue
                pos = game.board()
                if not pos.is_valid() or pos.chess960:
                    continue
                start = pos.fen()
                moves = [m.uci() for m in game.mainline_moves()]
                game_id = identify(pos, moves)
                if game_id in excluded_games:
                    continue
                choices = []
                for ply, uci in enumerate(moves[:84]):
                    move = chess.Move.from_uci(uci)
                    if (ply >= 24 and len(moves) >= ply+10 and not pos.is_check() and
                        not pos.is_capture(move) and pos.piece_type_at(move.from_square) == chess.PAWN and not move.promotion):
                        opponents = pos.pieces(chess.PAWN, not pos.turn)
                        attacks = chess.BB_PAWN_ATTACKS[pos.turn][move.to_square] & int(opponents)
                        if attacks and (key:=canonical(pos)) not in excluded_boards:
                            board = pos.fen()
                            branch = scan.observe_pawn_contacts(board, moves[ply:])
                            evidence = [route for route in branch if route["start"]==1]
                            case_id = digest(f"pawn-alternatives-v1:{game_id}:{ply}".encode())[:16]
                            choices.append(dict(id=case_id, event=path.stem,
                                source=game.headers.get("Site"), game=game_id, fen=board,
                                played=uci, history=dict(fen=start,moves=moves[:ply]),
                                selection="exchange" if evidence else "contact",
                                gameLine=moves[ply:ply+14], boardKey=key))
                    pos.push(move)
                if choices:
                    candidates.append(min(choices, key=lambda row: (row["selection"]!="exchange", row["id"])))
        yield path, candidates


def evaluate(job):
    case, binary, helper, root, reply, max_choices = job
    sys.path.insert(0, helper)
    from gather import initial, searched
    board = initial(case)
    with chess.engine.SimpleEngine.popen_uci(binary) as engine:
        engine.configure({"Threads":1,"Hash":64})
        lines = [dict(line,fen=board.fen()) for line in searched(engine,board,root,count=max_choices)]
        probes = []
        for line in lines[:1]:
            move = line["pvUci"][0]
            reached = board.copy()
            reached.push_uci(move)
            frames = [dict(item,fen=reached.fen()) for item in searched(engine,reached,reply,count=3)]
            probes.append(dict(moveUci=move,lines=frames))
    return dict(case,candidates=lines,replyProbes=probes)


def write(file, data):
    with file.open("x",encoding="utf-8") as out:
        json.dump(data,out,separators=(",",":"))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="action",required=True)
    select_cmd=sub.add_parser("freeze")
    for key in ("prior","out","manifest","phase"):
        select_cmd.add_argument(key,type=Path if key!="phase" else str)
    select_cmd.add_argument("pgn",type=Path,nargs="+")
    select_cmd.add_argument("--exclude",type=Path,nargs="*",default=[])
    select_cmd.add_argument("--each",type=int,default=7)
    evaluate_cmd=sub.add_parser("engine")
    for key in ("input","out","binary","helper"):
        evaluate_cmd.add_argument(key,type=Path)
    evaluate_cmd.add_argument("--root",type=int,default=1_200_000)
    evaluate_cmd.add_argument("--reply",type=int,default=1_800_000)
    evaluate_cmd.add_argument("--workers",type=int,default=7)
    evaluate_cmd.add_argument("--choices",type=int,default=3)
    args=parser.parse_args()
    if args.action=="freeze":
        prior=[row for p in [args.prior,*args.exclude] for row in json.loads(p.read_bytes())]
        games={row["game"] for row in prior if row.get("selection")}
        games.update(identify(chess.Board(history["fen"]),history["moves"]) for row in prior
                     if (history:=row.get("history")) and len(history["moves"])>=24)
        boards={canonical(chess.Board(row["fen"])) for row in prior}
        chosen, provenance = [], {}
        for path, rows in select(args.pgn,games,boards):
            counts=Counter()
            for row in sorted(rows,key=lambda item:item["id"]):
                kind = row["selection"]
                if counts[kind]>=args.each or row["game"] in games or row["boardKey"] in boards:
                    continue
                counts[kind]+=1
                games.add(row["game"])
                boards.add(row.pop("boardKey"))
                chosen.append(dict(row,phase=args.phase))
            provenance[path.name] = dict(available=Counter(x["selection"] for x in rows),
                                        selected=counts,sha256=digest(path.read_bytes()))
        write(args.out,chosen)
        write(args.manifest,provenance)
        print(len(chosen),dict(Counter(x["selection"] for x in chosen)),flush=True)
    else:
        data=json.loads(args.input.read_bytes())
        jobs=[(row,str(args.binary),str(args.helper),args.root,args.reply,args.choices) for row in data]
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            analysed=[]
            for result in pool.map(evaluate,jobs):
                analysed.append(result)
                if len(analysed)%20==0:
                    print(len(analysed),flush=True)
        write(args.out,analysed)
        print(len(analysed),flush=True)


if __name__=="__main__":
    main()
