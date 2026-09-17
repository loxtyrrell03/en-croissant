"""Independently replay the narrow, single-reply perpetual and deflection witness.

Consumes the private audit JSON, never stores or publishes its position. This
checks legality, exact root-reply coverage and removal of the checking piece;
it deliberately does not certify the TypeScript material bound or an endgame win.
"""
import argparse
import json
from pathlib import Path

import chess


def verify(data):
    proof = data["defensiveProof"]
    board = chess.Board(data["fen"])
    root = board.parse_san(data["root"])
    target, guard = proof["target"], proof["guard"]
    victim = board.piece_at(target)
    assert victim and board.piece_at(guard) == chess.Piece(chess.KING, victim.color)
    assert target in board.attacks(guard)
    offered = board.copy()
    offered.push(root)
    branches = proof["branches"]
    assert len({b["replyUci"] for b in branches}) == len(branches)
    assert {b["replyUci"] for b in branches} == {m.uci() for m in offered.legal_moves}
    for branch in branches:
        child = offered.copy()
        reply = chess.Move.from_uci(branch["replyUci"])
        assert reply.from_square == guard
        child.push(reply)
        assert target not in child.attacks(reply.to_square)
        capture = chess.Move.from_uci(branch["captureUci"])
        assert capture in child.legal_moves and capture.to_square == target
        assert child.piece_at(target) == victim
        child.push(capture)
        assert all(p.color != victim.color or p.piece_type in (chess.KING, chess.PAWN)
                   for p in child.piece_map().values())
    cycle_board = chess.Board(data["passFen"])
    attacker = cycle_board.turn
    checker = target
    seen = set()
    closed = False
    for san in proof["perpetual"]["line"]:
        move = cycle_board.parse_san(san)
        if cycle_board.turn == attacker:
            assert move.from_square == checker
            checker = move.to_square
        else:
            # The report contains one line, not a branching strategy. This
            # verifier must refuse it if another defensive choice was omitted.
            assert list(cycle_board.legal_moves) == [move]
        cycle_board.push(move)
        if cycle_board.turn != attacker:
            assert cycle_board.is_check()
            key = " ".join(cycle_board.fen(en_passant="legal").split()[:4])
            closed |= key in seen
            seen.add(key)
    assert closed
    return {"root_replies": len(branches), "cycle_plies": len(proof["perpetual"]["line"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    data = json.loads(args.report.read_text(encoding="utf-8"))
    result = verify(data)
    broken = dict(data, defensiveProof=dict(data["defensiveProof"], branches=[]))
    try:
        verify(broken)
    except AssertionError:
        result["missing_branch_rejected"] = True
    else:
        raise AssertionError("Incomplete certificate was accepted")
    print(json.dumps(result))
