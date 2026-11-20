"""Freeze two game-disjoint groups and score each exact puzzle move and its replies."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.engine

from scan import qualify, read


def prepare(rows, prior, limit, group):
    known = {x["game"] for x in prior}
    keys = {board_key(x) for x in prior}
    counts = Counter()
    order = sorted(rows, key=lambda row: (
        row["split"] == "train" if group == "heldout" else row["split"] != "train",
        sha256(f"interference-v1:{group}:{row['id']}".encode()).digest(),
    ))
    for row in order:
        key = board_key(row)
        if row["game"] in known or key in keys or counts[row["caseKind"]] >= limit:
            continue
        known.add(row["game"])
        keys.add(key)
        counts[row["caseKind"]] += 1
        yield row


def board_key(row):
    board = chess.Board(row["fen"])
    return min(board.epd(),board.mirror().epd())


def evaluate(task):
    row, engine_exe, helpers, nodes = task
    sys.path.append(helpers)
    from gather import initial, searched
    root = initial(row)
    expected = row["line"][0]
    with chess.engine.SimpleEngine.popen_uci(engine_exe) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        normal = searched(engine, root, nodes) if row.get("history") else None
        lines = [dict(x, fen=root.fen()) for x in searched(engine, root, nodes, fixed=[expected])]
        position = root.copy()
        position.push_uci(expected)
        replies = [dict(line, fen=position.fen()) for line in searched(engine, position,nodes * 2)]
    combined = [[expected,*line["pvUci"]] for line in replies[:1]]
    reference = [qualify(root, line) for line in [*[line["pvUci"] for line in lines],*combined]]
    result = dict(
        row, candidates=lines, replyProbes=[dict(moveUci=expected, lines=replies)], reference=reference,
    )
    if normal is not None:
        result["normalCandidates"] = normal
    return result


def write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, separators=(",",":"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode",required=True)
    f = sub.add_parser("freeze")
    for key in ("geometry","development","heldout"):
        f.add_argument(key,type=Path)
    f.add_argument("--exclude",type=Path,nargs="*",default=[])
    s = sub.add_parser("search")
    for key in ("input","output","engine","helpers"):
        s.add_argument(key,type=Path)
    s.add_argument("--nodes", type=int,default=2_400_000)
    args=parser.parse_args()
    if args.mode=="freeze":
        raw=read(args.geometry)
        excluded=[row for path in args.exclude for row in read(path)]
        development=list(prepare(raw,excluded,12,"development"))
        heldout=list(prepare(raw,[*excluded,*development],22,"heldout"))
        write(args.development,development)
        write(args.heldout,heldout)
        print(len(development),len(heldout),"frozen roots")
    else:
        raw=read(args.input)
        jobs=[(row,str(args.engine),str(args.helpers),args.nodes) for row in raw]
        with ProcessPoolExecutor(max_workers=5) as pool:
            result=list(pool.map(evaluate,jobs))
        write(args.output,result)
        print(len(result),"scored roots")


if __name__=="__main__":
    main()
