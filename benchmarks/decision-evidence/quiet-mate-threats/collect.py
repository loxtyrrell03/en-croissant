"""Select quiet mate threats using legal geometry before engine analysis."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import importlib.util
import json
from collections import Counter

import chess
import chess.engine
import chess.pgn

repo=Path("benchmarks/decision-evidence")
spec=importlib.util.spec_from_file_location("played_sampler",repo/"played-immediate-mate/collect.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def mating(board):
    yield from (chess.Move.from_uci(move) for move in module.verifier.mates(board))


def offer(board, move):
    if board.is_check() or move.promotion or board.is_capture(move) or board.gives_check(move):
        return None
    child=board.copy(stack=False)
    child.push(move)
    if child.is_game_over():
        return None
    trial=child.copy(stack=False)
    trial.turn=board.turn
    trial.ep_square=None
    threats=set(mating(trial))
    if not threats or next(mating(board),None) is not None:
        return None
    defenses, ignores = [], []
    for reply in child.legal_moves:
        if child.is_capture(reply) and reply.to_square==move.to_square:
            return None
        san=child.san(reply)
        child.push(reply)
        answers=set(mating(child)) if not child.is_game_over() else set()
        if not answers and not child.is_game_over():
            defenses.append((reply.uci(),san))
        elif matched:=answers.intersection(threats):
            ignores.append((reply.uci(),san,sorted((r.uci(),child.san(r)) for r in matched)))
        child.pop()
    if not defenses or not ignores:
        return None
    return {"defences":defenses,"ignores":ignores}


def event(path,seen):
    sampler=module.develop.sampling
    groups={key:{} for key in ("geometry","control")}
    games=0
    with path.open(encoding="utf8") as stream:
        while (game:=chess.pgn.read_game(stream)) is not None:
            b=game.board()
            if game.errors or game.headers.get("Result") not in ("1-0","0-1","1/2-1/2") or b.fen()!=chess.STARTING_FEN:
                continue
            moves=list(game.mainline_moves())
            if len(moves)<40:
                continue
            game_key=sampler.digest((sampler.board_key(b.fen())+" "+" ".join(m.uci() for m in moves)).encode())
            if game_key in seen:
                continue
            games+=1
            for ply,m in enumerate(moves):
                if 24<=ply<min(160,len(moves)-2) and sampler.board_key(b.fen()) not in seen:
                    motif=offer(b,m)
                    quiet=not b.is_check() and not m.promotion and not b.is_capture(m) and not b.gives_check(m)
                    if motif or quiet:
                        group="geometry" if motif else "control"
                        groups[group].setdefault(game_key,[]).append({
                            "id":f"quiet-threat-{path.stem}-{game_key[:16]}-{ply}",
                            "fen":b.fen(),"stratum":group,"sourceGroup":game_key,"event":path.stem,
                            "gameMoveUci":m.uci(),"gameReplyUci":moves[ply+1].uci(),"proofByEnumeration":motif,
                            "history":{"fen":chess.STARTING_FEN,"moves":[x.uci() for x in moves[:ply]]},
                        })
                b.push(m)
    picks=[]
    for group,target in (("geometry",20),("control",10)):
        picks.extend(module.verifier.choose(groups[group],target,"quiet-mate-threat-20251119-v1",seen,sampler))
    return picks, {"gamePopulation":games,"casePopulations":{k:len(v) for k,v in groups.items()},
                   "picked":dict(Counter(x["stratum"] for x in picks)),
                   "sha256":hashlib.sha256(path.read_bytes()).hexdigest()}


def analyse(task):
    case,engine=task
    row={**case,"playedMoveUci":case["gameMoveUci"]}
    return module.analyse((row,engine))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dir",type=Path)
    parser.add_argument("events",nargs="+",type=Path)
    parser.add_argument("--engine",type=Path,required=True)
    parser.add_argument("--exclude",nargs="+",type=Path,required=True)
    args=parser.parse_args()
    old=[r for path in args.exclude for r in json.loads(path.read_bytes())]
    seen={module.develop.sampling.board_key(r["fen"]) for r in old}
    seen.update(r.get("sourceGroup") for r in old)
    manifest=[]
    metadata={}
    for path in args.events:
        rows,metadata[path.stem]=event(path,seen)
        print(path.name,metadata[path.stem],flush=True)
        manifest.extend(rows)
    module.develop.write_new(args.dir/"fresh-threat-manifest.json",{"events":metadata,"cases":manifest})
    with (args.dir/"fresh-threat-engine.jsonl").open("x",encoding="utf8") as f:
        with ThreadPoolExecutor(5) as pool:
            for i,row in enumerate(pool.map(analyse,((row,args.engine) for row in manifest)),1):
                f.write(json.dumps(row)+"\n")
                f.flush()
                if i%10==0:
                    print("searched",i,flush=True)

if __name__=="__main__":
    main()
