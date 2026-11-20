"""A broad early-exchange heuristic used as an experimental control."""
import argparse
from dataclasses import dataclass
import json
from pathlib import Path

import chess

VALUE = [0, 100, 320, 330, 500, 900, 0]
MIN_GAIN = 90


def value(board, move):
    if board.is_en_passant(move):
        return 100
    return VALUE[board.piece_type_at(move.to_square) or 0]


def exchange_gain(board, move):
    if move not in board.legal_moves:
        return None
    change = value(board, move)
    if move.promotion:
        change += VALUE[move.promotion] - 100
    after = board.copy(stack=False)
    after.push(move)
    replies = after.generate_legal_captures(to_mask=chess.BB_SQUARES[move.to_square])
    return change - max(0, max((exchange_gain(after, reply) for reply in replies), default=0))


@dataclass
class Step:
    before: chess.Board
    move: chess.Move
    after: chess.Board
    capture: int


def trace(board, moves):
    line = []
    for uci in moves:
        if board.is_game_over():
            break
        move = board.parse_uci(uci)
        child = board.copy(stack=False)
        child.push(move)
        line.append(Step(board, move, child, value(board, move)))
        board = child
    return line


def supports_local_gain(take):
    if exchange_gain(take.before, take.move) >= MIN_GAIN:
        return True
    recaptures = [
        reply
        for reply in take.after.generate_legal_captures(to_mask=chess.BB_SQUARES[take.move.to_square])
        if exchange_gain(take.after, reply) > take.capture - MIN_GAIN
    ]
    if not recaptures:
        return False
    for reply in recaptures:
        child = take.after.copy(stack=False)
        child.push(reply)
        required = MIN_GAIN + value(take.after, reply) - take.capture
        if not any(
            counter.to_square != take.move.to_square
            and exchange_gain(child, counter) >= required
            and (exchange_gain(take.before, counter) or 0) < MIN_GAIN
            for counter in child.generate_legal_captures()
        ):
            return False
    return True


def material(board, side):
    return sum(VALUE[p.piece_type] * (1 if p.color == side else -1) for p in board.piece_map().values())


def covered(record):
    pair = record.get("comparisonCandidates") or record["candidates"]
    better = pair[0]
    actual = next((line for line in pair[1:] if line["pvUci"][0] == record["playedMoveUci"]), None)
    if not actual or better["depth"] != actual["depth"] or len(actual["pvUci"]) < 6:
        return False
    probes = {entry["moveUci"]: entry["lines"][0] for entry in record.get("replyProbes", []) if entry["lines"]}
    weaker_reply = probes.get(actual["pvUci"][0])
    stronger_reply = probes.get(better["pvUci"][0])
    frames = (better, actual, weaker_reply, stronger_reply)
    if any(not f or f["cp"] is None or f.get("mate") is not None or f["depth"] < 16 for f in frames):
        return False
    if (
        better["cp"] - actual["cp"] < 100
        or weaker_reply["cp"] - stronger_reply["cp"] < 75
        or abs(weaker_reply["cp"] + actual["cp"]) > 90
        or abs(stronger_reply["cp"] + better["cp"]) > 90
        or actual["pvUci"][1:4] != weaker_reply["pvUci"][:3]
    ):
        return False
    board = chess.Board(record["fen"])
    line = trace(board, actual["pvUci"][:9])
    if len(line) < 6:
        return False
    _, first, response, payoff = line[:4]
    if (
        not all(step.capture for step in (first, response, payoff))
        or first.move.to_square != response.move.to_square
        or not supports_local_gain(payoff)
    ):
        return False
    try:
        control = trace(board, [better["pvUci"][0], *actual["pvUci"][1:4]])
    except chess.IllegalMoveError:
        control = []
    if len(control) == 4 and supports_local_gain(control[3]):
        return False
    recheck = trace(board, [actual["pvUci"][0], *weaker_reply["pvUci"][:7]])
    original = material(board, board.turn)
    first_run = [material(step.after, board.turn) - original for step in line[3:8]]
    second_run = [material(step.after, board.turn) - original for step in recheck[3:8]]
    return any(
        first_run[i] <= -MIN_GAIN
        and len(set(first_run[i - 2:i + 1] + second_run[i - 2:i + 1])) == 1
        for i in range(2, min(len(first_run), len(second_run)))
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    opts = parser.parse_args()
    records = json.loads(opts.input.read_bytes())
    print(json.dumps([{"id": record["id"]} for record in records if covered(record)], indent=2))


if __name__ == "__main__":
    main()
