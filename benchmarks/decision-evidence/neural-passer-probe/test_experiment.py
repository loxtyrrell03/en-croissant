import unittest
from unittest.mock import patch

import chess

from assets import check_disjoint, normalized, passed, reference, trajectory
from experiment import relative_square


class PawnProbeTests(unittest.TestCase):
    def test_promotion_tracks_the_same_asset(self):
        board = chess.Board("7k/8/8/P7/8/8/8/7K w - - 0 1")
        survived = trajectory(board, chess.A5, "a5a6 h8g7 a6a7 g7f6 a7a8q f6e5".split(), 6)
        self.assertEqual(survived, {"advanced": True, "alive": True, "complete": True})
        board = chess.Board("1r5k/P7/8/8/8/8/8/7K w - - 0 1")
        captured = trajectory(board, chess.A7, ["a7a8q", "b8a8"], 10)
        self.assertEqual(captured, {"advanced": True, "alive": False, "complete": True})

    def test_en_passant_capture_is_loss_of_the_original_pawn(self):
        board = chess.Board("7k/8/8/8/3p4/8/4P3/7K w - - 0 1")
        trace = trajectory(board, chess.E2, ["e2e4", "d4e3"], 10)
        self.assertEqual(trace, {"advanced": True, "alive": False, "complete": True})

    def test_truncated_continuation_cannot_supply_negative(self):
        board = chess.Board("7k/8/8/P7/8/8/8/7K w - - 0 1")
        self.assertEqual(trajectory(board, chess.A5, ["h1g1"], 10),
                         {"advanced": False, "alive": True, "complete": False})
        with self.assertRaises(ValueError):
            trajectory(board, chess.A5, ["0000"], 10)

    def test_color_mirror_keeps_relative_board_and_passed_pawn(self):
        board = chess.Board("7k/8/8/P1p5/8/8/8/7K w - - 0 1")
        other = board.mirror()
        self.assertEqual(normalized(board), normalized(other))
        self.assertEqual(relative_square(board, chess.A5), relative_square(other, chess.A4))
        self.assertTrue(passed(board, chess.A5, chess.WHITE))
        self.assertTrue(passed(other, chess.A4, chess.BLACK))
        self.assertFalse(passed(chess.Board("7k/1p6/8/P7/8/8/8/7K w - - 0 1"),
                                chess.A5, chess.WHITE))

    def test_reference_requires_plausible_distinct_replies_and_root_agreement(self):
        board = chess.Board("7k/8/8/P7/8/8/8/7K b - - 0 1")
        lines = [
            {"pvUci": ["h8g8"], "fen": board.fen(), "cp": -80, "depth": 20},
            {"pvUci": ["h8g7"], "fen": board.fen(), "cp": -100, "depth": 20},
        ]
        yes = {"advanced": True, "alive": True, "complete": True}
        no = dict(yes, advanced=False)
        with patch("assets.trajectory", return_value=yes):
            self.assertIs(reference(board, chess.A5, ["h8g7"], lines), True)
            self.assertIsNone(reference(board, chess.A5, ["h8g7"], [lines[0], lines[0]]))
            self.assertIsNone(reference(board, chess.A5, ["h8g7"], [lines[0], dict(lines[1], cp=-161)]))
            self.assertIsNone(reference(board, chess.A5, ["h8g7"], [lines[0], dict(lines[1], depth=19)]))
        with patch("assets.trajectory", side_effect=[no, yes, yes]):
            self.assertIsNone(reference(board, chess.A5, ["h8g7"], lines))

    def test_partition_checks_event_game_and_mirrored_board_collision(self):
        for contaminated in (("game", "other-event", "test-board"),
                             ("test-game", "event", "test-board"),
                             ("test-game", "other-event", "board")):
            with self.assertRaises(ValueError):
                check_disjoint([({"game"}, {"event"}, {"board"}),
                                tuple({item} for item in contaminated)])


if __name__ == "__main__":
    unittest.main()
