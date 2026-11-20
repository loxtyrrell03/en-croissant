"""Find the checking-capture shape from existing app frames alone."""

import argparse
from collections import Counter
import json
from pathlib import Path

import chess

from assess import NEAR, assess, initial, reaches
from freeze import digest, pawn_captures, quiet_check, write


def screen(row):
    board = initial(row)
    roots = {line["pvUci"][0]: line for line in row["candidates"]}
    if not roots:
        return []
    first = row["candidates"][0]
    candidates = []
    for uci, line in roots.items():
        if (first["cp"] is None or line["cp"] is None or first["cp"] - line["cp"] > NEAR
                or not quiet_check(board, chess.Move.from_uci(uci))):
            continue
        for pawn in pawn_captures(board):
            if not reaches(board, line["pvUci"], pawn.to_square):
                continue
            direct = pawn.uci()
            pair = [uci, direct]
            item = dict(pair=pair, targeted=False, lines=[line, roots[direct]]) if direct in roots else None
            if item is None:
                candidates.append(dict(pair=pair, status="root search missing"))
            else:
                candidates.extend(assess(dict(row, pairFrames=[item]), settle=True))
    return candidates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("frames", nargs="+", type=Path)
    args = parser.parse_args()
    report = []
    for path in args.frames:
        rows = json.loads(path.read_bytes())
        matches = [{key: row[key] for key in ("id", "fen")} | {"pairs": pairs}
                   for row in rows if (pairs := screen(row))]
        counts = Counter(pair["status"] for row in matches for pair in row["pairs"])
        report.append(dict(source=path.name, sha256=digest(path.read_bytes()), decisions=len(rows),
                           eligible=len(matches), pairStatuses=dict(counts), matches=matches))
    write(args.output, report)


if __name__ == "__main__":
    main()
