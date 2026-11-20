"""Recheck the held-out position explanation with fresh, deeper searches."""
import argparse
import json
from pathlib import Path
import sys
import chess

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/paired-choice-training"))
from search_pairs import child, engines, initial, select_lines

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("games", type=Path)
parser.add_argument("engine")
parser.add_argument("out", type=Path)
args = parser.parse_args()
row = next(row for row in json.loads(args.games.read_bytes()) if row["id"] == "13db4156a937c965e470")
board = initial(row)
best, bad, check, capture = "h7g6", row["playedMoveUci"], row["checkingMove"], row["directCapture"]
weaker, stronger = child(board, bad), child(board, best)
try:
    root = select_lines(board, args.engine, 8_000_000, 2, [board.parse_uci(uci) for uci in (best, bad)])
    orders = select_lines(weaker, args.engine, 8_000_000, 2, [weaker.parse_uci(uci) for uci in (check, capture)])
    control = select_lines(stronger, args.engine, 6_000_000, 1, [stronger.parse_uci(check)])
finally:
    for engine in engines:
        engine.quit()
printable = {}
for tag, start, lines in (("root", board, root), ("orders", weaker, orders), ("sameReply", stronger, control)):
    printable[tag] = [{
        "cp": line["cp"],
        "mate": line["mate"],
        "depth": line["depth"],
        "nodes": line["nodes"],
        "pvUci": line["pvUci"][:10],
        "san": start.variation_san([chess.Move.from_uci(uci) for uci in line["pvUci"][:10]]),
    } for line in lines]
document = {"case": row["id"], "site": row["site"], **printable}
with args.out.open("x", encoding="utf8") as output:
    json.dump(document, output, indent=2)
    output.write("\n")
print(json.dumps(document))
