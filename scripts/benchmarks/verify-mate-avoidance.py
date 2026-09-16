"""Independently replay finite mate-avoidance DAGs with python-chess.

Reads JSON on stdin. Does not contact an engine, alter games or certify
longer-horizon safety. Final attacking plies enumerate every legal move,
independently of the TypeScript checking-move nomination optimisation.
"""
import json
import sys

import chess


def verify(case):
    proof = case["proof"]
    strategy = proof["strategy"]
    nodes = strategy["nodes"]
    attacker = strategy["attacker"] == "white"
    root = chess.Board(case["rootFen"])
    assert root.is_valid()
    entry = chess.Move.from_uci(case["entry"])
    assert root.is_legal(entry)
    root.push(entry)
    capture = chess.Move.from_uci(proof["move"])
    assert root.is_legal(capture) and root.is_capture(capture)
    assert capture.to_square == entry.to_square
    root.push(capture)
    assert root.fen(en_passant="legal") == chess.Board(nodes[strategy["start"]]["fen"]).fen(en_passant="legal")
    assert nodes[strategy["start"]]["remaining"] == proof["maxMoves"] - 1
    seen = set()
    final_moves = 0

    def walk(key):
        nonlocal final_moves
        if key in seen:
            return
        seen.add(key)
        node = nodes[key]
        board = chess.Board(node["fen"])
        assert board.is_valid()
        assert not board.is_checkmate() or board.turn == attacker
        remaining = node["remaining"]
        assert isinstance(remaining, int) and 0 <= remaining < proof["maxMoves"]
        if board.is_game_over() or remaining == 0:
            assert not node.get("children")
            return
        legal = list(board.legal_moves)
        if board.turn == attacker and remaining == 1:
            assert not node.get("children")
            for move in legal:
                child = board.copy()
                child.push(move)
                assert not child.is_checkmate(), (case["id"], node["fen"], move.uci())
                final_moves += 1
            return
        children = node["children"]
        if board.turn == attacker:
            assert sorted(c["move"] for c in children) == sorted(m.uci() for m in legal)
        else:
            assert len(children) == 1
        for child in children:
            move = chess.Move.from_uci(child["move"])
            assert board.is_legal(move)
            after = board.copy()
            after.push(move)
            next_node = nodes[child["next"]]
            assert chess.Board(next_node["fen"]).fen(en_passant="legal") == after.fen(en_passant="legal")
            assert next_node["remaining"] == remaining - int(board.turn == attacker)
            walk(child["next"])

    walk(strategy["start"])
    assert len(seen) == len(nodes)
    return {"id": case["id"], "nodes": len(seen), "final_moves": final_moves}


if __name__ == "__main__":
    print(json.dumps({"verified": [verify(case) for case in json.load(sys.stdin)["cases"]]}))
