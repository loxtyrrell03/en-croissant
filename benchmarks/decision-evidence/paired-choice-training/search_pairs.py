"""Search same-board alternatives and record narrowly corroborated tactical outcomes."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys
from time import perf_counter

import chess

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "neural-deep-witness"))
from frames import engines, initial, records, search

VALUES = {1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 0}
SHORT_ROOT = 90_000
SHORT_REPLY = 12_000
REFERENCE_ROOT = 820_000
REFERENCE_REPLY = 260_000
MAX_PREVIEW_LOSS = 175
REPEATED_LOSS = 90
CLOSE = 35
MATERIAL = 2


def select_lines(board, exe, nodes, ranks, allowed=None):
    return search(board, exe, nodes, ranks, allowed)["lines"]


def cp(line):
    if line["mate"] is not None:
        mate = line["mate"]
        return 10_000 - mate if mate > 0 else -10_000 - mate
    return line["cp"]


def child(board, uci):
    next_board = board.copy(stack=True)
    next_board.push_uci(uci)
    return next_board


def trace(board, moves, count=8):
    state = board.copy(stack=False)
    our = state.turn
    by_ply, taken = [], []
    identity = {square: square for square in state.piece_map()}
    for i, uci in enumerate(moves[:count]):
        move = state.parse_uci(uci)
        if state.is_capture(move):
            victim_square = move.to_square
            if state.is_en_passant(move):
                victim_square += -8 if state.turn else 8
            if state.turn != our:
                taken.append((i, uci, state.piece_type_at(victim_square), identity[victim_square]))
            del identity[victim_square]
        if state.is_castling(move):
            rank = chess.square_rank(move.from_square)
            kingside = state.is_kingside_castling(move)
            rook_from = chess.square(7 if kingside else 0, rank)
            rook_to = chess.square(5 if kingside else 3, rank)
            identity[rook_to] = identity.pop(rook_from)
        identity[move.to_square] = identity.pop(move.from_square)
        state.push(move)
        by_ply.append(sum(VALUES[p.piece_type] * (1 if p.color == our else -1)
                          for p in state.piece_map().values()))
    return by_ply, taken


def material_comparison(board, better, worse):
    good, _ = trace(board, better)
    bad, captures = trace(board, worse)
    horizon = min(len(good), len(bad))
    if horizon < 6:
        return None
    # The final common full-move window must retain the contrast after the reply.
    window = slice(horizon - 3, horizon)
    difference = min(good[window]) - max(bad[window])
    if difference < MATERIAL:
        return None
    actual_capture = next((capture for capture in captures if capture[0] <= 5 and
                           capture[2] in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)), None)
    return (difference, actual_capture) if actual_capture else None


def same_occurrence(first, second):
    return first is not None and second is not None and first[1] == second[1]


def bounded_mate(root, reply):
    # Both scores favour the opponent after the inferior root choice.
    return (root["mate"] is not None and -4 <= root["mate"] < 0 and
            reply["mate"] is not None and 0 < reply["mate"] <= 4)


def classify_pair(board, alt, leader, root_lines, replies):
    bad, good = root_lines[alt], root_lines[leader]
    bad_reply, good_reply = replies[alt], replies[leader]
    gap = cp(good) - cp(bad)
    independent_gap = cp(bad_reply) - cp(good_reply)
    summary = {"move": alt, "comparedWith": leader, "rootLossCp": gap, "replyLossCp": independent_gap}
    if abs(gap) <= CLOSE and abs(independent_gap) <= CLOSE and all(
        line["mate"] is None for line in (bad, good, bad_reply, good_reply)
    ):
        return dict(summary, outcome="competitive")
    if gap < REPEATED_LOSS or independent_gap < REPEATED_LOSS:
        return dict(summary, outcome="unresolved")
    bad_line = [alt, *bad_reply["pvUci"]]
    good_line = [leader, *good_reply["pvUci"]]
    move = bad_reply["pvUci"][0]
    if bad["pvUci"][1:2] != [move]:
        return dict(summary, outcome="unresolved")
    anchor = None
    if bounded_mate(bad, bad_reply) and good["mate"] is None and good_reply["mate"] is None:
        anchor = {"mechanism": "mate", "reply": move}
    else:
        material = material_comparison(board, good["pvUci"], bad["pvUci"])
        independent = material_comparison(board, good_line, bad_line)
        if material and independent and same_occurrence(material[1], independent[1]):
            ply, capture, victim, original = independent[1]
            anchor = {"mechanism": "material", "reply": move, "capture": capture,
                      "victim": chess.piece_symbol(victim), "payoffPly": ply + 1,
                      "originalVictimSquare": chess.square_name(original),
                      "materialContrast": min(material[0], independent[0])}
    if not anchor:
        return dict(summary, outcome="unresolved")
    return dict(summary, outcome="provisional", **anchor)


def finish_pair(board, pair, roots, replies, exe, budget):
    good = pair["comparedWith"]
    weak = pair["move"]
    bad_line = [weak, *replies[weak]["pvUci"]]
    strong = child(board, good)
    reply = chess.Move.from_uci(pair["reply"])
    move = chess.Move.from_uci(good)
    before = child(board, weak)
    affected = None
    if reply not in strong.legal_moves:
        if move.to_square == reply.from_square and board.is_capture(move):
            affected = "better move takes attacker"
        elif strong.is_check() and not before.is_check():
            affected = "better move gives check"
        if not affected:
            return dict(pair, outcome="unresolved", control="reply is illegal for an unattributed reason")
        return dict(pair, outcome="verified", control=affected, comparedLine=roots[good]["pvUci"],
                    refutedLine=bad_line)
    tested = select_lines(strong, exe, budget, 1, [reply])
    if not tested:
        return dict(pair, outcome="unresolved", control="no exact restricted score")
    line = tested[0]
    loss = cp(replies[weak]) - cp(line)
    if loss < REPEATED_LOSS:
        return dict(pair, outcome="unresolved", control="same reply remains strong", controlLossCp=loss)
    control_trace = [good, *line["pvUci"]]
    if pair["mechanism"] == "mate":
        different = line["mate"] is None or line["mate"] <= 0
    else:
        contrast = material_comparison(board, control_trace, bad_line)
        original = chess.parse_square(pair["originalVictimSquare"])
        different = bool(contrast and contrast[1][1] == pair["capture"] and
                         contrast[1][3] == original)
    if not different:
        return dict(pair, outcome="unresolved", control="restricted line lacks a concrete contrast",
                    controlLossCp=loss)
    return dict(pair, outcome="verified", control="same reply loses its payoff", controlLossCp=loss,
                comparedLine=control_trace, refutedLine=bad_line, controlFrame=line)


def root_map(lines):
    return {line["pvUci"][0]: line for line in lines}


def label_pairs(row, exe, budget):
    if not row["reference"]:
        return row
    board = initial(row)
    leader = row["reference"][0]["pvUci"][0]
    roots = root_map(row["reference"])
    replies = {move: lines[0] for move, lines in row["referenceReplies"].items() if lines}
    pairs = []
    if leader in replies:
        for move in root_map(row["preview"]):
            if move == leader or move not in replies:
                continue
            pair = classify_pair(board, move, leader, roots, replies)
            if pair["outcome"] == "provisional":
                pair = finish_pair(board, pair, roots, replies, exe, budget)
            pairs.append(pair)
    return dict(row, pairs=pairs)


def gather(row, exe, reference_root=REFERENCE_ROOT, reference_reply=REFERENCE_REPLY):
    board = initial(row)
    base = {**row, "preview": [], "previewReplies": {}, "reference": [], "pairs": []}
    if board.is_game_over(claim_draw=True):
        return base
    found = select_lines(board, exe, SHORT_ROOT, min(5, board.legal_moves.count()))
    if not found or found[0]["cp"] is None:
        return base
    forced = row.get("trainingMove")
    if forced and forced not in root_map(found):
        moves = [board.parse_uci(uci) for uci in [*list(root_map(found))[:4], forced]]
        found = select_lines(board, exe, SHORT_ROOT, len(moves), moves)
        if not found or found[0]["cp"] is None:
            return base
    preview = [line for line in found if line["cp"] is not None and
               (line["pvUci"][0] == forced or found[0]["cp"] - line["cp"] <= MAX_PREVIEW_LOSS) and
               not child(board, line["pvUci"][0]).is_game_over(claim_draw=True)]
    if len(preview) < 2:
        return base
    moves = list(root_map(preview))
    boards = {move: child(board, move) for move in moves}
    quick = {move: select_lines(boards[move], exe, SHORT_REPLY, 1) for move in moves}
    deep = select_lines(board, exe, reference_root, len(moves), [board.parse_uci(uci) for uci in moves])
    if len(deep) != len(moves):
        return dict(base, preview=preview, previewReplies=quick)
    replies = {uci: select_lines(boards[uci], exe, reference_reply, 1) for uci in moves}
    return label_pairs(dict(base, preview=preview, previewReplies=quick, reference=deep, referenceReplies=replies),
                       exe, reference_reply)


def run(rows, out, jobs, evaluate):
    start = perf_counter()
    with out.open("x", encoding="utf-8") as file, ThreadPoolExecutor(jobs) as pool:
        for i, capture in enumerate(pool.map(evaluate, rows), 1):
            file.write(json.dumps(capture, separators=(",", ":")) + "\n")
            file.flush()
            if i % 25 == 0 or i == len(rows):
                print(f"{i} of {len(rows)} in {perf_counter() - start:.1f}s", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--jobs", type=int, default=7)
    parser.add_argument("--root-nodes", type=int, default=REFERENCE_ROOT)
    parser.add_argument("--reply-nodes", type=int, default=REFERENCE_REPLY)
    parser.add_argument("--saved-frames", action="store_true")
    args = parser.parse_args()
    print(f"Engine SHA-256 {sha256(args.engine.read_bytes()).hexdigest()}", flush=True)
    try:
        exe = str(args.engine)
        evaluate = (lambda row: label_pairs(row, exe, args.reply_nodes)) if args.saved_frames else (
            lambda row: gather(row, exe, args.root_nodes, args.reply_nodes)
        )
        run(records(args.input), args.output, args.jobs, evaluate)
    finally:
        for worker in engines:
            worker.quit()
