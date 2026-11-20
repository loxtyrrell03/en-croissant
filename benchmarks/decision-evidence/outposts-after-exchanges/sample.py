"""Nominate overlooked decisions from annotated, verified classical broadcasts."""
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys

import chess
import chess.pgn
from interception import replay
from outpost import candidates,supports

WORK=Path(sys.argv[1])
OUT=Path(sys.argv[2])
SEED="exchange-outpost-fb53374e-20261120"

sources={}
metadata={}

def classical(tc):
    # Only broadcasts with explicit time settings of at least 60 minutes.
    import re
    values=re.findall(r"(\d+)\s*(?:min\b|mins\b|minutes\b|m\b)",tc.lower())
    return bool(values and int(values[0])>=60)

def register(file, key, tc, title, site):
    if file.is_file() and classical(tc):
        sources[file]=key
        metadata[key]={"title":title,"timeControl":tc,"broadcast":site}

for file in WORK.rglob("public-sources.json"):
    if not (file.parent/"raw").is_dir():
        continue
    for key,record in json.loads(file.read_bytes()).items():
        if not record.get("broadcast") or not record.get("tc"):
            continue
        stamp=record["broadcast"].removeprefix("https://lichess.org/broadcast/").split("/")[0]
        for rd in record["rounds"]:
            register(file.parent/"raw"/(key+"-"+rd["id"]+".pgn"),stamp,record["tc"],record["title"],
                     "https://lichess.org/broadcast/"+record["broadcast"])
for file in WORK.rglob("*-info.json"):
    data=json.loads(file.read_bytes())
    tournament=data.get("tour",{})
    info=tournament.get("info",{})
    if info.get("fideTC")!="standard" or not data.get("round",{}).get("url") or not tournament.get("slug"):
        continue
    for path in file.parent.glob(file.name[:-10]+"*.pgn"):
        register(path,tournament["slug"],info.get("tc",""),tournament["name"],data["round"]["url"])

def board_key(board):
    return min(board.epd(), board.mirror().epd())
def root_rows(file):
    try:
        data=json.loads(file.read_bytes())
    except (FileNotFoundError,ValueError):
        return []
    if isinstance(data,dict):data=data.get("cases",[])
    return data

previous=[]
for path in ("reply-coverage-audit/full-pair-input.json",
             "passer-interception-transfer/final-input.json",
             "paired-causal-probe/inputs.json","paired-causal-probe/fresh/inputs.json",
             "paired-causal-probe/second-puzzle/inputs.json",
             "strategic-asset-contrast/classical-engine-sample.json",
             "strategic-asset-contrast/replication/classical-engine-sample.json",
             "strategic-asset-contrast/reserve/classical-engine-sample.json"):
    previous+=root_rows(WORK/path)
old_sites=set(r["site"] for r in previous if str(r.get("site","")).startswith("https://lichess.org/broadcast/"))
old_tokens=set(str(r.get("game","")) for r in previous)
old_boards={board_key(chess.Board(r["fen"])) for r in previous if r.get("fen")}
old_families={k for k in metadata if "disabilit" in k or "grand-swiss" in k} # own development witnesses
games={}
seen=set()
all_candidates=[]
stats=Counter()
for file,event in sorted(sources.items()):
    if event in old_families:
        continue
    with file.open(encoding="utf-8-sig",errors="replace") as inp:
        for game in iter(lambda:chess.pgn.read_game(inp),None):
            if game.errors or game.headers.get("Result","*")=="*" or not game.headers.get("Event"):
                continue
            nodes=list(game.mainline())
            if len(nodes)<40:
                continue
            moves=[n.move.uci() for n in nodes]
            site=game.headers.get("Site","")
            base_id=event+"|"+game.headers.get("White","")+"|"+game.headers.get("Black","")+"|"+game.headers.get("Round","")
            token=sha256((base_id+" "+" ".join(moves[:28])).encode()).hexdigest()
            if token in seen or site in old_sites or token in old_tokens:
                continue
            seen.add(token)
            stats["games"]+=1
            games[token]=event
            trial=game.board()
            overlap=False
            for i,node in enumerate(nodes):
                if i>=26 and board_key(trial) in old_boards:
                    overlap=True
                    break
                trial.push(node.move)
            if overlap:
                stats["previously_reviewed_game"]+=1
                continue
            board=game.board()
            for i,node in enumerate(nodes):
                if node.parent is not None and i>=27 and len(nodes)-i>=4:
                    opponent=not board.turn
                    # An observed capture and later minor-piece move nominate
                    # replay inputs but never determine the reference label.
                    before=node.parent.eval()
                    after=node.eval()
                    cp=None
                    if before is not None and after is not None:
                        a,b=before.pov(board.turn).score(),after.pov(board.turn).score()
                        if a is not None and b is not None:cp=a-b
                    if (cp is None or cp>=48) and board_key(board) not in old_boards:
                        trail=replay(board,moves[i:i+13])
                        if trail:
                            linked=next(candidates(board,trail,True),None)
                            wide=next(candidates(board,trail,False),None) if not linked else None
                            posture=not linked and not wide and any(
                                step.board.turn==board.turn and step.board.piece_type_at(step.move.to_square) in (chess.KNIGHT,chess.BISHOP)
                                and supports(step.board,step.move.to_square,opponent)
                                for step in trail[:-1]
                            )
                            phase="linked-route" if linked else "wider-route" if wide else "outpost-control" if posture else None
                            if phase:
                                id_="exchange-outpost-"+sha256((token+str(i)).encode()).hexdigest()[:16]
                                all_candidates.append(dict(
                                    id=id_,game=token,site=site if site.startswith("https://lichess.org/broadcast/") else metadata[event]["broadcast"],
                                    event=event,fen=board.fen(),playedMoveUci=moves[i],recorded=moves[i:i+13],
                                    phase=phase,annotatedLossCp=cp,ply=i,history={"fen":game.board().fen(),"moves":moves[:i]}))
                board.push(node.move)
def rank(row):
    annotated=row["annotatedLossCp"]
    coarse=0 if annotated is None else min(500,annotated)//50
    return (-coarse, sha256((SEED+row["id"]).encode()).hexdigest())
groups=defaultdict(Counter)
selected=[]
taken=set()
for phase,cap in (("linked-route",75),("wider-route",40),("outpost-control",65)):
    pool=sorted((row for row in all_candidates if row["phase"]==phase),key=rank)
    for _ in range(cap):
        valid=[row for row in pool if row["game"] not in taken]
        if not valid:break
        row=min(valid, key=lambda row:(groups[phase][row["event"]]//4,rank(row)))
        selected.append(row)
        taken.add(row["game"])
        groups[phase][row["event"]]+=1
manifest={"seed":SEED,"sources":{key:metadata[key] for key in sorted({v["event"] for v in selected})},
          "scannedDistinctGames":stats["games"],"rawNominations":Counter(v["phase"] for v in all_candidates),
          "chosen":groups,"annotated":sum(r["annotatedLossCp"] is not None for r in selected)}
for name,value in (("classical-engine-sample.json",selected),("sampling.json",manifest)):
    (OUT/name).write_bytes((json.dumps(value,indent=2)+"\n").encode())
print(len(sources), stats,manifest["rawNominations"],len(selected),Counter(v["phase"] for v in selected),manifest["annotated"],flush=True)
