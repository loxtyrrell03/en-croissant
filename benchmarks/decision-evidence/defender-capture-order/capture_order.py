"""Find, then test, a quiet move that prepares the removal of a defender."""

from dataclasses import dataclass

import chess


@dataclass(frozen=True)
class Candidate:
    root: str
    reply: str
    remove: str
    take: str
    guard: int
    target: int
    preparer: int


def ordinary_capture(board, move):
    return board.is_capture(move) and not board.is_en_passant(move) and not move.promotion


def nomination(board, pv):
    if len(pv) < 5:
        return None
    reached = board.copy(stack=False)
    root = reached.parse_uci(pv[0])
    if reached.is_check() or reached.is_capture(root) or reached.gives_check(root) or root.promotion or reached.is_castling(root):
        return None
    reached.push(root)
    reply = reached.parse_uci(pv[1])
    if reply.promotion or reached.is_castling(reply):
        return None
    reached.push(reply)
    remove = reached.parse_uci(pv[2])
    guard = remove.to_square
    preparer = remove.from_square
    if preparer != root.to_square or not ordinary_capture(reached, remove) or reached.gives_check(remove):
        return None
    old_guard = reply.from_square if reply.to_square == guard else guard
    if board.is_legal(chess.Move(root.from_square, old_guard)) and board.piece_at(old_guard) is not None:
        return None
    available = {move for move in reached.legal_moves if ordinary_capture(reached, move)}
    branch = reached.copy(stack=False)
    branch.push(remove)
    displaced = set()
    for offset, value in enumerate(pv[3:7], start=3):
        move = branch.parse_uci(value)
        if branch.is_castling(move) or branch.is_en_passant(move) or move.promotion:
            break
        if offset % 2 == 0 and move in available and move.to_square not in displaced and move.from_square not in displaced:
            if move.from_square != preparer and move.to_square != guard and ordinary_capture(branch, move):
                early = reached.copy(stack=False)
                early.push(move)
                if early.is_legal(chess.Move(guard, move.to_square)):
                    return Candidate(*pv[:3], value, guard, move.to_square, preparer)
        displaced.update((move.from_square, move.to_square))
        branch.push(move)
    return None


def checkpoint(board, candidate):
    after = board.copy(stack=True)
    after.push_uci(candidate.root)
    after.push_uci(candidate.reply)
    return after


def remove_then_take(board, candidate, variation):
    if len(variation) < 3 or variation[0] != candidate.remove:
        return False
    target = board.piece_at(candidate.target)
    for index, value in enumerate(variation[:5]):
        move = board.parse_uci(value)
        if move.from_square == candidate.target:
            return False
        if move.to_square == candidate.target:
            return index % 2 == 0 and board.is_capture(move) and board.piece_at(candidate.target) == target
        board.push(move)
    return False


def penalty_role(candidate, line):
    variation = line["pvUci"]
    if len(variation) < 2 or variation[0] != candidate.take:
        return None
    reply = chess.Move.from_uci(variation[1])
    if reply.from_square != candidate.guard:
        return None
    if reply.to_square == candidate.target:
        return "recaptures"
    if reply.to_square == candidate.preparer:
        return "takes-preparer"
    return None


def score(line, depth_floor=16):
    if (not line or line["depth"] < depth_floor or not line["pvUci"]
            or line.get("lowerbound") or line.get("upperbound")):
        return None
    mate = line["mate"]
    if mate is not None:
        return (1 if mate > 0 else -1) * (100_000 - abs(mate))
    return line["cp"]


def comparison(board, candidate, lines, *, floor=16):
    if len(lines) != 2 or lines[0]["depth"] != lines[1]["depth"]:
        return dict(label="unresolved")
    by_move = {line["pvUci"][0]: line for line in lines if line["pvUci"]}
    better, early = by_move.get(candidate.remove), by_move.get(candidate.take)
    good, bad = score(better, floor), score(early, floor)
    if good is None or bad is None:
        return dict(label="unresolved")
    # A shorter winning mate alone does not establish this mechanism.
    shared_mate = better["mate"] is not None and early["mate"] is not None and (good > 0) == (bad > 0)
    gap = 0 if shared_mate else good - bad
    if abs(gap) <= 50 or gap <= -100:
        return dict(label="order-harmless", gap=gap)
    if gap < 100:
        return dict(label="unresolved", gap=gap)
    takes_target = remove_then_take(board.copy(stack=False), candidate, better["pvUci"])
    role = penalty_role(candidate, early)
    return dict(label="guard-causal" if takes_target and role else "other-or-unresolved",
                gap=gap, takesTarget=takes_target, guardRole=role)
