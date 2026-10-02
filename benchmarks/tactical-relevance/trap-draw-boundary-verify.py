"""Independent legal clock witnesses; no engine or production classifier.

FSJC4's original root clock is zero. Changed clocks and the added captured pawn
are constructed controls, not claims about the public game's actual history.
The pawn trap is a separate tiny constructed position. This verifies draw rights
and move legality, not full-position evaluations or population accuracy.
"""
import json
import chess

SOURCE = "6k1/2q2pp1/Q1pb3p/3b4/2PP3B/4rP2/P2N2P1/R6K b - - 0 30"


def verify():
    records = []
    for reflected in [False, True]:
        def flip(uci):
            move = chess.Move.from_uci(uci)
            return chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square)) if reflected else move

        def board_at(fen, clock):
            board = chess.Board(fen)
            if reflected:
                board = board.mirror()
            board.halfmove_clock = clock
            assert board.is_valid()
            return board

        def play(board, uci):
            move = flip(uci)
            assert move in board.legal_moves, (board.fen(), uci)
            child = board.copy()
            child.push(move)
            return child

        for clock in [0, 97, 98, 99, 149, 150]:
            board = board_at(SOURCE, clock)
            after = play(board, "e3a3")
            announced = play(after, "a1b1")
            assert after.turn != board.turn
            assert after.halfmove_clock == clock + 1
            assert after.can_claim_fifty_moves() == (clock >= 98)
            assert after.is_fifty_moves() == (clock >= 99)
            assert after.is_seventyfive_moves() == (clock >= 149)
            assert board.is_seventyfive_moves() == (clock >= 150)
            assert announced.halfmove_clock == clock + 2
            # At root97, the later claim belongs to the ATTACKER, who can
            # choose a resetting capture instead. Do not swap beneficiaries.
            assert announced.turn == board.turn
            capture = play(announced, "a3a6")
            assert capture.halfmove_clock == 0
            records.append({"kind": "quiet-trap", "reflected": reflected, "clock": clock,
                "defender": "white" if after.turn else "black",
                "defenderCanClaim": after.can_claim_fifty_moves(),
                "defenderCurrentClaim": after.is_fifty_moves(),
                "automaticAfterRoot": after.is_seventyfive_moves(),
                "automaticBeforeRoot": board.is_seventyfive_moves(),
                "announcedQuietReply": flip("a1b1").uci(),
                "attackerClaimAfterReply": announced.can_claim_fifty_moves()})
        for kind, fen, root in [
            ("capture-reset", SOURCE.replace("4rP2", "P3rP2"), "e3a3"),
            ("pawn-reset", "k7/8/8/6p1/7b/8/6PP/7K w - - 0 1", "g2g3"),
        ]:
            for clock in [99, 149, 150]:
                board = board_at(fen, clock)
                after = play(board, root)
                assert after.halfmove_clock == 0
                assert not after.can_claim_fifty_moves()
                assert board.is_seventyfive_moves() == (clock == 150)
                records.append({"kind": kind, "reflected": reflected, "clock": clock,
                    "reset": after.halfmove_clock, "legalGameContinuation": clock < 150})
        mate = play(board_at("7k/8/5KQ1/8/8/8/8/8 w - - 149 1", 149), "g6g7")
        assert mate.halfmove_clock == 150 and mate.is_checkmate()
        assert not mate.is_seventyfive_moves()
        assert mate.outcome().termination == chess.Termination.CHECKMATE
        records.append({"kind": "mate-precedence", "reflected": reflected, "clock": 150,
            "termination": "CHECKMATE"})
    return {"scope": "Independent python-chess legal draw-boundary witnesses", "records": records}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
