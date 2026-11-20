"""Freeze recorded classical moves that may cut a guard's line."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
import json
from pathlib import Path

import chess
import chess.pgn

from prepare import board_key, write
from scan import qualify, read


class Broadcast(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def game_prefix(fen,moves):
    return sha256("\0".join([fen,*moves[:24]]).encode()).hexdigest()


def candidate_games(job):
    path, blocked_games, blocked_boards = job
    positives, negatives = [], []
    population = Counter()
    with path.open(encoding="utf-8-sig",errors="replace") as source:
        while (game := chess.pgn.read_game(source,Visitor=Broadcast)) is not None:
            site=game.headers.get("Site","")
            control=game.headers.get("TimeControl","").split("+")[0].split("/")[-1]
            if (game.errors or game.headers.get("Result") not in ("1-0","0-1","1/2-1/2")
                or any(f"-{tag}-" in site.lower() for tag in ("rapid","blitz","bullet","armageddon","freestyle"))
                or control.isdecimal() and int(control)<3600):
                continue
            board=game.board()
            if board.chess960 or not board.is_valid():
                continue
            start=board.fen()
            nodes=list(game.mainline())
            moves=[node.move.uci() for node in nodes]
            identity=game_prefix(start,moves)
            if len(moves)<30 or identity in blocked_games:
                continue
            options=[]
            for index,node in enumerate(nodes):
                if 25<=index<min(len(nodes)-3,155) and not node.move.promotion:
                    sample=board.fen()
                    if board_key({"fen":sample}) not in blocked_boards:
                        route=moves[index:index+9]
                        fired=qualify(board,route)
                        if fired:
                            kind="used-cut" if any(x["kind"]=="used-cut" for x in fired) else "near-miss"
                            token=sha256(f"guard-cut-{identity}-{index}".encode()).hexdigest()[:16]
                            options.append(dict(id=f"classical-cut-{token}",fen=sample,line=route,
                                                game=identity,event=path.stem,site=site,caseKind=kind,
                                                hypotheses=fired,history=dict(fen=start,moves=moves[:index])))
                            population[kind]+=1
                board.push(node.move)
            if options:
                row=min(options,key=lambda item:(item["caseKind"]!="used-cut",item["id"]))
                (positives if row["caseKind"]=="used-cut" else negatives).append(row)
    print(path.name,len(positives),len(negatives),dict(population),flush=True)
    return positives,negatives,population


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",type=Path)
    parser.add_argument("manifest",type=Path)
    parser.add_argument("sources",nargs="+",type=Path)
    parser.add_argument("--exclude",nargs="+",type=Path,default=[])
    args=parser.parse_args()
    groups=[row for old in args.exclude for row in read(old)]
    boards={board_key(row) for row in groups}
    games={game_prefix(row["history"]["fen"],row["history"]["moves"])
           for row in groups if row.get("history") and len(row["history"]["moves"])>=24}
    picks,metadata=[],{}
    with ProcessPoolExecutor(max_workers=6) as pool:
        jobs=[(source,games,boards) for source in args.sources]
        for path,(pos,neg,counter) in zip(args.sources,pool.map(candidate_games,jobs),strict=True):
            picks.extend(pos+neg)
            metadata[str(path)]=dict(sha256=sha256(path.read_bytes()).hexdigest(),population=counter)
    final=[]
    counts,by_source=Counter(),Counter()
    for row in sorted(picks,key=lambda row:row["id"]):
        key=board_key(row)
        kind=row["caseKind"]
        event=row["event"]
        if row["game"] in games or key in boards or counts[kind]>=18 or by_source[event,kind]>=5:
            continue
        games.add(row["game"])
        boards.add(key)
        counts[kind]+=1
        by_source[event,kind]+=1
        final.append(row)
    write(args.output,final)
    write(args.manifest,dict(counts=counts,sources=metadata))
    print("frozen",dict(counts))


if __name__=="__main__":
    main()
