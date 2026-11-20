"""Confirm exact strategic pawn outcomes in a second Stockfish run."""
from collections import Counter
import json
from pathlib import Path
from statistics import median
import sys

import chess
import scan


def read(path):
    return json.loads(Path(path).read_bytes())


def label(line, fen):
    board=chess.Board(fen)
    return board.variation_san(chess.Move.from_uci(uci) for uci in line[:12])


def effects(row, line):
    return scan.observe_pawn_contacts(row["fen"], line, delayed=True)


def same(effect, other):
    return all(effect[k] == other[k] for k in ("move", "target", "file", "side"))


def line_root(row):
    first = row["candidates"][0]
    move = first["pvUci"][0]
    probe = next(item for item in row["replyProbes"] if item["moveUci"] == move)
    reached = [move,*probe["lines"][0]["pvUci"]]
    return first, reached


def alternatives(row):
    first = row["candidates"][0]
    primary = effects(row, first["pvUci"])
    if first["cp"] is None:
        return []
    results=[]
    for alt in row["candidates"][1:]:
        if alt["cp"] is None or not 0 <= first["cp"] - alt["cp"] <= 60:
            continue
        for a in primary:
            for b in effects(row,alt["pvUci"]):
                if min(a["start"],b["start"]) != 1:
                    continue
                shared = a["move"] == b["move"] and a["target"] == b["target"]
                same_file = a["side"] == b["side"] and a["file"] == b["file"]
                if shared == same_file:
                    results.append((first["pvUci"][0],alt["pvUci"][0],a,b))
    return results


def repeated(row):
    first, independent = line_root(row)
    active = chess.Board(row["fen"]).turn
    side = "white" if active else "black"
    comparison=effects(row,independent)
    return [dict(a, repeatedRook=b["rook"]) for a in effects(row,first["pvUci"])
            for b in comparison if a["start"]==b["start"]==1 and a["side"]==side and same(a,b)]


def reference(deep, shallow, output):
    deep_rows = {item["id"]:item for item in read(deep)}
    shallow_rows = {item["id"]:item for item in read(shallow)}
    assert deep_rows.keys() == shallow_rows.keys()
    results=[]
    for key,case in deep_rows.items():
        old = shallow_rows[key]
        first,independent = line_root(case)
        results.append(dict(id=key, event=case["event"],
            retainsFirst=first["pvUci"][0]==old["candidates"][0]["pvUci"][0],
            pairedAlternatives=alternatives(case), repeatedBreak=repeated(case),
            leadingContinuation=label(first["pvUci"],case["fen"]),
            reachedContinuation=label(independent,case["fen"]),
            roots=[(item["pvUci"][0],item["cp"],item["depth"]) for item in case["candidates"]]))
    with Path(output).open("x",encoding="utf-8") as file:
        json.dump(results,file,ensure_ascii=False,indent=2)
    print(len(results),sum(x["retainsFirst"] for x in results),sum(bool(x["pairedAlternatives"]) for x in results),
          sum(bool(x["repeatedBreak"]) for x in results),flush=True)


if __name__=="__main__":
    reference(*sys.argv[1:])
