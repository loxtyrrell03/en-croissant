"""Compare the same requested pawn advance after both defensive moves."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path

import chess

from search_pairs import HERE, engines, reached, relative_rank, search, trace


PROTOCOL = json.loads((HERE / "forced-push-protocol.json").read_text(encoding="utf-8"))


def on_reached_boards(row):
    if not row["opponentPawn"] or row["status"] != "paired":
        return None
    board = reached(row)
    pawn = chess.parse_square(row["pawn"])
    color = board.color_at(pawn)
    if relative_rank(pawn, color) != 5:
        return None
    push = chess.Move(pawn, pawn + (8 if color else -8))
    branches = []
    for arm in row["arms"]:
        child = board.copy()
        child.push_uci(arm["move"])
        if not child.is_legal(push):
            return None
        branches.append((arm["move"], child))
    return pawn, push, branches


def outcome(child, pawn, push, unrestricted, restricted):
    if not unrestricted or not restricted:
        return {"regretCp": None, "trace": None, "outcome": None}
    if any(line["fen"] != child.fen() for line in (unrestricted, restricted)):
        raise ValueError("Search did not use the exact candidate board")
    if restricted["pvUci"][0] != push.uci():
        raise ValueError("Search did not use the restricted pawn push")
    loss = None
    result = None
    recorded = trace(child, pawn, restricted["pvUci"])
    if unrestricted["cp"] is not None and restricted["cp"] is not None:
        loss = unrestricted["cp"] - restricted["cp"]
        capture = recorded["capturePly"]
        survival = PROTOCOL["viableThroughPlies"]
        if (
            loss <= PROTOCOL["maxViableRegretCp"] and len(recorded["line"]) >= survival
            and (capture is None or capture > survival)
        ):
            result = "viable"
        if loss >= PROTOCOL["minRefutedRegretCp"] and capture is not None and capture <= PROTOCOL["refutedWithinPlies"]:
            result = "refuted"
    return {"regretCp": loss, "trace": recorded, "outcome": result}


def compare(context, engine, mode):
    pawn, push, branches = context
    nodes = PROTOCOL["firstNodes"] if mode == "first" else PROTOCOL["repeatNodes"]
    assessed = []
    for move, board in branches:
        best = search(board, engine, nodes, 1)
        if mode == "matched":
            # Compare the two scores at the same completed search depth.
            lead = next(iter(best["lines"]), None)
            allowed = [push]
            if lead and lead["pvUci"][0] != push.uci():
                allowed.append(board.parse_uci(lead["pvUci"][0]))
            matching = search(board, engine, nodes, len(allowed), allowed)
            best_line = next(iter(matching["lines"]), None)
            forced_line = next((line for line in matching["lines"] if line["pvUci"][0] == push.uci()), None)
            if len(matching["lines"]) != len(allowed):
                best_line = forced_line = None
            finding = outcome(board, pawn, push, best_line, forced_line)
            assessed.append(dict(finding, defensiveMove=move, discovery=best, matched=matching))
            continue
        forced = search(board, engine, nodes, 1, [push])
        best_line = next(iter(best["lines"]), None)
        forced_line = next(iter(forced["lines"]), None)
        finding = outcome(board, pawn, push, best_line, forced_line)
        assessed.append(dict(finding, defensiveMove=move, best=best, forced=forced))
    outcomes = [arm["outcome"] for arm in assessed]
    direction = outcomes.index("viable") if set(outcomes) == {"viable", "refuted"} else None
    return {"push": push.uci(), "arms": assessed, "viableBranch": direction}


def run(rows, pool, engine, mode):
    pref = [(row, ctx) for row in rows
            if mode == "first" or row["first"]["viableBranch"] is not None
            if (ctx := on_reached_boards(row)) is not None]
    result = list(pool.map(
        lambda item: dict(item[0], **{mode: compare(item[1], engine, mode)}), pref,
    ))
    directions = Counter(row[mode]["viableBranch"] for row in result)
    print(len(result), "compared", directions, flush=True)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("mode", choices=("first", "repeat", "matched"))
    for name in ("input", "engine", "output"):
        p.add_argument(name, type=Path)
    args = p.parse_args()
    data = args.input.read_bytes()
    try:
        with ThreadPoolExecutor(7) as pool:
            output = {
                split: run(rows, pool, str(args.engine), args.mode)
                for split, rows in json.loads(data).items()
            }
    finally:
        for engine in engines:
            engine.quit()
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(output, stream, separators=(",", ":"))
        stream.write("\n")
    print({"inputSha256": sha256(data).hexdigest(), "engineSha256": sha256(args.engine.read_bytes()).hexdigest()})


if __name__ == "__main__":
    main()
