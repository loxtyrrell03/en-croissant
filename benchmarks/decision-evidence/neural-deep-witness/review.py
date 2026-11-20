"""Rerun the deeper witness on a selected set without any model features."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import json

from frames import initial, records, write
from rank import evidence, legal_prefix, DEEP_PLIES
from search import engines, search


def check(original, executable):
    board = initial(original)
    chosen = [board.parse_uci(original[name]) for name in ("candidate", "playedMoveUci")]
    root = search(board, executable, 3_600_000, 2, chosen)["lines"]
    if len(root) < 2 or root[0]["pvUci"][0] != original["candidate"]:
        return dict(id=original["id"], result=None, mechanism="deeper-root-disagreement", root=root)
    deep = dict(root=root)
    display = {}
    for slot, move, row in zip(("better", "played"), chosen, root, strict=True):
        display[slot] = {"move": board.san(move), "rootCp": row["cp"], "rootMate": row["mate"]}
        child = board.copy()
        child.push(move)
        deep[slot] = search(child, executable, 3_600_000, min(2,child.legal_moves.count()))["lines"]
        for mode, packet in (("root",dict(fen=child.fen(), pvUci=row["pvUci"][1:])), ("reply",deep[slot][0])):
            track, _, san = legal_prefix(child, packet, board.turn, DEEP_PLIES)
            display[slot][mode] = dict(line=san, material=track)
    label, mechanism = evidence(board, original, deep, DEEP_PLIES, True)
    return dict(id=original["id"], site=original["site"], fen=original["fen"],
                result=label, mechanism=mechanism, display=display, searches=deep)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("frames", "results", "engine", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--app-additions", action="store_true",
                        help="Use the case IDs added in the committed assessor's deeper replay")
    args = parser.parse_args()
    result = json.loads(args.results.read_bytes())
    if args.app_additions:
        relevant = {identifier for identifier, label in result["cases"].items() if label == "added"}
    else:
        relevant = {identifier for identifier, r in result["caseScores"].items() if r["label"] == 1}
    rows = [r for r in records(args.frames) if r["id"] in relevant]
    try:
        with ThreadPoolExecutor(6) as pool:
            reviewed = list(pool.map(lambda row: check(row, str(args.engine)), rows))
    finally:
        for engine in engines:
            engine.quit()
    write(args.output, reviewed)
    print({r["id"]:r["mechanism"] for r in reviewed}, flush=True)


if __name__ == "__main__":
    main()
