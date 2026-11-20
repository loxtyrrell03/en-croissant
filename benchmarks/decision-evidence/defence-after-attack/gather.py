"""Verify defensive replies to the same attack after two legal root choices."""

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import hashlib
import importlib
import json
from pathlib import Path
import re
import sys
from time import perf_counter

import chess
import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/benchmarks"))
engine_tools = importlib.import_module("decision-evidence-engine")


def read(path):
    payload = path.read_bytes().strip()
    return json.loads(payload) if payload.startswith(b"[") else [json.loads(line) for line in payload.splitlines()]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def initial(row):
    history = row.get("history")
    if history is None:
        return chess.Board(row["fen"])
    root = chess.Board(history["fen"])
    for move in history["moves"]:
        root.push_uci(move)
    if root.fen() != chess.Board(row["fen"]).fen():
        raise ValueError(f"Wrong root history in {row['id']}")
    return root


def choice_key(row):
    board = chess.Board(row["fen"])
    move = chess.Move.from_uci(row["playedMoveUci"])
    return min((board.epd(), move.uci()), (board.mirror().epd(), chess.Move(
        chess.square_mirror(move.from_square), chess.square_mirror(move.to_square), move.promotion,
    ).uci()))


def group(row):
    value = row.get("game") or row.get("sourceGroup")
    if value:
        return value[:16] if re.fullmatch(r"[a-f0-9]{32,64}", value) else value
    matched = re.search(r"-([a-f0-9]{16})-\d+$", row["id"])
    return matched.group(1) if matched else row["id"]


def finite(line):
    return (line.get("cp") is not None and line.get("mate") is None and line["depth"] >= 16
            and not (line.get("lowerbound") or line.get("upperbound")) and line["pvUci"])


def track_move(board, move, identities):
    origin = identities.pop(move.from_square)
    taken = None
    if board.is_castling(move):
        rank = 0 if board.turn else 7
        rook_source = chess.square(7 if board.is_kingside_castling(move) else 0, rank)
        rook_to = chess.square(5 if board.is_kingside_castling(move) else 3, rank)
        identities[rook_to] = identities.pop(rook_source)
    if board.is_capture(move):
        square = move.to_square
        if board.is_en_passant(move):
            square += -8 if board.turn else 8
        taken = identities.pop(square)
    identities[move.to_square] = origin
    return taken


def same_capture_available(good_move, destination, good_ids, bad_ids, bad):
    identity = good_ids[good_move.from_square]
    source = next((square for square, found in bad_ids.items() if found == identity), None)
    if source is None:
        return False
    corresponding = chess.Move(source, destination, good_move.promotion)
    return bad.is_legal(corresponding) and bad.is_capture(corresponding)


def comparison(row):
    choices = row.get("comparisonCandidates") or row.get("candidates", [])
    if len(choices) < 2:
        return
    played = next((line for line in choices[1:] if line["pvUci"][0] == row.get("playedMoveUci")), None)
    better = choices[0]
    probes = {item["moveUci"]: item["lines"][0] for item in row.get("replyProbes", []) if item["lines"]}
    strong, weak = probes.get(better["pvUci"][0]), probes.get(row.get("playedMoveUci"))
    if (
        not played or not strong or not weak or any(not finite(line) for line in (better, played, weak, strong))
        or better["depth"] != played["depth"] or better["cp"] - played["cp"] < 90
        or weak["cp"] - strong["cp"] < 90
        or abs(better["cp"] + strong["cp"]) > 90 or abs(played["cp"] + weak["cp"]) > 90
    ):
        return
    return better, played, strong, weak


def replay_shared(root, row):
    better, played, strong, weak = comparison(row)
    good = root.copy()
    bad = root.copy()
    controls = better["pvUci"][0], played["pvUci"][0]
    good_ids = {square: square for square in root.piece_map()}
    bad_ids = good_ids.copy()
    track_move(good, good.parse_uci(controls[0]), good_ids)
    track_move(bad, bad.parse_uci(controls[1]), bad_ids)
    good.push_uci(controls[0])
    bad.push_uci(controls[1])
    if good.fen() != chess.Board(strong["fen"]).fen() or bad.fen() != chess.Board(weak["fen"]).fen():
        return None, "reply-board-mismatch"
    prefix, names = [], []
    for index, (main, other) in enumerate(zip(played["pvUci"][1:7], weak["pvUci"][:6]), 1):
        move = chess.Move.from_uci(main)
        if (
            main != other or not good.is_legal(move) or not bad.is_legal(move)
            or good.piece_at(move.from_square) != bad.piece_at(move.from_square)
            or good.piece_at(move.to_square) != bad.piece_at(move.to_square)
            or good_ids.get(move.from_square) != bad_ids.get(move.from_square)
            or good_ids.get(move.to_square) != bad_ids.get(move.to_square)
            or good.is_en_passant(move) != bad.is_en_passant(move)
            or good.is_castling(move) != bad.is_castling(move)
        ):
            return None, "shared-line-diverges"
        played_san, better_san = bad.san(move), good.san(move)
        track_move(good, move, good_ids)
        track_move(bad, move, bad_ids)
        good.push(move)
        bad.push(move)
        prefix.append(main)
        names.append(played_san)
        if index % 2 == 0 or not bad.checkers() or move.to_square not in bad.checkers():
            continue
        available = [action for action in good.legal_moves if action.to_square == move.to_square
                     and good.is_capture(action) and not bad.is_legal(action)
                     and not same_capture_available(action, move.to_square, good_ids, bad_ids, bad)]
        if available and not good.can_claim_draw() and not bad.can_claim_draw() and not bad.is_game_over():
            return dict(
                id=row["id"], game=group(row), site=row.get("site"), event=row.get("event"),
                fen=row["fen"], history=row.get("history"), better=controls[0], played=controls[1],
                prefix=prefix, san=names, alternativeAttackSan=better_san,
                good=good.fen(), bad=bad.fen(), goodChecked=good.is_check(),
                captures=sorted(action.uci() for action in available),
                betterCp=better["cp"], playedCp=played["cp"], playedReplyCp=weak["cp"],
                rootWorse=played["pvUci"], replyWorse=[controls[1], *weak["pvUci"]],
                rootBetter=better["pvUci"], replyBetter=[controls[0], *strong["pvUci"]],
            ), "selected"
    return None, "no-exclusive-capture"


def shortlist(files, excluded):
    seen = set()
    seen_games = set()
    for row in excluded:
        if row.get("playedMoveUci"):
            seen.add(choice_key(row))
            seen_games.add(group(row))
    results, reasons = [], Counter()
    # Ensure each ledger contains at most one sample from a game and each
    # board/move occurs only once, including colour-mirrored positions.
    for row in (row for path in files for row in read(path)):
        if not row.get("playedMoveUci") or not comparison(row):
            reasons["no-stable-comparison"] += 1
            continue
        key = choice_key(row)
        game = group(row)
        if key in seen or game in seen_games:
            reasons["overlap"] += 1
            continue
        seen.add(key)
        seen_games.add(game)
        result, status = replay_shared(initial(row), row)
        reasons[status] += 1
        if result:
            results.append(result)
    return results, dict(reasons)


def searched(engine, board, nodes, count=3, fixed=None):
    moves = [board.parse_uci(move) for move in fixed] if fixed is not None else None
    variations = min(count, len(moves) if moves is not None else board.legal_moves.count())
    if not variations:
        return []
    frame = engine_tools.CompleteVariations(board, variations)
    engine.configure({"Clear Hash": None})
    with engine.analysis(board, chess.engine.Limit(nodes=nodes), multipv=variations, root_moves=moves) as stream:
        for row in stream:
            frame.add(row)
    return [dict(depth=row["depth"], cp=row["score"].relative.score(), mate=row["score"].relative.mate(),
                 nodes=row["nodes"], pvUci=[move.uci() for move in row["pv"]])
            for row in frame.best or []]


def compare(task):
    row, executable, nodes = task
    good, bad = initial(row), initial(row)
    for light, root_move, target in ((good, row["better"], row["good"]), (bad, row["played"], row["bad"])):
        for move in [root_move, *row["prefix"]]:
            light.push_uci(move)
        if light.fen() != target:
            raise ValueError("Reached the wrong checkpoint")
    start = perf_counter()
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Hash": 32, "Threads": 1})
        better = searched(engine, good, nodes)
        played = searched(engine, bad, nodes)
        capture = searched(engine, good, nodes, fixed=row["captures"])
        # Exclude the unavailable checker captures as a group. If other
        # ways to meet the threat still hold, the resource is sufficient but
        # the search cannot show that losing this set is what caused the loss.
        non_capture = [move.uci() for move in good.legal_moves if move.uci() not in row["captures"]]
        denied = searched(engine, good, nodes, fixed=non_capture)
    return dict(row, betterSearch=better, playedSearch=played, captureSearch=capture,
                deniedSearch=denied, elapsedMs=(perf_counter() - start) * 1000)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    prep = modes.add_parser("nominate")
    prep.add_argument("output", type=Path)
    prep.add_argument("inputs", type=Path, nargs="+")
    prep.add_argument("--exclude", type=Path, nargs="*", default=[])
    run = modes.add_parser("search")
    for name in ("source", "engine", "output"):
        run.add_argument(name, type=Path)
    run.add_argument("--nodes", type=int, default=2_400_000)
    args = parser.parse_args()
    if args.mode == "nominate":
        cases, gate = shortlist(args.inputs, [row for path in args.exclude for row in read(path)])
        result = dict(counts=gate, sources={path.name: digest(path) for path in args.inputs},
                      excluded={path.name: digest(path) for path in args.exclude}, cases=cases)
        print(gate)
    else:
        source = json.loads(args.source.read_bytes())
        tasks = [(row, str(args.engine), args.nodes) for row in source["cases"]]
        with ProcessPoolExecutor(max_workers=5) as pool:
            cases = list(pool.map(compare, tasks))
        result = dict(engineSha256=digest(args.engine), nodesPerSearch=args.nodes,
                      sourceSha256=digest(args.source), cases=cases)
        print(f"{len(cases)} checked positions with up to four searches per exact attack")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream)


if __name__ == "__main__":
    main()
