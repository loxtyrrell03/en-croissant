"""Test the timing of a concrete strategic option against its legal alternatives."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys
from time import perf_counter

import chess
import chess.engine

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "settled-exchange-plans"))
from examine import exact, passed, relative_rank, traced

sys.path.insert(0, str(HERE.parent / "reply-search-allocation"))
from search import engine, engine_frames, engines


def strategy(board, move):
    """Identify the exact family of quiet moves removed by the counterfactual."""
    if board.is_check() or board.is_capture(move) or move.promotion or board.gives_check(move):
        return None
    square = move.to_square
    file = chess.square_file(square)
    side = board.turn
    role = board.piece_type_at(move.from_square)
    rank = 1 + relative_rank(square, side)
    if role == chess.PAWN and 5 <= rank <= 7 and passed(board, move.from_square, side):
        return ("passer", move.from_square)
    if role == chess.ROOK and (
        chess.square_file(move.from_square) != file or 1 + relative_rank(move.from_square, side) < rank
    ):
        if not board.pieces_mask(chess.PAWN, side) & chess.BB_FILES[file] and rank >= 6:
            return ("rook-file", file)
    if role == chess.KNIGHT and 5 <= rank <= 7:
        pals = board.attackers(side, square) & board.pieces(chess.PAWN, side)
        challengers = board.pieces(chess.PAWN, not side)
        if pals and not any(
            abs(chess.square_file(pawn) - file) == 1
            and 1 + relative_rank(pawn, side) > rank
            for pawn in challengers
        ):
            return ("outpost", square)
    return None


def stays_on_task(board, moves, kind, plies=4):
    try:
        trace = traced(board, moves[:plies + 2])
    except ValueError:
        return False
    if len(trace) < plies + 2 or trace[0].actor not in trace[0].identities.values():
        return False
    if any(abs(item.balance) > 50 for item in trace[plies - 1:]):
        return False
    origin = trace[0].actor
    target = trace[0].move.to_square
    side = board.turn
    for step in trace[:plies + 1]:
        locations = [square for square, identity in step.identities.items() if identity == origin]
        if len(locations) != 1:
            return False
        square = locations[0]
        if kind == "outpost" and square != target:
            return False
        if kind == "rook-file" and not (
            chess.square_file(square) == chess.square_file(target)
            and not step.board.pieces_mask(chess.PAWN, side) & chess.BB_FILES[chess.square_file(square)]
        ):
            return False
        if kind == "passer" and not (
            step.board.piece_type_at(square) == chess.PAWN and passed(step.board, square, side)
        ):
            return False
    return True


def deferred_plan(board, primary, alternative, key):
    """Find the same originating piece carrying out the plan in the other line."""
    original = board.parse_uci(primary).from_square
    try:
        trace = traced(board, alternative[:10])
    except ValueError:
        return
    position = board
    for index, step in enumerate(trace[:7]):
        if index and step.actor == original and strategy(position, step.move) == key:
            return {
                "ply": index + 1, "move": step.uci,
                "retained": stays_on_task(position, alternative[index:], key[0]),
            }
        position = step.board


def initial(row):
    history = row.get("history")
    board = chess.Board(history["fen"] if history else row["fen"])
    if history:
        for move in history["moves"]:
            board.push_uci(move)
    if board.fen() != row["fen"]:
        raise ValueError(f"History mismatch for {row['id']}")
    return board


def screen(row):
    """Use the legal principal continuation to nominate at most one checkpoint."""
    roots = row.get("candidates") or []
    if not roots or roots[0]["cp"] is None or abs(roots[0]["cp"]) > 350:
        return
    line = roots[0]
    board = initial(row)
    if not exact(line, board):
        return
    side = board.turn
    for index, uci in enumerate(line["pvUci"][:5]):
        if board.is_game_over(claim_draw=True):
            return
        move = board.parse_uci(uci)
        key = strategy(board, move) if board.turn == side else None
        if key:
            trace = traced(initial(row), line["pvUci"][:index])
            # The line can open with exchanges, but the earlier moves cannot
            # already have decided the position by net material gain.
            if index and (len(trace) != index or abs(trace[-1].balance) > 50):
                return
            return {
                "id": row["id"], "fen": row["fen"], "history": row.get("history"),
                "event": row.get("event"), "site": row.get("site"),
                "label": row.get("label"), "cohort": row["cohort"],
                "prefix": line["pvUci"][:index], "originalMove": uci,
                "kind": key[0], "squareOrFile": key[1],
                "previewPersistence": stays_on_task(board, line["pvUci"][index:], key[0]),
            }
        board.push(move)


def fixed(board, exe, depth, cap, allowed=None, ranks=1):
    start = perf_counter()
    exact_frame = engine_frames.CompleteVariations(board, ranks, allowed)
    max_nodes = 0
    with engine(exe).analysis(
        board, chess.engine.Limit(depth=depth, nodes=cap),
        root_moves=allowed, multipv=ranks, game=object(), info=chess.engine.INFO_ALL,
    ) as run:
        for info in run:
            max_nodes = max(max_nodes, info.get("nodes", 0))
            exact_frame.add(info)
    complete = exact_frame.best or []
    return {
        "maxNodes": max_nodes,
        "ms": round(1000 * (perf_counter() - start), 2),
        "lines": [{
            "move": found["pv"][0].uci(), "pv": [m.uci() for m in found["pv"]],
            "cp": found["score"].relative.score(), "mate": found["score"].relative.mate(),
        } for found in complete if found["depth"] == depth],
    }


def compare(row, exe, depth, cap):
    board = initial(row)
    for move in row["prefix"]:
        board.push_uci(move)
        if board.is_game_over(claim_draw=True):
            return dict(row, status="draw-or-game-over")
    key = row["kind"], row["squareOrFile"]
    without = [move for move in board.legal_moves if strategy(board, move) != key]
    if not without:
        return dict(row, status="no-legal-alternative")
    broad = fixed(board, exe, depth, cap)
    result = dict(row, checkpoint=board.fen(), broad=broad, alternativeCount=len(without))
    line = next(iter(broad["lines"]), None)
    if not line:
        return dict(result, status="incomplete-broad")
    if strategy(board, board.parse_uci(line["move"])) != key:
        return dict(result, status="plan-does-not-lead")
    alternate = fixed(board, exe, depth, cap, allowed=without)
    result["alternate"] = alternate
    reply = next(iter(alternate["lines"]), None)
    if not reply:
        return dict(result, status="incomplete-alternate")
    options = [board.parse_uci(item["move"]) for item in (line, reply)]
    joint = fixed(board, exe, depth, cap, allowed=options, ranks=2)
    result["matched"] = joint
    by_move = {item["move"]: item for item in joint["lines"]}
    if not all(move.uci() in by_move for move in options):
        return dict(result, status="incomplete-matched")
    line, reply = [by_move[move.uci()] for move in options]
    if line["cp"] is None or reply["cp"] is None:
        return dict(result, status="mate-score")
    assert board.parse_uci(reply["move"]) in without
    result["gapCp"] = line["cp"] - reply["cp"]
    if result["gapCp"] < 55:
        return dict(result, status="close-alternative")
    if not stays_on_task(board, line["pv"], key[0]):
        return dict(result, status="plan-does-not-persist")
    try:
        tail = traced(board, reply["pv"][:6])
    except ValueError:
        tail = []
    if len(tail) < 6 or any(abs(item.balance) > 50 for item in tail[3:]):
        return dict(result, status="different-material")
    return dict(result, status="nominated")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    template = sub.add_parser("screen")
    template.add_argument("input", type=Path)
    template.add_argument("output", type=Path)
    run = sub.add_parser("compare")
    run.add_argument("input", type=Path)
    run.add_argument("output", type=Path)
    run.add_argument("engine", type=Path)
    run.add_argument("depth", type=int)
    run.add_argument("cap", type=int)
    args = parser.parse_args()
    raw = args.input.read_bytes()
    rows = json.loads(raw)
    if args.command == "screen":
        result = [hit for row in rows if (hit := screen(row))]
        print(Counter((row["cohort"], row["kind"]) for row in result), flush=True)
        with args.output.open("x", encoding="utf-8") as out:
            json.dump(result, out, separators=(",", ":"))
        return
    try:
        with args.output.open("x", encoding="utf-8") as out, ThreadPoolExecutor(6) as pool:
            counts = Counter()
            for count, item in enumerate(pool.map(
                lambda row: compare(row, str(args.engine), args.depth, args.cap), rows
            ), 1):
                counts[item["status"]] += 1
                out.write(json.dumps(item, separators=(",", ":")) + "\n")
                out.flush()
                if count % 50 == 0:
                    print(count, counts, flush=True)
    finally:
        for worker in engines:
            worker.quit()
    print(sha256(raw).hexdigest(), len(rows), counts, flush=True)


if __name__ == "__main__":
    main()
