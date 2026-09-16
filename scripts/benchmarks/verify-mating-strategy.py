"""Independently validate exported AND/OR mate strategies using python-chess.

Read a private/public report from stdin; emit counts only, never owner positions.
The report is evidence to check, not trusted assertions or executable input.
"""
import json
import sys
import chess


def verify_case(row):
    proof = row.get("proof")
    if not proof or not proof.get("strategy"):
        return None
    board = chess.Board(row["fen"])
    root = board.parse_uci(row["pvUci"][0])
    assert root in board.legal_moves and not board.is_game_over()
    board.push(root)
    visited = 0
    leaves = 0

    def inspect(node, remaining):
        nonlocal visited, leaves
        visited += 1
        expected = chess.Board(node["fen"])
        assert board.fen(en_passant="legal") == expected.fen(en_passant="legal")
        replies = node["replies"]
        if not replies:
            assert board.is_checkmate()
            leaves += 1
            return 0
        assert remaining > 0 and not board.is_game_over()
        assert not board.can_claim_fifty_moves()
        assert not board.can_claim_threefold_repetition()
        declared = [board.parse_uci(branch["move"]) for branch in replies]
        assert len(set(declared)) == len(declared)
        assert set(declared) == set(board.legal_moves)
        longest = 0
        for branch, reply in zip(replies, declared):
            board.push(reply)
            assert not board.is_game_over()
            answer = board.parse_uci(branch["answer"])
            assert answer in board.legal_moves
            board.push(answer)
            longest = max(longest, 1 + inspect(branch["next"], remaining - 1))
            board.pop()
            board.pop()
        return longest

    length = 1 + inspect(proof["strategy"], proof["maxMoves"] - 1)
    assert length <= proof["maxMoves"]
    return {"id": row.get("id", f"owner-ply-{row.get('ply')}-{row['pvUci'][0]}"),
            "maxMoves": length, "defensiveNodes": visited, "matedLeaves": leaves}


report = json.load(sys.stdin)
verified = [result for row in report["cases"] if (result := verify_case(row))]
assert verified, "No strategies supplied"
print(json.dumps({"verified": verified, "count": len(verified)}, indent=2))
