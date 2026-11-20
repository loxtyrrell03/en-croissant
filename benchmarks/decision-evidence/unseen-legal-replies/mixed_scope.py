"""Audit whether a tactical capture order also contains a passed pawn."""

from collections import Counter
from pathlib import Path
import sys

import chess

from legal_pool import initial
from freeze import read


def advanced_passer(board, square, defending_side):
    target = board.piece_at(square)
    if target != chess.Piece(chess.PAWN, defending_side):
        return False
    file, rank = chess.square_file(square), chess.square_rank(square)
    relative_rank = rank if defending_side else 7 - rank
    if relative_rank < 4:
        return False
    return not any(abs(chess.square_file(other) - file) <= 1
                   and ((chess.square_rank(other) > rank) if defending_side else (chess.square_rank(other) < rank))
                   for other in board.pieces(chess.PAWN, not defending_side))


def alternative_pawn_capture(board, pv, pawn, defender):
    """Track both original pieces, allowing the defender to move first."""
    for turn, value in enumerate(pv[:7]):
        move = board.parse_uci(value)
        if board.is_en_passant(move) or board.is_castling(move) or move.promotion:
            return False
        if move.to_square == pawn:
            return turn % 2 == 0 and board.is_capture(move)
        if move.to_square == defender:
            return False
        if move.from_square == pawn:
            pawn = move.to_square
        if move.from_square == defender:
            defender = move.to_square
        board.push(move)
    return False


def screen(inputs, references):
    full = {row["id"]: row for row in inputs}
    positives = [row for row in references if row["label"] == "positive"]
    found = []
    for row in positives:
        order = row["candidate"]
        original = initial(full[row["id"]])
        target = order["target"]
        after = original.copy(stack=True)
        after.push_uci(order["root"])
        reply = after.parse_uci(order["reply"])
        if reply.to_square == target or reply.from_square == target:
            # This analysis tests the independently stable pawn already present
            # at the root, before either opponent reply.
            continue
        guard = reply.from_square if reply.to_square == order["guard"] else order["guard"]
        if not advanced_passer(original, target, not original.turn):
            continue
        branch = next((x["lines"] for x in full[row["id"]].get("replyProbes", [])
                       if x["moveUci"] == order["root"]), [])
        alternatives = []
        for available in branch:
            if (not available["pvUci"] or available["pvUci"][0] == order["reply"] or available["cp"] is None
                    or branch[0]["cp"] is None or branch[0]["cp"] - available["cp"] > 100):
                continue
            two = [order["root"], *available["pvUci"]]
            if alternative_pawn_capture(original.copy(stack=False), two, target, guard):
                alternatives.append(available["pvUci"][0])
        found.append(dict(id=row["id"], source=row.get("site"), alternates=alternatives, candidate=order))
    return len(positives), found


if __name__ == "__main__":
    for inp, labels in zip(sys.argv[1::2], sys.argv[2::2]):
        all_positive, found = screen(read(Path(inp)), read(Path(labels)))
        print(Path(inp).parent.name, all_positive, len(found), Counter(bool(x["alternates"]) for x in found))
        for item in found:
            print(item)
