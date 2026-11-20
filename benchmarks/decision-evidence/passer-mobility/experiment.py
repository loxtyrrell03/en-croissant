"""Probe whether the same original passed pawn has a viable advance."""

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
from statistics import median
import sys
from time import perf_counter

import chess
import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "defence-after-attack"))
from analyse import points, score
from gather import comparison, digest, group, initial, read, searched, track_move

HORIZON = 16
ARMS = ("natural", "counterfactual", "persistent", "prepared")


def progress(square, side):
    return chess.square_rank(square) if side else 7 - chess.square_rank(square)


def passed(board, square, side):
    return all(
        abs(chess.square_file(square) - chess.square_file(other)) > 1
        or progress(other, side) <= progress(square, side)
        for other in board.pieces(chess.PAWN, not side)
    )


def board_key(row):
    board = chess.Board(row["fen"])
    return min(board.epd(), board.mirror().epd())


def positions(board, moves, limit=HORIZON):
    board = board.copy()
    current = {square: square for square in board.piece_map()}
    yield board.copy(), current.copy(), None
    for uci in moves[:limit]:
        if board.halfmove_clock >= 100 or board.is_repetition(3) or board.is_game_over():
            break
        move = board.parse_uci(uci)
        captured = track_move(board, move, current)
        board.push(move)
        yield board.copy(), current.copy(), captured


def square_of(identities, origin):
    return next((square for square, identity in identities.items() if identity == origin), None)


def advanced_options(trace, moves, pawn, defender, required_rank):
    choices = []
    for ply, (board, identities, _) in enumerate(trace[1:], 1):
        if board.turn == defender or board.is_game_over():
            continue
        source = square_of(identities, pawn)
        if source is None or board.piece_at(source) != chess.Piece(chess.PAWN, board.turn):
            continue
        to = source + (8 if board.turn else -8)
        if not 0 <= to < 64 or progress(to, board.turn) != required_rank:
            continue
        advance = chess.Move(source, to)
        if not board.is_legal(advance) or not passed(board, source, board.turn):
            continue
        # A protected or checking advance can create a credible threat.
        # Subsequent economic safety and evaluation are assessed by the engine.
        guarded = bool(board.attackers(board.turn, to)) or board.gives_check(advance)
        if not guarded or points(board, defender) < points(trace[0][0], defender) - 100:
            continue
        choices.append((ply, advance.uci(), ply < len(moves) and moves[ply] == advance.uci()))
    return choices


def economical_removal(trace, pawn, defender, max_ply, min_ply=1):
    for ply, (_, _, captured) in enumerate(trace[1:], 1):
        if min_ply <= ply <= max_ply and captured == pawn and len(trace) > ply + 2:
            baseline = points(trace[ply - 1][0], defender)
            return min(points(board, defender) for board, _, _ in trace[ply:ply + 3]) >= baseline
    return False


def controls(trace, line, pawn, defender, ply, advance):
    end = min(ply + 3, len(trace) - 3)
    if economical_removal(trace, pawn, defender, end):
        return {"kind": "already-contained"}
    if ply >= len(trace) or trace[ply][0].turn == defender:
        return
    board, identities, _ = trace[ply]
    attempt = chess.Move.from_uci(advance)
    if identities.get(attempt.from_square) == pawn and board.is_legal(attempt):
        return {"kind": "test", "prefix": line[:ply], "advance": advance, "fen": board.fen()}


def nominate(row, target_rank=7, horizon=HORIZON):
    frames = comparison(row)
    if not frames:
        return "unstable", None
    best, played, better_reply, played_reply = frames
    game = initial(row)
    defender = game.turn
    attack = not defender
    pawns = [square for square in game.pieces(chess.PAWN, attack)
             if progress(square, attack) >= 4 and passed(game, square, attack)]
    if not pawns:
        return "no-advanced-passer", None
    good = [best["pvUci"], [best["pvUci"][0], *better_reply["pvUci"]]]
    weak = [played["pvUci"], [played["pvUci"][0], *played_reply["pvUci"]]]
    above, below = [[list(positions(game, line, horizon)) for line in pair] for pair in (good, weak)]
    for pawn in pawns:
        options = [
            advanced_options(trace, line, pawn, defender, target_rank - 1)
            for trace, line in zip(below, weak)
        ]
        if not all(options):
            continue
        available = set.intersection(*(set(move for _, move, _ in entries) for entries in options))
        for advance in sorted(available):
            selected = [
                min((i for i in entries if i[1] == advance), key=lambda i: (not i[2], i[0]))
                for entries in options
            ]
            if not any(natural for _, _, natural in selected):
                continue
            guard = [controls(trace, line, pawn, defender, when, advance)
                     for trace, line, (when, _, _) in zip(above, good, selected)]
            if not all(guard):
                continue
            # A normal principal line where the same advance succeeds after
            # the better choice is a competing explanation, not a duplicate.
            if any(
                any(move == advance and natural for _, move, natural
                    in advanced_options(trace, line, pawn, defender, target_rank - 1))
                and control["kind"] == "test"
                for trace, line, control in zip(above, good, guard)
            ):
                continue
            trials = [dict(kind="test", prefix=line[:when], advance=advance,
                           fen=trace[when][0].fen(), natural=natural)
                      for trace, line, (when, _, natural) in zip(below, weak, selected)]
            return "nominated", dict(
                id=row["id"], game=group(row), event=row.get("event"), site=row.get("site"),
                fen=row["fen"], history=row.get("history"), pawn=chess.square_name(pawn),
                better=best["pvUci"][0], played=played["pvUci"][0], bestCp=best["cp"], playedCp=played["cp"],
                tests=trials, controls=guard, goodLines=good, playedLines=weak,
            )
    return "no-matched-advance", None


def check_frame(engine, root, trial, nodes):
    current = root.copy()
    for move in trial["prefix"]:
        current.push_uci(move)
    if current.fen() != trial["fen"]:
        raise ValueError("The reached board is different from the frozen checkpoint")
    san = current.san(chess.Move.from_uci(trial["advance"]))
    current.push_uci(trial["advance"])
    if current.can_claim_draw():
        return {"status": "draw-claim", "san": san}
    results = searched(engine, current, nodes)
    return {"status": "checked" if results else "missing", "san": san, "reached": current.fen(),
            "line": results[0] if results else None}


def verify_work(args):
    row, path, nodes = args
    root = initial(row)
    made = {}
    start = perf_counter()
    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        engine.configure({"Hash": 32, "Threads": 1})
        for t in [*row["tests"], *row["controls"]]:
            if t["kind"] != "test":
                continue
            key = tuple(t["prefix"]), t["advance"]
            if key not in made:
                made[key] = check_frame(engine, root, t, nodes)
    lookup = lambda t: made[(tuple(t["prefix"]), t["advance"])] if t["kind"] == "test" else None
    tests = [lookup(t) for t in row["tests"]]
    controls = [lookup(t) for t in row["controls"]]
    return dict(row, testResults=tests, controlResults=controls, queries=len(made),
                milliseconds=(perf_counter() - start) * 1000)


def stays_dangerous(root, trial, line, origin, defender, require_pawn=False):
    # Include two replies by the defender. A pawn taken immediately can
    # still impose a concrete material payment, if the exchange settles.
    movelist = [*trial["prefix"], trial["advance"], *line["pvUci"]]
    cut = len(trial["prefix"]) + 1
    trace = list(positions(root, movelist, cut + 7))
    if len(trace) <= cut + 3:
        return False
    if economical_removal(trace, origin, defender, cut + 5, cut + 1):
        return False
    reached, pieces, _ = trace[cut + 3]
    square = square_of(pieces, origin)
    if require_pawn:
        return square is not None and reached.piece_at(square) == chess.Piece(chess.PAWN, not defender)
    if square is not None:
        return True
    base = points(trace[cut][0], defender)
    return len(trace) > cut + 5 and max(
        points(board, defender) for board, _, _ in trace[cut + 4:cut + 6]
    ) < base - 65


def sustained_before_advance(root, row, origin):
    # The passer may promote or force a sacrifice immediately after the
    # advance. Check whether it was a sustained difference before that
    # tactical conversion instead.
    for trial, other, strong_line in zip(row["tests"], row["controls"], row["goodLines"]):
        ply = len(trial["prefix"])
        if not trial["natural"] or other["kind"] != "already-contained" or ply < 5:
            return False
        weak = list(positions(root, trial["prefix"], ply))
        source = chess.Move.from_uci(trial["advance"]).from_square
        pawn = chess.Piece(chess.PAWN, not root.turn)
        if len(weak) != ply + 1 or not all(
                   ids.get(source) == origin and board.piece_at(source) == pawn and passed(board, source, pawn.color)
                   for board, ids, _ in weak[ply - 4:]):
            return False
        stronger = list(positions(root, strong_line, ply))
        if not economical_removal(stronger, origin, root.turn, ply - 4):
            return False
    return True


def decision(row, arm):
    root = initial(row)
    origin = chess.parse_square(row["pawn"])
    if arm == "natural":
        if not all(t["natural"] for t in row["tests"]) or any(t is not None for t in row["controlResults"]):
            return "needs-counterfactual"
        for trial, seq in zip(row["tests"], row["playedLines"]):
            if not stays_dangerous(root, trial, {"pvUci": seq[len(trial["prefix"]) + 1:]}, origin, root.turn):
                return "weak-advance-contained"
        return "supported"
    for request, returned in ((row["tests"], row["testResults"]), (row["controls"], row["controlResults"])):
        for trial, result in zip(request, returned, strict=True):
            if trial["kind"] == "already-contained":
                continue
            if not result or not result.get("line") or result["line"]["depth"] < 16:
                return "incomplete"
            reached = list(positions(root, [*trial["prefix"], trial["advance"]], len(trial["prefix"]) + 1))
            if (len(reached) != len(trial["prefix"]) + 2 or reached[-2][0].fen() != trial["fen"]
                or reached[-1][0].fen() != result["reached"]):
                return "mismatched-board"
    durable_before = arm == "prepared" and sustained_before_advance(root, row, origin)
    for test, trial in zip(row["testResults"], row["tests"]):
        value = score(test["line"])
        if value > min(row["playedCp"] + 90, row["bestCp"] - 100):
            return "weak-advance-underperforms"
        if not stays_dangerous(root, trial, test["line"], origin, root.turn,
                               arm == "persistent" or (arm == "prepared" and not durable_before)):
            return "weak-advance-contained"
    for checked, control in zip(row["controlResults"], row["controls"]):
        if not checked:
            continue
        line = checked["line"]
        if score(line) < row["bestCp"] - 75:
            return "stronger-frame-does-not-hold"
        movelist = [*control["prefix"], control["advance"], *line["pvUci"]]
        stop = len(control["prefix"]) + 1
        trace = list(positions(root, movelist, stop + 7))
        if not economical_removal(trace, origin, root.turn, stop + 5, stop + 1):
            return "same-threat-in-control"
    return "supported"


def load(inputs, exclude):
    output = {}
    prior = [row for source in exclude for row in read(source) if row.get("playedMoveUci")]
    disjoint = {group(row) for row in prior}
    boards = {board_key(row) for row in prior}
    for row in (r for path in inputs for r in read(path)):
        if not row.get("playedMoveUci") or group(row) in disjoint or board_key(row) in boards:
            continue
        base_id = row["id"].split("#", 1)[0]
        old = output.get(base_id)
        if old is None or (comparison(row) is not None and (
            comparison(old) is None or
            min(line["depth"] for line in comparison(row)) > min(line["depth"] for line in comparison(old))
        )):
            output[base_id] = row
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("inputs", type=Path, nargs="+")
    parser.add_argument("--exclude", type=Path, nargs="*", default=[])
    parser.add_argument("--nodes", type=int, default=1_800_000)
    parser.add_argument("--target-rank", type=int, choices=(6, 7), default=7)
    parser.add_argument("--horizon", type=int, choices=(16, 24), default=HORIZON)
    args = parser.parse_args()
    counts, cases, seen_games, seen_boards = Counter(), [], set(), set()
    for row in load(args.inputs, args.exclude).values():
        result, nominated = nominate(row, args.target_rank, args.horizon)
        counts[result] += 1
        if not nominated:
            continue
        key = board_key(row)
        if nominated["game"] in seen_games or key in seen_boards:
            continue
        seen_games.add(nominated["game"])
        seen_boards.add(key)
        cases.append(nominated)
    print(dict(counts), len(cases), "distinct games", flush=True)
    with ProcessPoolExecutor(max_workers=5) as pool:
        verified = list(pool.map(verify_work, [(case, str(args.engine), args.nodes) for case in cases]))
    for row in verified:
        row["results"] = {arm: decision(row, arm) for arm in ARMS}
    arms = {arm: dict(Counter(r["results"][arm] for r in verified)) for arm in ARMS}
    result = dict(engine=digest(args.engine), nodes=args.nodes, targetRank=args.target_rank,
                  horizon=args.horizon, screened=counts, arms=arms,
                  sources={f"{source.parent.name}/{source.name}": digest(source)
                           for source in [*args.inputs, *args.exclude]},
                  medianMs=median([c["milliseconds"] for c in verified]) if verified else None, cases=verified)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
    print(arms)


if __name__ == "__main__":
    main()
