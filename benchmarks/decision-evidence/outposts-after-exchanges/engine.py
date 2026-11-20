
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import importlib.util
import json
import sys
import threading
import time

import chess, chess.engine

ROOT_NODES = 600_000
PAIR_NODES = 1_200_000
REPLY_NODES = 900_000

lab=Path(sys.argv[1])
engine_path=sys.argv[2]
prefix = sys.argv[3] if len(sys.argv) > 3 else ""
engine_cache=threading.local()
engines=[]
samples=json.loads((lab/(prefix+"engine-sample.json")).read_bytes())
module_path=Path.cwd()/"scripts/benchmarks/decision-evidence-engine.py"
spec=importlib.util.spec_from_file_location("engine_capture",module_path)
shared=importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def search(board, budget, count=3, moves=None):
    if not hasattr(engine_cache,"engine"):
        engine=chess.engine.SimpleEngine.popen_uci(engine_path)
        engine.configure({"Threads":1,"Hash":48})
        engine_cache.engine=engine
        engines.append(engine)
    count = min(count, len(moves) if moves is not None else board.legal_moves.count())
    complete = shared.CompleteVariations(board, count, moves)
    with engine_cache.engine.analysis(
        board, chess.engine.Limit(nodes=budget), multipv=count, root_moves=moves, game=object(),
    ) as stream:
        for info in stream:
            complete.add(info)
    if not complete.best:
        raise ValueError("No exact completed iteration")
    return [{
        "fen":board.fen(), "cp":x["score"].relative.score(), "mate":x["score"].relative.mate(),
        "depth":x["depth"],"pvUci":[m.uci() for m in x["pv"]],
    } for x in complete.best]


def evaluate(row):
    b=chess.Board(row["fen"])
    root=search(b,ROOT_NODES)
    played=b.parse_uci(row["playedMoveUci"])
    leader=b.parse_uci(root[0]["pvUci"][0])
    if leader==played:
        return {**row,"candidates":root,"skipped":"played-leads-preview"}
    pair=search(b,PAIR_NODES,2,[leader,played])
    best, actual=pair
    if best["pvUci"][0]==played.uci() or not all(l["cp"] is not None for l in pair) or best["cp"]-actual["cp"]<60:
        return {**row,"candidates":root,"comparisonCandidates":pair,"skipped":"no-60cp-loss"}
    probes=[]
    for line in pair:
        move=line["pvUci"][0]
        child=b.copy(stack=False)
        child.push_uci(move)
        if not child.is_game_over():
            probes.append({"moveUci":move, "lines":search(child,REPLY_NODES)})
    return {**row,"candidates":root,"comparisonCandidates":pair,"replyProbes":probes}


start=time.monotonic()
out=lab/(prefix+"reserve-frames.jsonl")
try:
    with out.open("x",encoding="utf-8") as file:
        with ThreadPoolExecutor(5) as pool:
            for i,row in enumerate(pool.map(evaluate, samples),1):
                file.write(json.dumps(row,separators=(",",":"))+"\n")
                file.flush()
                if i%10==0:
                    print(i,round(time.monotonic()-start,1),flush=True)
finally:
    for engine in engines:
        engine.quit()
meta={"engineSha256":hashlib.sha256(Path(engine_path).read_bytes()).hexdigest(),
      "threadsPerEngine":1,"hashMiB":48,"rootNodes":ROOT_NODES,"pairNodes":PAIR_NODES,"replyNodes":REPLY_NODES,
      "samples":len(samples),"wallSeconds":round(time.monotonic()-start,1),
      "sha256":hashlib.sha256(out.read_bytes()).hexdigest()}
(lab/(prefix+"engine-receipt.json")).write_text(json.dumps(meta,indent=2),encoding="utf-8")
print(meta)
