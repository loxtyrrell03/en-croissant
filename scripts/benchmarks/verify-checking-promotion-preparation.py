"""Independent legal-tree checks for the opt-in promotion-check prototype.

This checks all reply coverage, lawful check evasions, same-pawn promotion and
pre-promotion material accounting. It does not prove the retained material
inside a promotion leaf or certify a full-position outcome.
"""
import copy
import json
import sys

import chess

VALUE = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
         chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 20000}


def delta(board, move):
    captured = board.piece_type_at(move.to_square)
    return (100 if board.is_en_passant(move) else VALUE.get(captured, 0)) + (
        VALUE[move.promotion] - 100 if move.promotion else 0)


def verify(row, attempt):
    board = chess.Board(row["fen"])
    assert board.is_valid()
    root = chess.Move.from_uci(row["move"])
    assert root in board.legal_moves and not board.is_capture(root) and not root.promotion
    assert board.piece_type_at(root.from_square) == chess.PAWN
    side = board.turn
    board.push(root)
    counts = {"defender_nodes": 0, "replies": 0, "evasions": 0, "promotions": 0}

    def walk(position, branches, balance, depth):
        assert not position.is_game_over(claim_draw=True)
        assert position.turn != side
        assert len(branches) == len({b["replyUci"] for b in branches})
        assert {b["replyUci"] for b in branches} == {m.uci() for m in position.legal_moves}
        counts["defender_nodes"] += 1
        counts["replies"] += len(branches)
        gains = []
        for branch in branches:
            current = position.copy()
            reply = chess.Move.from_uci(branch["replyUci"])
            next_balance = balance - delta(current, reply)
            current.push(reply)
            # Chessops omits unusable EP squares after some double pushes.
            # Normalize only that non-actionable field; legal EP, clocks,
            # placement, turn and castling identity must still match exactly.
            assert current.fen(en_passant="legal") == chess.Board(branch["fen"]).fen(en_passant="legal")
            assert not current.is_game_over(claim_draw=True)
            assert current.piece_at(root.to_square) == chess.Piece(chess.PAWN, side)
            if branch.get("promotionUci"):
                promotion = chess.Move.from_uci(branch["promotionUci"])
                assert promotion in current.legal_moves and promotion.promotion
                assert promotion.from_square == root.to_square
                assert not branch.get("evasionUci") and not branch.get("branches")
                gain = min(branch["promotionGain"], next_balance + branch["promotionGain"])
                current.push(promotion)
                assert not current.is_stalemate() and not current.is_insufficient_material()
                counts["promotions"] += 1
            else:
                assert depth > 0 and current.is_check()
                evasion = chess.Move.from_uci(branch["evasionUci"])
                assert evasion in current.legal_moves
                assert evasion.from_square != root.to_square and not evasion.promotion
                next_balance += delta(current, evasion)
                current.push(evasion)
                counts["evasions"] += 1
                gain = walk(current, branch["branches"], next_balance, depth - 1)
            assert gain == branch["gain"] and gain >= 100
            gains.append(gain)
        return min(gains)

    assert walk(board, attempt["branches"], 0, attempt["depth"]) == attempt["gain"]
    return counts


results = []
for filename in sys.argv[1:]:
    with open(filename, encoding="utf-8") as source:
        report = json.load(source)
    for row in report["cases"]:
        attempt = next((a for a in row["attempts"] if a["branches"]), None)
        if not attempt:
            continue
        result = verify(row, attempt)
        # Both root and inner missing replies must be rejected.
        for nested in (False, True):
            broken = copy.deepcopy(attempt)
            branches = broken["branches"]
            if nested:
                branches = next(b["branches"] for b in branches if b.get("branches"))
            branches.pop()
            try:
                verify(row, broken)
            except AssertionError:
                pass
            else:
                raise AssertionError("Incomplete defender coverage was accepted")
        results.append({"id": row["id"], **result})
assert results, "No completed prototype trees found"
print(json.dumps({"certificates": results, "scope": "Legal-tree coverage and entry accounting only; promotion-leaf retention and full outcomes remain separate."}))
