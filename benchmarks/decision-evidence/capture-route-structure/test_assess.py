"""Legal regression fixtures for the capture-route experiment."""

import unittest

import chess

from assess import line_end, material, pawn_edges, reaches


POSITION = "2r5/1p3k2/p1n1p3/P2R1p1p/5P1P/1PK5/2N3P1/4R3 b - - 0 40"
CHECKING_ROUTE = "c6e7 c3b2 e7d5 g2g3 c8g8 c2d4 g8g3".split()
DIRECT_ROUTE = "e6d5 c2d4 c6a5 c3b4 a5c6 d4c6 c8c6".split()


class CaptureRouteTest(unittest.TestCase):
    def setUp(self):
        self.board = chess.Board(POSITION)

    def test_original_target_can_interpose(self):
        self.assertTrue(reaches(self.board, CHECKING_ROUTE, chess.D5))
        self.assertTrue(reaches(self.board, ["c6e7", "d5c5", "c8c5"], chess.D5))
        self.assertFalse(reaches(self.board, ["c6e7", "c3b2", "e7d5"], chess.A5))

    def test_pawn_support_is_independent_of_taking_the_rook(self):
        self.assertIn((chess.E6, chess.F5), pawn_edges(self.board, chess.E6))
        self.assertIsNotNone(line_end(self.board, CHECKING_ROUTE, (chess.E6, chess.F5)))
        self.assertIsNone(line_end(self.board, DIRECT_ROUTE, (chess.E6, chess.F5)))

    def test_finish_the_pending_recapture_without_extending_other_moves(self):
        fixed = line_end(self.board, DIRECT_ROUTE)
        finished = line_end(self.board, DIRECT_ROUTE, settle=True)
        self.assertEqual(material(fixed, chess.BLACK), -2)
        self.assertEqual(material(finished, chess.BLACK), 1)
        self.assertEqual(line_end(self.board, CHECKING_ROUTE, settle=True).ply(), self.board.ply() + 6)


if __name__ == "__main__":
    unittest.main()
