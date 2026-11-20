"""Observed uses of the same original passed pawn across legal continuations."""

from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
import sys

import chess

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defender-capture-order"))
from capture_order import score
from trials import initial, within
from gather import track_move

WINDOW = 14
VALUE = (0, 100, 320, 330, 500, 900, 0)


def relative_rank(square, side):
    return chess.square_rank(square) if side else 7 - chess.square_rank(square)


def passed(board, square, side):
    file = chess.square_file(square)
    rank = relative_rank(square, side)
    return not any(abs(file - chess.square_file(other)) <= 1 and relative_rank(other, side) > rank
                   for other in board.pieces(chess.PAWN, not side))


def assets(board):
    return {square: side for side in chess.COLORS for square in board.pieces(chess.PAWN, side)
            if relative_rank(square, side) >= 4 and passed(board, square, side)}


def material(board, side):
    return sum(VALUE[piece.piece_type] * (1 if piece.color == side else -1)
               for piece in board.piece_map().values())


@dataclass(frozen=True)
class Step:
    after: chess.Board
    origin: int
    taken: int | None
    identities: dict
    move: chess.Move
    san: str
    quiet: bool
    material: int


def trace(board, moves):
    start = board.copy(stack=True)
    ids = {square: square for square in start.piece_map()}
    side = start.turn
    balance = material(start, side)
    result = []
    for uci in moves[:WINDOW]:
        if start.is_game_over(claim_draw=True):
            break
        move = start.parse_uci(uci)
        if start.is_castling(move):
            break
        origin = ids[move.from_square]
        san = start.san(move)
        quiet = not start.is_capture(move) and not start.gives_check(move) and not move.promotion
        taken = track_move(start, move, ids)
        start.push(move)
        result.append(Step(start.copy(stack=False), origin, taken, ids.copy(), move, san, quiet,
                           material(start, side) - balance))
    return result


def holds(trace, ply, pawn, piece, extra):
    later = trace[ply:ply+extra+1]
    return len(later) == extra + 1 and all(
        any(origin == pawn and step.after.piece_at(square) == piece
            for square, origin in step.identities.items()) for step in later)


def refines_guard(board, first, target):
    # Guarding the pawn for its next advance or reinforcing it where it stands.
    # This geometric comparison is only a condition on an observed plan.
    piece = board.piece_at(first.move.from_square)
    square = first.move.to_square
    return bool(piece and not board.is_pinned(piece.color, first.move.from_square)
        and not first.after.is_pinned(piece.color, square)
        and square in first.after.attackers(piece.color, target)
        and first.move.from_square not in board.attackers(piece.color, target))


def backs_replacement(step, original, square, side):
    if original.move.from_square != square:
        return False
    return any(
        chess.square_file(location) == chess.square_file(square)
        and location in step.after.attackers(side, square)
        and not step.after.is_pinned(side, location)
        for location, origin in step.identities.items() if origin == original.origin
    )


def observations(board, path, pawn, pawn_side, extended=False):
    side = board.turn
    first = path[0]
    # Departure events have to leave the original pawn intact. Clearance and
    # pressure alone cannot earn support without actual use in the line.
    for ply, step in enumerate(path[:8]):
        ours = ply % 2 == 0
        if pawn_side == side:
            if (ours and step.origin == pawn and step.quiet
                    and holds(path, ply, pawn, chess.Piece(chess.PAWN, side), 2)):
                yield dict(role="advance", ply=ply, actor=pawn, move=step.san,
                           effect=step.move.to_square, removed=(),
                           rootAction=ply == 0 or refines_guard(board, first, step.move.to_square)
                               or refines_guard(board, first, pawn))
        elif ours and step.taken == pawn and len(path) > ply+2 and path[ply+2].material >= -100:
            original_guards = set(board.attackers(pawn_side, pawn))
            lost = tuple(sorted(original_guards - set(step.identities.values())))
            reply, recovery = path[ply+1:ply+3]
            takes_back = (reply.taken == step.origin and recovery.taken == reply.origin
                          and recovery.origin == first.origin and recovery.move.to_square == step.move.to_square)
            root_actor = (step.origin == first.origin or takes_back or
                          any(item.origin == first.origin and item.taken in original_guards for item in path[:ply]))
            yield dict(role="remove", ply=ply, actor=step.origin, effect=step.move.to_square,
                       move=step.san, removed=lost, rootAction=root_actor and ply > 0)
        elif ours and step.quiet and len(path) > ply+4:
            locations = [sq for sq, origin in step.identities.items() if origin == pawn]
            if not locations:
                continue
            location = locations[0]
            square = location + (8 if pawn_side else -8)
            if (step.move.to_square == square and path[ply+4].material >= -100
                    and all(follow.identities.get(square) == step.origin
                            and follow.identities.get(location) == pawn for follow in path[ply+1:ply+5])):
                yield dict(role="blockade", ply=ply, actor=step.origin, effect=square,
                           move=step.san, removed=(), rootAction=step.origin == first.origin
                               or (extended and backs_replacement(step, first, square, side)))


def routes(row):
    choices = row["candidates"]
    known = {}
    for root in choices:
        if not root["pvUci"] or root["mate"] is not None or not within(choices, root["pvUci"][0], 50):
            continue
        uci = root["pvUci"][0]
        if within(row.get("comparisonCandidates") or [], uci, 50) is False:
            continue
        await_proof = next((probe["lines"] for probe in row.get("replyProbes", [])
                            if probe["moveUci"] == uci), [])
        preferred = await_proof[0] if await_proof else None
        if (not preferred or preferred["mate"] is not None or score(preferred) is None
                or abs(root["cp"] + preferred["cp"]) > 90):
            continue
        known.setdefault(tuple(root["pvUci"][:WINDOW]), "root")
        for line in await_proof:
            if (line["mate"] is None and score(line) is not None and preferred["cp"] - line["cp"] <= 100
                    and line["depth"] == preferred["depth"]):
                known.setdefault(tuple([uci, *line["pvUci"]][:WINDOW]), "reply")
    return known


def truly_distinct(first, second, path_a, path_b, extended=False):
    if path_a[:2] == path_b[:2]:
        return False
    # Convergence before the observed use does not supply two plans.
    if first["before"] == second["before"]:
        return (extended and first["ply"] == second["ply"] == 0 and path_a[0] == path_b[0]
                and first["role"] in {"advance", "blockade"} and first["role"] == second["role"])
    if first["role"] != second["role"] or first["actor"] != second["actor"] or first["removed"] != second["removed"]:
        return True
    # At least one quieter continuation must reach a different pawn square
    # or a different blockading arrangement.
    return first["effect"] != second["effect"] or first["role"] in {"advance", "blockade"}


def compare(row, extended=False):
    board = initial(row)
    pawns = assets(board)
    discovered = {pawn: [] for pawn in pawns}
    if not pawns:
        return dict(position=None, moves={}, repeatedPosition=None, repeatedMoves={}, assets=0)
    for path in routes(row):
        steps = trace(board, path)
        if not steps:
            continue
        for pawn, side in pawns.items():
            for action in observations(board, steps, pawn, side, extended):
                ply = action["ply"]
                discovered[pawn].append(dict(action, path=path[:ply+3],
                    before=steps[ply-1].after.epd() if ply else board.epd()))
    position = None
    moves = {}
    repeated_position = None
    repeated_moves = {}
    for pawn, observed in discovered.items():
        for first, second in combinations(observed, 2):
            proof = dict(pawn=chess.square_name(pawn), defending=pawns[pawn] != board.turn,
                         branches=[first, second])
            if first["path"][0:2] != second["path"][0:2]:
                if repeated_position is None:
                    repeated_position = proof
                if first["path"][0] == second["path"][0]:
                    repeated_moves.setdefault(first["path"][0], proof)
            if not truly_distinct(first, second, first["path"], second["path"], extended):
                continue
            if position is None:
                position = proof
            root = first["path"][0]
            if root == second["path"][0] and first["rootAction"] and second["rootAction"]:
                moves.setdefault(root, proof)
    return dict(position=position, moves=moves, repeatedPosition=repeated_position,
                repeatedMoves=repeated_moves, assets=len(pawns))
