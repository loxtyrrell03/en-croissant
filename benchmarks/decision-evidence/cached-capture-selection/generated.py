"""Expand the final capture if search agrees on the quiet move and guard removal."""

import chess

from capture_order import nomination, ordinary_capture


VALUE = (0, 100, 320, 330, 500, 900, 0)


def legal_targets(board, path):
    if len(path) < 5:
        return
    checkpoint = board.copy(stack=False)
    for move in path[:2]:
        checkpoint.push_uci(move)
    guard_capture = checkpoint.parse_uci(path[2])
    if not ordinary_capture(checkpoint, guard_capture):
        return
    child = checkpoint.copy(stack=False)
    child.push(guard_capture)
    defence = child.parse_uci(path[3])
    child.push(defence)
    for target in checkpoint.legal_moves:
        if not ordinary_capture(checkpoint, target) or not child.is_legal(target) or not ordinary_capture(child, target):
            continue
        proposal = nomination(board, [*path[:4], target.uci()])
        if proposal:
            attacker = checkpoint.piece_type_at(target.from_square)
            victim = checkpoint.piece_type_at(target.to_square)
            guard = checkpoint.piece_type_at(guard_capture.to_square)
            priority = (VALUE[attacker] - VALUE[victim], VALUE[guard], VALUE[victim])
            yield priority, proposal


def generated_candidate(board, paths):
    distinct = {}
    for path in paths:
        for priority, candidate in legal_targets(board, path):
            distinct.setdefault(candidate, priority)
    if not distinct:
        return None
    return max(distinct, key=distinct.__getitem__)
