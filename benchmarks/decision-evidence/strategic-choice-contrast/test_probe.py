import unittest

import chess

from probe import deferred_plan, strategy


class ProbeTests(unittest.TestCase):
    def test_file_family_includes_quiet_retained_file_entries(self):
        board = chess.Board("8/8/8/4r3/6R1/4p2p/4K2k/8 w - - 0 62")
        family = strategy(board, board.parse_san("Rg7"))
        self.assertEqual(family, ("rook-file", chess.FILE_NAMES.index("g")))
        for move in ("Rg6", "Rg8"):
            with self.subTest(move=move):
                self.assertEqual(strategy(board, board.parse_san(move)), family)
        self.assertIsNone(strategy(board, board.parse_san("Kf1")))
        self.assertIsNone(strategy(board, board.parse_san("Rg5")))
        self.assertIsNone(strategy(board, board.parse_san("Rg2+")))

    def test_blocked_pawn_does_not_count_as_passed(self):
        board = chess.Board("7k/5p2/8/5P2/8/8/8/K7 w - - 0 1")
        self.assertIsNone(strategy(board, board.parse_san("f6")))

    def test_deferral_tracks_same_original_passed_pawn(self):
        board = chess.Board("8/6k1/4b2p/4p3/P1pqP1pP/6P1/2Q1B1K1/8 b - - 2 43")
        san = "Kf6 a5 c3 a6 Bc8 Kf1 Bd7 Bd3 Kg7 a7 Qxa7 Qxc3".split()
        reached = board.copy()
        moves = [reached.push_san(text).uci() for text in san]
        result = deferred_plan(board, "c4c3", moves, ("passer", chess.C4))
        self.assertEqual(result, {"ply": 3, "move": "c4c3", "retained": True})


if __name__ == "__main__":
    unittest.main()
