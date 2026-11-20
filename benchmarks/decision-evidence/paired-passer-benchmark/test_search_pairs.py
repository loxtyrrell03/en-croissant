import json
from pathlib import Path
import unittest

import chess

from forced_push import outcome
from search_pairs import evaluate, pair_direction, reached, sampling, trace


def reviewed_board(case):
    path = Path(__file__).with_name("examples.json")
    rows = json.loads(path.read_bytes())
    return reached(next(row for row in rows if row["id"] == case))


class PairedPasserTests(unittest.TestCase):
    def test_pawn_must_survive_to_end_of_reference_window(self):
        board = chess.Board("7k/8/8/P7/8/8/8/7K w - - 0 1")
        moves = "a5a6 h8g7 a6a7 g7f6 a7a8q f6e5 a8a6 e5d4 h1g2 d4c3 g2f3 c3b2".split()
        self.assertEqual(trace(board, chess.A5, moves)["outcome"], "advances")
        self.assertIsNone(trace(board, chess.A5, moves[:-1])["outcome"])

    def test_blockade_needs_occupied_square_and_full_length(self):
        board = chess.Board("k7/4b3/4P3/8/8/8/8/7K w - - 0 1")
        moves = "h1g1 a8b8 g1h2 b8c8 h2g2 c8d8 g2h3 d8e8 h3h2 e8d8 h2g2 d8c8".split()
        self.assertEqual(trace(board, chess.E6, moves)["outcome"], "blocked")
        self.assertIsNone(trace(board, chess.E6, moves[:-1] + ["e7d6"])["outcome"])

    def test_en_passant_removes_original_pawn(self):
        board = chess.Board("7k/8/8/8/3p4/8/4P3/7K w - - 0 1")
        outcome = trace(board, chess.E2, ["e2e4", "d4e3"])
        self.assertEqual(outcome["capturePly"], 2)
        self.assertEqual(outcome["outcome"], "captured")
        board.push_uci("e2e4")
        self.assertFalse(sampling.eligible_move(board, board.parse_uci("d4e3"), chess.E4))

    def test_early_promotion_does_not_hide_loss_of_asset(self):
        board = chess.Board("1r5k/P7/8/8/8/8/8/7K w - - 0 1")
        outcome = trace(board, chess.A7, ["a7a8q", "b8a8"])
        self.assertEqual(outcome["outcome"], "captured")
        self.assertEqual(outcome["advancePly"], 1)

    def test_uncertainty_is_not_a_restraint(self):
        self.assertIsNone(evaluate([{"outcome": "blocked"}, {"outcome": None}]))
        mixed_restraints = evaluate([{"outcome": "captured"}, {"outcome": "blocked"}])
        self.assertEqual(pair_direction([mixed_restraints, "advances"]), 1)
        self.assertIsNone(pair_direction(["advances", None]))
        self.assertIsNone(pair_direction(["advances", "advances"]))

    def test_forced_push_rejects_mate_and_requires_early_capture_for_refutation(self):
        board = chess.Board("7k/4b3/8/4P3/8/8/8/7K w - - 0 1")
        push = board.parse_uci("e5e6")
        forced = {"fen": board.fen(), "pvUci": ["e5e6", "h8g8", "h1h2", "e7f6"], "cp": -250}
        best = {"fen": board.fen(), "pvUci": ["h1h2"], "cp": 0}
        self.assertIsNone(outcome(board, chess.E5, push, best, forced)["outcome"])
        self.assertEqual(outcome(board, chess.E5, push, dict(best, cp=-220), forced)["outcome"], "viable")
        self.assertIsNone(outcome(board, chess.E5, push, best, dict(forced, cp=None))["outcome"])

    def test_same_capture_changes_the_legality_of_promotion(self):
        snapshot = reviewed_board("passer-pair-03b0bbd727d6f3fb")
        promotion = chess.Move.from_uci("b7b8q")
        for king, can_promote in (("f2f3", False), ("f2g2", True)):
            board = snapshot.copy()
            for uci in (king, "c6d6", "b6b7", "d6d3"):
                board.push_uci(uci)
            self.assertEqual(board.is_check(), not can_promote)
            self.assertEqual(board.is_legal(promotion), can_promote)

    def test_rook_move_covers_king_flights_after_same_knight_check(self):
        snapshot = reviewed_board("passer-pair-24058c51cfa95ff0")
        flights = [chess.Move.from_uci(uci) for uci in ("f1e2", "f1f2")]
        for rook, has_flights in (("d2d4", True), ("d2b2", False)):
            board = snapshot.copy()
            for uci in (rook, "b6b7", "d5e3"):
                board.push_uci(uci)
            self.assertTrue(board.is_check())
            self.assertEqual([board.is_legal(move) for move in flights], [has_flights, has_flights])


if __name__ == "__main__":
    unittest.main()
