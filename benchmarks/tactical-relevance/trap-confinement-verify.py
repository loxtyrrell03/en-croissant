"""Independent finite local certificate for public Xg7Rd; requires python-chess.

No engine, classifier, private data or downloads. Every actual defensive reply
is covered, with legal same-square exchanges, maximum off-square liability and
immediate terminal/promotion checks. This is not whole-game evaluation or a
certificate against longer quiet counterplay/repetition.
"""
import json
import chess

FEN = "r3kb1r/2B2ppp/p4n2/n7/6b1/2P1P3/PP1N1PpP/R3KB1R w KQkq - 0 13"
VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
          chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}


def after(board, move):
    assert move in board.legal_moves, (board.fen(), move.uci())
    result = board.copy()
    result.push(move)
    return result


def delta(board, move):
    return (100 if board.is_en_passant(move) else VALUES.get(board.piece_type_at(move.to_square), 0)) + (
        VALUES[move.promotion] - 100 if move.promotion else 0)


def exchange(board, move):
    """Legal, same-square minimax; either side may decline another capture."""
    result = after(board, move)
    return delta(board, move) - max([0] + [exchange(result, reply) for reply in result.legal_moves
                                           if reply.to_square == move.to_square and result.is_capture(reply)])


def retained_capture(board, move):
    result = after(board, move)
    assert not result.is_game_over(claim_draw=True)
    for reply in result.legal_moves:
        assert not reply.promotion
        assert not after(result, reply).is_checkmate()
    off_square = max([0] + [exchange(result, reply) for reply in result.legal_moves
                           if result.is_capture(reply) and reply.to_square != move.to_square])
    return delta(board, move) - max(delta(board, move) - exchange(board, move), off_square)


def verify():
    cases = []
    for mirrored in [False, True]:
        before = chess.Board(FEN)
        if mirrored:
            before = before.mirror()
        assert before.is_valid()
        flip = lambda square: chess.square_mirror(square) if mirrored else square
        move = lambda uci: chess.Move(flip(chess.parse_square(uci[:2])), flip(chess.parse_square(uci[2:])))
        root = after(before, move("f1g2"))
        target = flip(chess.A5)
        # Before the move these two quiet flights evade all immediate captures.
        old_defender = before.copy()
        old_defender.turn = not before.turn
        for flight in ["a5b7", "a5c6"]:
            old_flight = after(old_defender, move(flight))
            assert not any(cap.to_square == move(flight).to_square and exchange(old_flight, cap) >= 100
                           for cap in old_flight.legal_moves)
            new_flight = after(root, move(flight))
            assert exchange(new_flight, chess.Move(flip(chess.G2), move(flight).to_square)) == 320
        branches = []
        for reply in list(root.legal_moves):
            reached = after(root, reply)
            victim = reply.to_square if reply.from_square == target else target
            choices = [cap for cap in reached.legal_moves if cap.to_square == victim]
            retained = [(cap, 100 - delta(root, reply) + retained_capture(reached, cap)) for cap in choices]
            best = max(retained, key=lambda item: item[1]) if retained else None
            kind = "victim"
            if best is None or best[1] < 200:
                unmirrored = chess.Move(flip(reply.from_square), flip(reply.to_square)).uci()
                answers = {"g4f3": "g2f3", "g4h3": "g2h3", "f8b4": "c3b4"}
                assert unmirrored in answers, (root.san(reply), retained)
                answer = move(answers[unmirrored])
                if unmirrored.startswith("g4"):
                    # This moved counterattacker threatens the new flight guard.
                    threat = reached.copy()
                    threat.turn = root.turn
                    assert exchange(threat, chess.Move(reply.to_square, flip(chess.G2))) == 330
                    kind = "counterattacking-flight-guard"
                else:
                    assert reply.to_square in reached.attackers(root.turn, target)
                    kind = "actual-victim-defender"
                best = (answer, 100 - delta(root, reply) + retained_capture(reached, answer))
            assert best[1] >= 200
            branches.append({"reply": reply.uci(), "answer": best[0].uci(), "kind": kind, "localBound": best[1]})
        assert len(branches) == 34
        assert min(branch["localBound"] for branch in branches) == 320
        assert sum(branch["kind"] == "counterattacking-flight-guard" for branch in branches) == 2
        assert sum(branch["kind"] == "actual-victim-defender" for branch in branches) == 1
        removed = before.copy()
        removed.remove_piece_at(flip(chess.D2))
        escaped = after(after(removed, move("f1g2")), move("a5c4"))
        assert not escaped.is_attacked_by(before.turn, flip(chess.C4))
        cases.append({"mirrored": mirrored, "fen": before.fen(), "root": move("f1g2").uci(),
                      "branches": sorted(branches, key=lambda item: item["reply"]),
                      "guardRemoval": {"removed": chess.square_name(flip(chess.D2)), "safeEscape": move("a5c4").uci()}})
    return {"scope": __doc__.strip(), "caseId": "lichess:Xg7Rd", "cases": cases,
            "totalDefences": 68, "minimumLocalBound": 320,
            "initialPawnIncluded": 100, "wholePositionEvaluation": False}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
