"""Independent, tiny legal-history audit. No engine or owner data.

python continuation-history-audit.py [NEW_OUTPUT_JSON]
Constructed paired histories do not estimate population accuracy.
"""
import json
import sys
import chess

ORIGIN = "q3k3/8/8/1N6/8/8/P6K/8 w - - 0 1"
CYCLE = "b5c7 e8f8 c7b5 f8e8".split()
CLEAN = "b5c3 e8f8 c3e4 f8e8 e4c3 e8f8 c3b5 f8e8".split()
APPROACH = "b5d6 e8f8 d6f5 f8g8 f5d4 g8f8".split()
LINE = "d4e6 f8e8 e6c7 e8d7 c7a8".split()


def audit(mirrored, repeated):
    board = chess.Board(ORIGIN)
    if mirrored:
        board = board.mirror()

    def move(uci):
        return chess.Move.from_uci("".join(str(9-int(c)) if c.isdigit() else c for c in uci) if mirrored else uci)

    def play(uci):
        candidate = move(uci)
        assert candidate in board.legal_moves, (uci, board.fen())
        assert not board.is_game_over()
        board.push(candidate)

    for uci in (CYCLE * 2 if repeated else CLEAN) + APPROACH:
        play(uci)
    root = board.fen()
    play(LINE[0])
    assert not board.can_claim_threefold_repetition()
    play(LINE[1])
    # This optional claim belongs to the attacker, not the defender.
    assert board.can_claim_threefold_repetition() == repeated
    alternative = move("e6c5")
    assert alternative in board.legal_moves
    board.push(alternative)
    assert not board.can_claim_threefold_repetition()
    board.pop()
    play(LINE[2])
    assert board.is_repetition(3) == repeated
    assert board.can_claim_threefold_repetition() == repeated
    replies = sorted(m.uci() for m in board.legal_moves)
    for reply in replies:
        board.push_uci(reply)
        capture = move("c7a8")
        assert capture in board.legal_moves
        assert board.piece_at(capture.to_square).piece_type == chess.QUEEN
        board.push(capture)
        assert not board.is_attacked_by(board.turn, capture.to_square)
        assert not board.is_insufficient_material()
        board.pop()
        board.pop()
    return {"mirrored": mirrored, "repeated": repeated, "rootFen": root,
            "defenderClaimAtPly": 3 if repeated else None,
            "allLegalForkReplies": replies, "queenCaptureSafeAfterEveryReply": True,
            "safeLocalAlternativeHasNoClaim": True}


rows = [audit(mirror, repeated) for mirror in [False, True] for repeated in [False, True]]
for index in [0, 2]:
    assert rows[index]["rootFen"] == rows[index+1]["rootFen"]
result = {"schema": 1, "chessVersion": chess.__version__, "cases": rows,
          "scope": "Four paired constructed histories, not four independently sampled positions or a whole-position winning proof"}
output = json.dumps(result, indent=2) + "\n"
if len(sys.argv) > 1:
    with open(sys.argv[1], "x", encoding="utf-8") as handle:
        handle.write(output)
else:
    print(output, end="")
