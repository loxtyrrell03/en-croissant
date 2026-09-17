"""Independently check complete reply coverage and promotion legality.

Reads explicit development receipts only. This verifies geometry and coverage
with python-chess, not the TypeScript retention arithmetic or an exact outcome.
"""
import copy
import json
import sys

import chess


def verify(row):
    board = chess.Board(row["fen"])
    assert board.is_valid()
    move = chess.Move.from_uci(row["move"])
    assert move in board.legal_moves
    assert board.piece_type_at(move.from_square) == chess.PAWN
    assert not board.is_capture(move) and not move.promotion
    pawn_side = board.turn
    board.push(move)
    assert chess.square_rank(move.to_square) == (6 if pawn_side else 1)
    branches = row["threat"]["branches"]
    assert len(branches) == len({branch["replyUci"] for branch in branches})
    assert {branch["replyUci"] for branch in branches} == {reply.uci() for reply in board.legal_moves}
    assert row["threat"]["gain"] == min(branch["gain"] for branch in branches)
    for branch in branches:
        position = board.copy()
        position.push_uci(branch["replyUci"])
        assert position.fen(en_passant="fen") == branch["fen"]
        promotion = chess.Move.from_uci(branch["promotionUci"])
        assert promotion in position.legal_moves and promotion.promotion
        assert promotion.from_square == move.to_square
        assert position.piece_at(move.to_square) == chess.Piece(chess.PAWN, pawn_side)
        position.push(promotion)
        assert not position.is_stalemate() and not position.is_insufficient_material()
        assert branch["gain"] >= 100


certificates = []
for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as source:
        report = json.load(source)
    certificates.extend(row for row in report.get("certificates", report.get("cases", [])) if row.get("threat"))
assert certificates, "No certificates supplied"
for certificate in certificates:
    verify(certificate)
    broken = copy.deepcopy(certificate)
    broken["threat"]["branches"].pop()
    try:
        verify(broken)
    except AssertionError:
        pass
    else:
        raise AssertionError("Incomplete reply coverage was accepted")
print(json.dumps({"certificates": len(certificates), "legal_replies": sum(len(row["threat"]["branches"]) for row in certificates),
                  "scope": "Independent geometry and exact reply coverage, not material arithmetic or an exact ending solution."}))
