"""Independently check promotion-retention strategies with python-chess.

JSON comes from stdin; it is data, never code. The certificate covers immediate
captures and every continuing check, not arbitrary quiet plans or a won game.
"""
import json
import sys
from functools import lru_cache
import chess

VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
          chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}


def position_key(board):
    return " ".join(board.fen(en_passant="legal").split()[:4])


def move_gain(board, move):
    victim = board.piece_at(move.to_square)
    gain = 100 if board.is_en_passant(move) else VALUES[victim.piece_type] if victim else 0
    return gain + (VALUES[move.promotion] - 100 if move.promotion else 0)


@lru_cache(maxsize=16384)
def exchange(fen, target):
    board = chess.Board(fen)
    best = 0
    for move in board.legal_moves:
        if move.to_square != target or not board.is_capture(move):
            continue
        gain = move_gain(board, move)
        board.push(move)
        best = max(best, gain - exchange(board.fen(), target))
        board.pop()
    return best


def verify(row):
    board = chess.Board(row["fen"])
    side = board.turn
    root = board.parse_uci(row["move"])
    assert root in board.legal_moves and root.promotion
    initial = sum(VALUES[p.piece_type] * (1 if p.color == side else -1)
                  for p in board.piece_map().values())
    board.push(root)
    required = row["proof"]["gain"]
    assert required > 0
    decisions = {}
    for entry in row["proof"]["counterchecks"]:
        key = position_key(chess.Board(entry["fen"]))
        decisions.setdefault(key, set()).add(entry["moveUci"])
    path = set()
    visited = leaves = cycles = 0

    def inspect(promoted, remaining):
        nonlocal visited, leaves, cycles
        visited += 1
        assert visited <= 200000, "Independent audit bound exceeded"
        if board.is_checkmate():
            return True  # The opponent to move is mated.
        if board.is_stalemate() or board.is_insufficient_material():
            return False
        assert board.turn != side
        if board.piece_at(promoted) != chess.Piece(root.promotion, side):
            return False
        balance = sum(VALUES[p.piece_type] * (1 if p.color == side else -1)
                      for p in board.piece_map().values()) - initial
        loss = 0
        legal = list(board.legal_moves)
        for reply in legal:
            if reply.promotion:
                return False
            if board.is_capture(reply):
                if reply.to_square == promoted:
                    return False
                gain = move_gain(board, reply)
                board.push(reply)
                loss = max(loss, gain - exchange(board.fen(), reply.to_square))
                board.pop()
        if balance - loss < required:
            return False
        key = (position_key(board), promoted)
        if key in path:
            cycles += 1
            return True  # Same material retained; this is not a win claim.
        if not remaining:
            return False
        path.add(key)
        checking = 0
        try:
            for reply in legal:
                if not board.gives_check(reply):
                    continue
                checking += 1
                board.push(reply)
                if board.is_checkmate():
                    board.pop()
                    return False
                supported = False
                for uci in sorted(decisions.get(position_key(board), [])):
                    answer = chess.Move.from_uci(uci)
                    if answer not in board.legal_moves:
                        continue
                    next_promoted = answer.to_square if answer.from_square == promoted else promoted
                    board.push(answer)
                    supported = inspect(next_promoted, remaining - 1)
                    board.pop()
                    if supported:
                        break
                board.pop()
                if not supported:
                    return False
            if not checking:
                leaves += 1
            return True
        finally:
            path.remove(key)

    assert inspect(root.to_square, 8), row["id"]
    return {"id": row["id"], "gain": required, "nodes": visited,
            "leaves": leaves, "cycles": cycles}


data = json.load(sys.stdin)
results = [verify(row) for row in data["records"]]
assert results
print(json.dumps({"verified": len(results), "results": results}, indent=2))
