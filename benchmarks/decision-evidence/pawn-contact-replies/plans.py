"""Find a shared pawn lever even when the opponent responds differently."""

import argparse
from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
import sys

import chess

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import finite, initial, track_move


WINDOW = 14
MATERIAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


@dataclass
class Step:
    before: chess.Board
    after: chess.Board
    move: chess.Move
    actor: int
    victim: int | None
    balance: int
    san: str


def material(board, side):
    return sum(value * (len(board.pieces(role, side)) - len(board.pieces(role, not side)))
               for role, value in MATERIAL.items())


def replay(board, pv):
    position = board.copy()
    side = position.turn
    start = material(board, side)
    ids = {square: square for square in board.piece_map()}
    result = []
    for uci in pv[:WINDOW]:
        move = chess.Move.from_uci(uci)
        if not position.is_legal(move) or position.is_game_over() or position.is_repetition(3):
            return []
        before = position.copy(stack=False)
        actor = ids[move.from_square]
        san = position.san(move)
        victim = track_move(position, move, ids)
        position.push(move)
        result.append(Step(before, position.copy(stack=False), move, actor, victim,
                           material(position, side) - start, san))
    return result


@dataclass
class Contact:
    key: tuple[int, str, int, int]
    ply: int
    root: str
    contact: str
    before: str
    kind: str = ""
    action: str = ""
    resolved: int = 0
    balance: int = 0
    continuation: str = ""


def episode(steps, index, target, target_origin, settle):
    contact = steps[index]
    origin = contact.actor
    pawn = contact.move.to_square
    for response in range(index + 1, min(index + 9, len(steps))):
        step = steps[response]
        original_pair = (step.actor, step.victim) in {(origin, target_origin), (target_origin, origin)}
        if original_pair:
            end = response
            while (end + 1 < len(steps) and steps[end + 1].victim is not None and
                   steps[end + 1].move.to_square == step.move.to_square):
                end += 1
            # An uncontested pawn grab is material evidence. A balanced trade
            # of the original contact is the structural observation here.
            if end == response or abs(steps[end].balance - contact.balance) > 0:
                return None
            kind, last = "exchange", end
        elif step.actor == target_origin and step.victim is None and step.move.promotion is None:
            if response > index + 3 or chess.square_file(step.move.to_square) != chess.square_file(target):
                return None
            if (step.before.piece_type_at(step.move.from_square) != chess.PAWN
                    or not step.after.piece_at(pawn) == contact.after.piece_at(pawn)):
                return None
            kind, last = "advance", response
        else:
            if step.actor in {origin, target_origin} or step.victim in {origin, target_origin}:
                return None
            continue
        tail = steps[last:last + 3]
        if len(tail) != 3 or abs(tail[0].balance) > 1:
            return None
        end = last + 2
        if settle:
            while end + 1 < len(steps) and steps[end].victim is not None and (
                steps[end + 1].move.to_square == steps[end].move.to_square and steps[end + 1].victim is not None
            ):
                end += 1
            if abs(steps[end].balance - tail[0].balance) > 0:
                return None
        elif any(t.balance != tail[0].balance for t in tail):
            return None
        if kind == "advance" and any(t.victim == target_origin for t in steps[last + 1:end + 1]):
            return None
        return kind, end + 1, tail[0].balance, " ".join(s.san for s in steps[response:last + 1])
    return None


def contacts(board, steps, settle):
    ids = {square: square for square in board.piece_map()}
    positions = []
    for step in steps:
        track_move(step.before, step.move, ids)
        positions.append(dict(ids))
    result = []
    for i, step in enumerate(steps[:7]):
        if (i > 0 and steps[i - 1].after.is_check()) or step.after.is_check():
            continue
        if (step.victim is not None or step.move.promotion or
                step.before.piece_type_at(step.move.from_square) != chess.PAWN):
            continue
        for square in step.after.attacks(step.move.to_square) & step.after.pieces(chess.PAWN, step.after.turn):
            if step.before.attacks(step.move.from_square) & chess.BB_SQUARES[square]:
                continue
            target_origin = positions[i][square]
            key = step.actor, step.move.uci(), target_origin, square
            contact = Contact(key, i, steps[0].san, step.san, step.before.epd())
            outcome = episode(steps, i, square, target_origin, settle)
            if outcome:
                contact.kind, contact.resolved, contact.balance, contact.action = outcome
                contact.continuation = " ".join(s.san for s in steps[:contact.resolved])
            result.append(contact)
    return result


def examine(row, settle=False):
    candidates = row["candidates"]
    if len(candidates) < 2 or not finite(candidates[0]):
        return dict(pattern=[], grounded=[])
    board = initial(row)
    lead = candidates[0]
    first = contacts(board, replay(board, lead["pvUci"]), settle)
    pattern, grounded = [], []
    for line in candidates[1:]:
        if (not finite(line) or line["depth"] != lead["depth"] or
                not 0 <= lead["cp"] - line["cp"] <= 100 or
                line["pvUci"][0] == lead["pvUci"][0]):
            continue
        other = contacts(board, replay(board, line["pvUci"]), settle)
        for a in first:
            for b in other:
                if a.key != b.key or min(a.ply, b.ply) > 4:
                    continue
                entry = dict(
                    roots=[lead["pvUci"][0], line["pvUci"][0]],
                    selected=[a.root, b.root], pawn=chess.square_name(a.key[0]),
                    lever=a.key[1], contact=a.contact, target=chess.square_name(a.key[2]),
                    theirSquare=chess.square_name(a.key[3]),
                    outcomes=[a.kind, b.kind], actions=[a.action, b.action],
                    witness=[a.continuation, b.continuation],
                    requiredControl=[a.before, b.before],
                    linesUci=[lead["pvUci"][:a.resolved], line["pvUci"][:b.resolved]],
                )
                pattern.append(entry)
                if (a.kind and b.kind and a.before != b.before and abs(a.balance - b.balance) <= 1
                        and "advance" in {a.kind, b.kind}):
                    grounded.append(entry)
    return dict(pattern=pattern, grounded=grounded)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--settle", action="store_true")
    args = parser.parse_args()
    data = json.loads(args.input.read_bytes())
    rows = [dict(id=row["id"], **examine(row, settle=args.settle)) for row in data]
    counts = Counter(arm for row in rows for arm in ("pattern", "grounded") if row[arm])
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(dict(total=len(rows), counts=dict(counts), cases=rows), out, indent=2)
        out.write("\n")
    print(dict(counts), flush=True)


if __name__ == "__main__":
    main()
