"""Compare locally measured and settled recovery on matched searches."""
from collections import Counter
import json
from pathlib import Path
import sys

import chess

sys.path.insert(0, str(Path("benchmarks/decision-evidence/compared-exchange-outcomes").resolve()))
from screen import sequence, VALUES


def search_frame(row):
    pair = row.get("comparisonCandidates") or row["candidates"]
    if len(pair) < 2 or pair[0]["pvUci"][0] != row["candidates"][0]["pvUci"][0]:
        return None
    first = pair[0]
    played = next((line for line in pair[1:] if line["pvUci"][0] == row["playedMoveUci"]), None)
    if not played or first["depth"] != played["depth"] or first["depth"] < 16:
        return None
    if any(line["cp"] is None or line.get("mate") is not None for line in (first, played)):
        return None
    if first["cp"] - played["cp"] < 100:
        return None
    replies = []
    for line in (first, played):
        child = chess.Board(row["fen"])
        child.push_uci(line["pvUci"][0])
        probe = next((p["lines"][0] for p in row.get("replyProbes", [])
                      if p["moveUci"] == line["pvUci"][0] and p["lines"]), None)
        if (not probe or probe["depth"] < 16 or probe["cp"] is None or probe.get("mate") is not None
                or abs(line["cp"] + probe["cp"]) > 90 or child.fen() != chess.Board(probe["fen"]).fen()):
            return None
        replies.append(probe)
    return first, played, *replies


def aligned(root, lines):
    good, independent, bad, checked = lines
    if min(map(len, lines)) < 7:
        return None
    reply = good[1]
    if reply.capture is None or any(
        line[1].move != reply.move or line[1].capture != reply.capture for line in lines[1:]
    ):
        return None
    resource = good[2].move
    if independent[2].move != resource:
        return None
    weaker = root.copy(stack=False)
    weaker.push(bad[0].move)
    weaker.push(bad[1].move)
    if resource in weaker.legal_moves:
        return None
    return reply, good[2]


def proof(root, lines):
    anchor = aligned(root, lines)
    if not anchor:
        return {}
    reply, recovery = anchor
    strong, weak = lines[:2], lines[2:]
    last = min(map(len, lines))
    receipts = {}
    earlier = [
        {step.capture: ply for ply, step in enumerate(line[:9], 1)
         if ply >= 3 and ply % 2 == 1 and step.capture is not None}
        for line in strong
    ]
    survivors = earlier[0].keys() & earlier[1].keys() & weak[0][last - 1].present & weak[1][last - 1].present
    for victim in sorted(survivors, key=lambda sq: (-VALUES[root.piece_type_at(sq)], sq)):
        point = max(earlier[0][victim], earlier[1][victim]) + 1
        if point > last:
            continue
        margin = min(line[point - 1].material for line in strong) - max(line[point - 1].material for line in weak)
        if margin < 100 or any(line[point - 1].material - min(step.material for step in line[1:point]) < 90
                               for line in strong):
            continue
        receipts["local-recovery"] = {
            "commonReply": reply.san, "commonVictim": chess.square_name(reply.capture),
            "recovery": recovery.san, "recoveredVictim": chess.square_name(victim),
            "horizon": point, "materialMargin": margin,
            "lines": [[step.san for step in line[:point]] for line in lines],
        }
        break
    for horizon in range(7, last + 1):
        good_value = min(line[horizon-1].material for line in strong)
        bad_value = max(line[horizon-1].material for line in weak)
        if good_value - bad_value < 100:
            continue
        if min(line[last-1].material for line in strong) <= max(line[last-1].material for line in weak):
            continue
        if any(line[horizon-1].material - min(step.material for step in line[1:horizon]) < 90
               for line in strong):
            continue
        captured = [{step.capture for step in line[2:min(horizon-2, 9):2] if step.capture is not None}
                    for line in strong]
        recovered = captured[0].intersection(captured[1], *(line[last-1].present for line in weak))
        if not recovered:
            continue
        survivor = max(recovered, key=lambda sq: (VALUES[root.piece_type_at(sq)], -sq))
        if not all(all(step.capture is None and not step.move.promotion
                       for step in line[horizon-2:horizon]) for line in lines):
            continue
        evidence = {
            "commonReply": reply.san, "commonVictim": chess.square_name(reply.capture),
            "recovery": recovery.san, "recoveredVictim": chess.square_name(survivor),
            "horizon": horizon, "materialMargin": good_value - bad_value,
            "lines": [[step.san for step in line[:horizon]] for line in lines],
        }
        receipts.setdefault("material-settled", evidence)
        if all(all(step.quiet for step in line[horizon-2:horizon]) for line in lines):
            receipts.setdefault("quiet-settled", evidence)
    return receipts


def inspect(row):
    frame = search_frame(row)
    if not frame:
        return {}
    better, played, reply_after_better, reply_after_played = frame
    root = chess.Board(row["fen"])
    try:
        lines = [sequence(root, pv, 17) for pv in (
            better["pvUci"], [better["pvUci"][0], *reply_after_better["pvUci"]],
            played["pvUci"], [played["pvUci"][0], *reply_after_played["pvUci"]],
        )]
    except (ValueError, KeyError):
        return {}
    return proof(root, lines)


if __name__ == "__main__":
    paths = list(map(Path, sys.argv[1:]))
    results = []
    for path in paths[:-1]:
        data = json.loads(path.read_bytes())
        items = [dict(id=row["id"], evidence=inspect(row)) for row in data if row.get("playedMoveUci")]
        print(path.name, len(items), Counter(arm for r in items for arm in r["evidence"]))
        results.extend(items)
    with paths[-1].open("x", encoding="utf8") as out:
        json.dump(results, out, indent=2)
