"""Test the same passed-pawn advance at corresponding defensive checkpoints."""

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path

import chess
import chess.engine

from analyse import PAWN, replay, score
from gather import digest, initial, searched


def mover_square(state, origin):
    return next((square for square, identity in state["where"].items() if identity == origin), None)


def original_is_passed(board, origin, side):
    rank, file = chess.square_rank(origin), chess.square_file(origin)
    return not any(abs(chess.square_file(other) - file) <= 1 and
                   (chess.square_rank(other) > rank if side else chess.square_rank(other) < rank)
                   for other in board.pieces(PAWN, not side))


def common_advance(row, root, origin):
    foe = not root.turn
    worse = [row["rootWorse"], row["replyWorse"],
             [row["played"], *row["prefix"], *row["playedSearch"][0]["pvUci"]]]
    advances = []
    for line in worse:
        trace = replay(root, [], line)["trace"]
        for i in range(max(1, len(row["prefix"]) + 1), min(12, len(trace) - 2)):
            before = trace[i - 1]
            now = trace[i]
            source = mover_square(before, origin)
            if source is None or before["board"].turn != foe or before["board"].piece_type_at(source) != PAWN:
                continue
            move = chess.Move.from_uci(now["move"])
            if (
                move.from_square == source and chess.square_rank(move.to_square) == (6 if foe else 1)
                and now["board"].attackers(foe, move.to_square)
                and mover_square(trace[i + 2], origin) is not None
            ):
                advances.append((move.uci(), i))
                break
    if len(advances) == len(worse) and len(set(advances)) == 1:
        return advances[0]


def nominate(frames, evidence):
    supported = {row["id"] for row in evidence if row.get("tactical")}
    found = []
    for row in frames:
        if row["id"] not in supported:
            continue
        root = initial(row)
        side = not root.turn
        for origin in root.pieces(PAWN, side):
            if not original_is_passed(root, origin, side):
                continue
            proposal = common_advance(row, root, origin)
            if not proposal:
                continue
            uci, prefix_length = proposal
            controls = []
            for path in (row["rootBetter"], row["replyBetter"]):
                if len(path) < prefix_length + 3:
                    break
                control = replay(root, [], path)["trace"][prefix_length - 1]
                board = control["board"]
                move = chess.Move.from_uci(uci)
                if (
                    mover_square(control, origin) != move.from_square or not board.is_legal(move)
                    or control["board"].piece_type_at(move.from_square) != PAWN
                ):
                    break
                natural = replay(root, [], path)["trace"][prefix_length + 2]
                pawn = mover_square(natural, origin)
                if pawn is not None and chess.square_rank(pawn) == (6 if side else 1):
                    break
                controls.append(path[:prefix_length])
            if len(controls) == 2:
                found.append(dict(row, origin=chess.square_name(origin), advance=uci, controlPrefixes=controls))
    return found


def check(task):
    row, executable, nodes = task
    root = initial(row)
    origin = chess.parse_square(row["origin"])
    caps = []
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Hash": 32, "Threads": 1})
        for prefix in row["controlPrefixes"]:
            board = root.copy()
            for uci in [*prefix, row["advance"]]:
                board.push_uci(uci)
            reached = searched(engine, board, nodes)
            if not reached:
                caps.append(dict(prefix=prefix, reachedFen=board.fen(), analysis=[], status="missing-search"))
                continue
            line = reached[0]
            assessed = replay(root, [*prefix, row["advance"]], line["pvUci"])
            capture = assessed["losses"].get(origin)
            valid = False
            if capture is not None and len(prefix) < capture <= len(prefix) + 6:
                steps = assessed["trace"]
                earlier = steps[capture - 2]["balance"]
                window = steps[capture - 1:capture + 2]
                valid = len(window) == 3 and min(step["balance"] for step in window) >= earlier
            holds = (line["depth"] >= 16 and
                     score(line) >= max(row["betterCp"] - 75, row["playedCp"] + 120))
            caps.append(dict(prefix=prefix, reachedFen=board.fen(), analysis=reached,
                             response=assessed["sans"][len(prefix):len(prefix) + 7],
                             status="contains-pawn" if holds and valid else "unresolved"))
    return dict(id=row["id"], site=row.get("site"), fen=row["fen"], origin=row["origin"], advance=row["advance"],
                replies=caps, confirmed=all(item["status"] == "contains-pawn" for item in caps))


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ("frames", "evidence", "engine", "output"):
        cli.add_argument(name, type=Path)
    cli.add_argument("--nodes", type=int, default=2_400_000)
    args = cli.parse_args()
    frames = json.loads(args.frames.read_bytes())["cases"]
    evidence = json.loads(args.evidence.read_bytes())["cases"]
    nominations = nominate(frames, evidence)
    with ProcessPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(check, [(row, str(args.engine), args.nodes) for row in nominations]))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(engineSha256=digest(args.engine), nodesPerSearch=args.nodes, cases=outcomes),
                  stream, indent=2)
    print(len(outcomes), "compared advance(s)", sum(row["confirmed"] for row in outcomes), "confirmed")


if __name__ == "__main__":
    main()
