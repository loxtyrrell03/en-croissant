import unittest

import chess

from ray_review import aligned_after_reply, payments, prefix


class RayReviewTest(unittest.TestCase):
    def test_later_pawn_capture_does_not_pay_for_recaptured_bishop(self):
        fen = "3rr3/2q2pkp/2b3p1/2N1p3/1P1p1n2/1BP2P2/4Q1PP/3RR1K1 w - - 1 27"
        root = chess.Board(fen)
        moves = "e2c4 c6d5 c4f1 d5b3 c5b3 c7c3 b3c5".split()
        ray = chess.D5
        targets = (chess.C4, chess.B3)
        self.assertEqual(list(payments(root, moves, ray, targets)), [(chess.B3, 7, "d5b3")])
        self.assertEqual(list(payments(root, moves, ray, targets, require_local_exchange=True)), [])

    def test_exchange_loss_survives_immediate_rook_recapture(self):
        fen = "r3r2k/b1pq1pp1/p1n3bp/1p2p3/1P2Nn2/PBPP1N1P/1BQ2PP1/R3R1K1 w - - 5 19"
        root = chess.Board(fen)
        moves = "e1d1 g6h5 f3e1 a8d8 e4g3 h5d1 a1d1".split()
        after_move = prefix(root, moves[:1])
        targets = (chess.F3, chess.D1)
        self.assertEqual(aligned_after_reply(after_move, chess.D1, chess.Move.from_uci(moves[1])), [targets])
        self.assertEqual(list(payments(root, moves, chess.H5, targets, require_local_exchange=True)),
                         [(chess.D1, 7, "h5d1")])

    def test_original_target_must_still_be_on_the_ray(self):
        root = chess.Board("r3r2k/b1pq1pp1/p1n3bp/1p2p3/1P2Nn2/PBPP1N1P/1BQ2PP1/R3R1K1 w - - 5 19")
        after_better = prefix(root, ["d3d4"])
        self.assertEqual(aligned_after_reply(after_better, chess.F3, chess.Move.from_uci("g6h5")), [])


if __name__ == "__main__":
    unittest.main()
