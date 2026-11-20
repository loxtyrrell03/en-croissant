"""Capture exact engine frames at normal decision budgets."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys

import chess
import chess.engine


def analyse(task):
    row, engine_path, helpers, maximum = task
    sys.path.append(helpers)
    from gather import initial, searched
    board = initial(row)
    recorded = row["gameMoveUci"]
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        for nodes in (600_000, maximum):
            candidates = searched(engine, board, nodes)
            if candidates and (candidates[0]["depth"] >= 18 or candidates[0]["mate"] is not None):
                break
        if not candidates:
            return dict(row, candidates=[], replyProbes=[])
        leader = candidates[0]
        chosen = next((line for line in candidates if line["pvUci"][0] == recorded), None)
        if leader["pvUci"][0] != recorded:
            pair = searched(engine, board, nodes, count=2, fixed=[leader["pvUci"][0], recorded])
            chosen = next((line for line in pair if line["pvUci"][0] == recorded), None)
        else:
            pair = []
        probes=[]
        for entry in (leader, chosen):
            if entry is None or any(probe["moveUci"] == entry["pvUci"][0] for probe in probes):
                continue
            move=entry["pvUci"][0]
            reached=board.copy()
            reached.push_uci(move)
            previous=[]
            for budget in (1_000_000, 4_000_000):
                found = searched(engine, reached, budget)
                if not found:
                    break
                previous = found
                first=found[0]
                if first["depth"] >= 16 and (
                    (entry["cp"] is not None and first["cp"] is not None and abs(entry["cp"] + first["cp"]) <= 90)
                    or (entry["mate"] is not None and first["mate"] is not None and entry["mate"] * first["mate"] < 0)
                ):
                    break
            if previous:
                probes.append(dict(moveUci=move,lines=[dict(line,fen=reached.fen()) for line in previous]))
    probe_nodes = sum(p["lines"][0]["nodes"] for p in probes if p["moveUci"] == recorded
                      and recorded != leader["pvUci"][0])
    return dict(row, candidates=[dict(line,fen=board.fen()) for line in candidates],
                replyProbes=probes, focused=dict(chosen,fen=board.fen()) if chosen else None,
                comparisonCandidates=[dict(line,fen=board.fen()) for line in pair] or None,
                minimumPlayedNodes=probe_nodes+(pair[0]["nodes"] if pair else 0))


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("input","output","engine","helpers"):
        parser.add_argument(name,type=Path)
    parser.add_argument("--max-root-nodes",type=int,default=2_400_000)
    args=parser.parse_args()
    raw=json.loads(args.input.read_bytes())
    jobs=[(item,str(args.engine),str(args.helpers),args.max_root_nodes) for item in raw]
    with ProcessPoolExecutor(max_workers=6) as pool:
        rows=list(pool.map(analyse,jobs))
    with args.output.open("x",encoding="utf-8") as stream:
        json.dump(rows,stream,separators=(",",":"))
    print(len(rows),"scored requests",dict(Counter(row["reference"]["kind"] for row in rows)))
