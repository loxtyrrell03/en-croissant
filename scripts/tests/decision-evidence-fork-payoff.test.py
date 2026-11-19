"""Regression checks for the exact-move fork payoff labels."""

import importlib
from pathlib import Path
import sys
import unittest

import chess

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "benchmarks"))
payoff = importlib.import_module("decision-evidence-fork-payoff")


class ExactForkPayoffTest(unittest.TestCase):
    def evidence(self, fen, move_uci, lines):
        board = chess.Board(fen)
        move = board.parse_uci(move_uci)
        targets = payoff.geometry(board, move)
        self.assertGreaterEqual(len(targets), 2)
        frames = [dict(cp=cp, mate=None, pv=uci.split()) for cp, uci in lines]
        return payoff.label_payoff(board, move, targets, frames)

    def test_retained_capture_under_either_king_reply(self):
        found, reason, proof = self.evidence(
            "8/3k4/pp5p/8/3PP1r1/5N2/PPR1K3/8 w - - 2 33", "f3e5",
            [(-969, "d7d8 e5g4 h6h5 g4e3 a6a5 d4d5 a5a4"),
             (-975, "d7e8 e5g4 h6h5 g4e5 e8f8 c2c1 a6a5")],
        )
        self.assertTrue(found)
        self.assertEqual(reason, "fork-target-retained")
        self.assertEqual([line["collected"] for line in proof], [[3, chess.G4, "e5g4"]] * 2)

    def test_playable_refutation_outweighs_weak_reply(self):
        found, reason, proof = self.evidence(
            "1k6/R1N4p/1P1r4/2n1p3/3pP3/6P1/7P/6K1 w - - 11 45", "c7a6",
            [(29, "c5a6 a7a6 b8b7 a6a3 b7b6 g1f2 d6c6"),
             (-626, "b8c8 a6c5 d6b6 a7a5 h7h5 c5d3 h5h4")],
        )
        self.assertFalse(found)
        self.assertEqual(reason, "best-defence-neutralizes-material")
        self.assertFalse(proof[0]["forkerSurvives"])
        self.assertIsNone(proof[0]["collected"])
        self.assertIsNotNone(proof[1]["collected"])

    def test_promotion_can_fork_but_rook_recapture_is_other_piece(self):
        found, reason, proof = self.evidence(
            "r5k1/3PBpp1/5p1p/8/8/Pq5P/3R1PP1/3R2K1 w - - 3 41", "d7d8q",
            [(-706, "a8d8 d2d8 g8h7 d8d3 b3e6 e7d6 e6c4"),
             (-1169, "g8h7 d8a8 b3e6 e7d6 e6b3 d2d4 h6h5")],
        )
        self.assertIsNone(found)
        self.assertEqual(reason, "unresolved-payoff")
        self.assertIsNone(proof[0]["collected"])
        self.assertEqual(proof[1]["collected"], [3, chess.A8, "d8a8"])

    def test_mating_move_cannot_win_more_material_after_game_ends(self):
        found, reason, _ = self.evidence(
            "r1bq1k1r/pp2p3/2p1Bb2/6pQ/8/2N1P3/PPP3PP/R5K1 w - - 0 18", "h5f7", [],
        )
        self.assertFalse(found)
        self.assertEqual(reason, "game-ends-at-root")


if __name__ == "__main__":
    unittest.main()
