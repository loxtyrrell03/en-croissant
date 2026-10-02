"""Tiny independent chess proof. Requires python-chess; no engine or corpus.

Enumerates every attacker move after Qh6+ Kg8 and every legal reply until
mate-in-one. This adjudicates the claimed mate-in-three bound, NOT all longer
winning possibilities. Histories are constructed around an existing public
fixture; source labels and production-classifier output are not used as gold.
"""
import json
import chess

ORIGIN = "2R3k1/5r2/4NppQ/8/3n4/5P2/PP2q1P1/1K6 b - - 0 1"
REPEATED = "f7f8 c8c1 f8f7 c1c8 f7f8 h6e3 g8h7 c8c1 f8f7".split()
CLEAN = "f7f8 c8c2 f8f7 c2c3 f7f8 h6e3 g8h7 c3c1 f8f7".split()


def audit(mirror, alternate, repeated):
    origin = ORIGIN.replace("5P2", "1R3P2") if alternate else ORIGIN
    board = chess.Board(origin)
    if mirror:
        board = board.mirror()

    def move(uci):
        return "".join(str(9 - int(c)) if c.isdigit() else c for c in uci) if mirror else uci

    def play(uci):
        candidate = chess.Move.from_uci(move(uci))
        assert candidate in board.legal_moves, (uci, board.fen())
        board.push(candidate)

    history_origin = board.fen()
    history_moves = REPEATED if repeated else CLEAN
    for uci in history_moves:
        assert not board.is_fivefold_repetition()
        play(uci)
    root = board.fen()
    play("e3h6")
    assert not board.can_claim_threefold_repetition()
    replies = sorted(m.uci() for m in board.legal_moves)
    assert replies == sorted([move("h7h6"), move("h7g8")])
    play("h7h6")
    play("c1h1")
    assert board.is_checkmate()
    board.pop()
    board.pop()
    play("h7g8")
    candidates = list(board.legal_moves)
    checked_mating_moves = 0
    winning = []
    for candidate in candidates:
        board.push(candidate)
        proved = board.is_checkmate()
        if not proved and not board.can_claim_threefold_repetition() and not board.is_game_over():
            defences = list(board.legal_moves)
            proved = bool(defences)
            for defence in defences:
                board.push(defence)
                mate = False
                if not board.is_fivefold_repetition() and not board.is_seventyfive_moves():
                    for answer in list(board.legal_moves):
                        checked_mating_moves += 1
                        board.push(answer)
                        mate = board.is_checkmate()
                        board.pop()
                        if mate:
                            break
                board.pop()
                if not mate:
                    proved = False
                    break
        board.pop()
        if proved:
            winning.append(candidate.uci())
    play("c1c8")
    assert board.is_repetition(3) == repeated
    board.pop()
    # The distance-three refutation is NOT a refutation of the win. Verify a
    # separate legal capture-reset route independently, with every defence.
    play("h6g6")
    assert board.halfmove_clock == 0
    capture_defences = sorted(m.uci() for m in board.legal_moves)
    continuation_visits = 0

    def attack(remaining):
        nonlocal continuation_visits
        if remaining <= 0 or board.is_game_over():
            return False
        for answer in list(board.legal_moves):
            continuation_visits += 1
            assert continuation_visits <= 65536
            board.push(answer)
            won = defend(remaining - 1)
            board.pop()
            if won:
                return True
        return False

    def defend(remaining):
        nonlocal continuation_visits
        if board.is_checkmate():
            return True
        if remaining <= 0 or board.is_game_over() or board.can_claim_threefold_repetition():
            return False
        replies = list(board.legal_moves)
        for reply in replies:
            continuation_visits += 1
            assert continuation_visits <= 65536
            board.push(reply)
            won = attack(remaining)
            board.pop()
            if not won:
                return False
        return bool(replies)

    assert defend(2), "Qxg6+ must independently force mate within two further attacking moves"
    expected = ([move("b3b8")] if alternate else []) + ([] if repeated else [move("c1c8")])
    assert sorted(winning) == sorted(expected), (winning, expected)
    return {"mirrored": mirror, "alternativeRook": alternate, "repeated": repeated,
            "history": {"fen": history_origin, "moves": [move(u) for u in history_moves]},
            "rootFen": root, "rootReplies": replies, "immediateDefenderClaim": False,
            "Rc8CreatesThirdOccurrence": repeated,
            "legalAttackerChoices": len(candidates), "mateMoveVisits": checked_mating_moves,
            "winningMovesWithinTwoMoreMoves": sorted(winning),
            "safeMateWithinFourViaCaptureReset": True, "captureResetMove": move("h6g6"),
            "captureDefences": capture_defences, "captureContinuationVisits": continuation_visits}


if __name__ == "__main__":
    print(json.dumps({"engineUsed": False, "pythonChessVersion": chess.__version__,
                      "scope": "fixed mate-in-three bound; no all-distance verdict",
                      "rows": [audit(m, a, r) for m in [False, True]
                               for a in [False, True] for r in [True, False]]}, indent=2))
