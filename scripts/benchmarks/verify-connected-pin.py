"""Independent root coverage and continuation legality, not material arithmetic.

Private owner boards stay in the supplied report; no chess data is embedded.
The audit does not solve the ending or prove safety beyond the recorded leaves.
"""
import argparse
import copy
import json
from pathlib import Path

import chess


def key(board):
    return " ".join(board.fen(en_passant="legal").split()[:4])


def verify(row):
    before = chess.Board(row["fen"])
    move = before.parse_uci(row["move"])
    after = before.copy()
    after.push(move)
    proof = row["proof"]
    ray = proof["ray"]
    assert after.is_pinned(after.turn, ray["front"])
    assert after.king(after.turn) == ray["rear"]
    assert move.to_square == ray["pinner"]
    replies = [after.parse_san(b["reply"]) for b in proof["branches"]]
    assert len(set(replies)) == len(replies)
    assert set(replies) == set(after.legal_moves)
    checked_leaves = 0
    for branch in proof["branches"]:
        child = after.copy()
        reply = child.parse_san(branch["reply"])
        child.push(reply)
        answer = child.parse_san(branch["answer"])
        assert child.parse_uci(branch["answerUci"]) == answer
        target = reply.to_square if reply.from_square == ray["front"] else ray["front"]
        if branch["kind"] == "guard":
            assert answer.to_square == reply.to_square
            assert target in child.attacks(reply.to_square)
            assert ray["front"] not in after.attacks(reply.from_square)
        if branch["kind"] == "countercheck":
            assert child.is_check() and answer.to_square in child.checkers()
        child.push(answer)
        if branch["kind"] == "pinnedCapture":
            recapture = chess.Move(target, answer.to_square)
            assert recapture not in child.legal_moves
            unpinned = child.copy()
            unpinned.remove_piece_at(ray["pinner"])
            assert recapture in unpinned.legal_moves
        if branch["kind"] == "countercapture":
            assert child.is_check()
            leaves = branch["collection"]
            decisions = {key(chess.Board(leaf["fen"])) for leaf in leaves}
            preparations = {key(chess.Board(prep["fen"])): prep
                            for leaf in leaves for prep in leaf.get("preparations", [])}
            for evasion in child.legal_moves:
                reached = child.copy()
                reached.push(evasion)
                if key(reached) not in decisions:
                    prep = preparations[key(reached)]
                    reached.push(reached.parse_uci(prep["moveUci"]))
                    assert reached.is_check()
                    for second in reached.legal_moves:
                        leaf_board = reached.copy()
                        leaf_board.push(second)
                        assert key(leaf_board) in decisions
            for leaf in leaves:
                reached = chess.Board(leaf["fen"])
                reached.push(reached.parse_uci(leaf["moveUci"]))
                for check in leaf.get("counterchecks", []):
                    checked = chess.Board(check["fen"])
                    assert checked.is_check()
                    checked.push(checked.parse_uci(check["moveUci"]))
                checked_leaves += 1
    return {"id": row["id"], "root_replies": len(replies), "recovery_leaves": checked_leaves}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    rows = [row for row in json.loads(args.report.read_text(encoding="utf-8"))["cases"] if row["proof"]]
    results = [verify(row) for row in rows]
    assert results
    for row in rows:
        incomplete = copy.deepcopy(row)
        incomplete["proof"]["branches"].pop()
        try:
            verify(incomplete)
        except AssertionError:
            continue
        raise AssertionError("An omitted legal root reply was accepted")
    print(json.dumps({"cases": results, "omitted_reply_rejected": True}))
