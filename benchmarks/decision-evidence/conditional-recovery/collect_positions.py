"""Sample normal rated classical positions before any engine scoring."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import hashlib
import json
import importlib.util
import chess
import chess.pgn

import chess.engine

import candidate_geometry as audit

def load_module(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

paired=load_module("paired_sampler",Path("benchmarks/decision-evidence/played-immediate-mate/collect.py"))


def types_at(board, played, reply):
    bad, victim=audit.branch(board,played.uci(),reply.uci())
    if bad is None:
        return None, 0
    types=set()
    alternatives=0
    for move in board.legal_moves:
        if move==played:
            continue
        good, target=audit.branch(board,move.uci(),reply.uci())
        if good is None or target!=victim:
            continue
        captures=[capture for capture in good.generate_legal_captures() if capture not in bad.legal_moves]
        if captures:
            alternatives+=1
        for capture in captures:
            if capture.to_square==reply.to_square:
                types.add("recapture")
            else:
                types.add("countercapture")
    return ("recapture" if "recapture" in types else next(iter(types),None)),alternatives


def sample(path, seen, maximum):
    sampler,choose=paired.develop.sampling,paired.verifier.choose
    buckets={key:{} for key in ("recapture","countercapture","ordinary")}
    games=0
    with path.open(encoding="utf-8-sig") as stream:
        while (game:=chess.pgn.read_game(stream)) is not None:
            board=game.board()
            if board.fen()!=chess.STARTING_FEN or game.errors or game.headers["Result"] not in ("1-0","0-1","1/2-1/2"):
                continue
            moves=list(game.mainline_moves())
            key=sampler.digest((sampler.board_key(board.fen())+" "+" ".join(m.uci() for m in moves)).encode())
            if len(moves)<40 or key in seen:
                continue
            games+=1
            for ply, move in enumerate(moves):
                if 28<=ply<len(moves)-10 and not board.is_game_over() and sampler.board_key(board.fen()) not in seen:
                    kind,alternatives=types_at(board,move,moves[ply+1])
                    stratum=kind or "ordinary"
                    buckets[stratum].setdefault(key,[]).append({
                        "id": f"conditional-{path.stem}-{key[:16]}-{ply}",
                        "event":path.stem,"sourceGroup":key,"ply":ply,"fen":board.fen(),
                        "gameMove":move.uci(),"gameReply":moves[ply+1].uci(),
                        "stratum":stratum,"legalAlternatives":alternatives,
                        "history":{"fen":chess.STARTING_FEN,"moves":[m.uci() for m in moves[:ply]]},
                    })
                board.push(move)
    picks=[]
    for (kind, entries), seats in zip(buckets.items(),maximum,strict=True):
        picks.extend(choose(entries,seats,"conditional-capture-holdout-v1",seen,sampler))
    return picks,{"games":games,
                  "picks":{kind:sum(x["stratum"]==kind for x in picks) for kind in buckets},
                  "population":{kind:len(entries) for kind,entries in buckets.items()},
                  "sha256":hashlib.sha256(path.read_bytes()).hexdigest()}


def leading(task):
    row,exe=task
    board=chess.Board(row["history"]["fen"])
    for move in row["history"]["moves"]:
        board.push_uci(move)
    assert board.fen()==row["fen"]
    with chess.engine.SimpleEngine.popen_uci(exe) as engine:
        engine.configure({"Threads":1,"Hash":64})
        spent=0
        for nodes in paired.develop.ROOT_BUDGETS:
            lines,receipt=paired.develop.search.search_replies(engine,board,min(3,board.legal_moves.count()),nodes)
            spent+=receipt["nodes"]
            if lines[0]["depth"]>=18 or lines[0]["mate"] is not None:
                break
    return row | {"candidates":lines,"rootNodes":spent}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory",type=Path)
    parser.add_argument("events",nargs="+",type=Path)
    parser.add_argument("--engine",type=Path,required=True)
    parser.add_argument("--prior",nargs="+",type=Path,required=True)
    parser.add_argument("--quotas",nargs=3,type=int,default=(18,18,6))
    args=parser.parse_args()
    previous=[row for path in args.prior for row in json.loads(path.read_bytes())]
    seen={paired.develop.sampling.board_key(row["fen"]) for row in previous}
    seen.update(row.get("sourceGroup") for row in previous)
    metadata={}
    manifest=[]
    for path in args.events:
        picks,metadata[path.stem]=sample(path,seen,args.quotas)
        manifest.extend(picks)
        print(path.name,metadata[path.stem],flush=True)
    paired.develop.write_new(args.directory/"frozen-sample.json",{"metadata":metadata,"positions":manifest})
    with (args.directory/"root-frames.jsonl").open("x",encoding="utf-8") as out:
        with ThreadPoolExecutor(max_workers=6) as pool:
            for i,result in enumerate(pool.map(leading, ((row,args.engine) for row in manifest)),1):
                out.write(json.dumps(result)+"\n")
                out.flush()
                if i%10==0:
                    print("searched",i,flush=True)


if __name__=="__main__":
    main()
