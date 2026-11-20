"""Assess the same advanced pawn under a different competitive defence."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys

import chess.engine

from mixed_scope import alternative_pawn_capture, screen
from freeze import read, write
from trials import initial, searched


def eligible(variations, original, root, reply, pawn, guard):
    found = []
    leading = variations[0] if variations else None
    if not leading or leading["cp"] is None:
        return []
    for line in variations:
        if (line["cp"] is None or leading["cp"] - line["cp"] > 100
                or not line["pvUci"] or line["pvUci"][0] == reply):
            continue
        if alternative_pawn_capture(original.copy(stack=False), [root, *line["pvUci"]], pawn, guard):
            found.append(line["pvUci"][0])
    return found


def look(pair):
    row, case = pair
    order = case["candidate"]
    original = initial(row)
    after = original.copy(stack=True)
    after.push_uci(order["root"])
    reply = after.parse_uci(order["reply"])
    guard = reply.from_square if reply.to_square == order["guard"] else order["guard"]
    with chess.engine.SimpleEngine.popen_uci(sys.argv[1], timeout=45) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        records = []
        for nodes in (5_400_000, 8_000_000):
            lines = searched(engine, after, nodes, count=5)
            candidates = eligible(lines, original, order["root"], order["reply"], order["target"], guard)
            records.append(dict(nodes=nodes, lines=lines, distinctReplies=candidates))
    first, second = records
    return dict(id=row["id"], site=row.get("site"), candidate=order, searches=records,
                repeated=sorted(set(first["distinctReplies"]) & set(second["distinctReplies"])))


if __name__ == "__main__":
    tasks = []
    for inp, ref in zip(sys.argv[3::2], sys.argv[4::2]):
        frames, truth = read(Path(inp)), read(Path(ref))
        _, passing = screen(frames, truth)
        index = {row["id"]: row for row in frames}
        tasks.extend((index[case["id"]], case) for case in passing)
    with ThreadPoolExecutor(max_workers=5) as pool:
        result = list(pool.map(look, tasks))
    write(Path(sys.argv[2]), result)
    print([(row["id"], row["repeated"]) for row in result], flush=True)
