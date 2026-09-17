"""Independent legality/geometry audit, not a material or best-play proof.

Consumes a private preparation audit without publishing any input positions.
The five-ply countercapture coverage check is intentionally restricted to
one legal evasion followed by the recorded capture and immediate countercheck.
"""
import argparse
import copy
import json
from pathlib import Path

import chess


def key(board):
    return " ".join(board.fen(en_passant="legal").split()[:4])


def verify(row):
    proof = row["proof"]
    before = chess.Board(row["fen"])
    root = chess.Move.from_uci(row["move"])
    assert root in before.legal_moves
    offered = before.copy()
    offered.push(root)
    branches = proof["branches"] + proof["declined"] + proof.get("otherCaptures", [])
    replies = [offered.parse_san(b["reply"]) for b in branches]
    assert len(set(replies)) == len(replies)
    assert set(replies) == set(offered.legal_moves)
    rays = 0
    leaves = 0
    for branch in branches:
        child = offered.copy()
        reply = child.parse_san(branch["reply"])
        child.push(reply)
        answer = child.parse_san(branch["answer"])
        prepared = child.copy()
        prepared.push(answer)
        ray = branch.get("clearedForkRay")
        if ray:
            rays += 1
            blocker, square, target = ray["blocker"], ray["forkSquare"], ray["target"]
            assert reply.from_square == blocker and reply.to_square == root.to_square
            assert answer.to_square == square and prepared.is_check()
            assert before.piece_at(target) == prepared.piece_at(target)
            assert target in prepared.attacks(square)
            blocked = prepared.copy()
            blocked.set_piece_at(blocker, before.piece_at(blocker))
            assert target not in blocked.attacks(square)
        recovery = branch.get("checkingExchange", [])
        if recovery:
            assert prepared.is_check() and answer.from_square == root.to_square
            legal_leaves = {}
            for evasion in prepared.legal_moves:
                leaf = prepared.copy()
                leaf.push(evasion)
                legal_leaves[key(leaf)] = leaf
            assert {key(chess.Board(leaf["fen"])) for leaf in recovery} == set(legal_leaves)
            for leaf in recovery:
                reached = legal_leaves[key(chess.Board(leaf["fen"]))]
                capture = chess.Move.from_uci(leaf["moveUci"])
                assert capture in reached.legal_moves and capture.to_square == reply.to_square
                reached.push(capture)
                checks = {}
                for resource in reached.legal_moves:
                    checked = reached.copy()
                    checked.push(resource)
                    if checked.is_check():
                        checks[key(checked)] = checked
                assert {key(chess.Board(c["fen"])) for c in leaf.get("counterchecks", [])} == set(checks)
                for check in leaf.get("counterchecks", []):
                    checked = checks[key(chess.Board(check["fen"]))]
                    assert chess.Move.from_uci(check["moveUci"]) in checked.legal_moves
                leaves += 1
    return {"id": row["id"], "root_replies": len(replies), "cleared_rays": rays, "recovery_leaves": leaves}


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
        raise AssertionError("An omitted root reply was accepted")
    print(json.dumps({"cases": results, "omitted_reply_rejected": True}))
