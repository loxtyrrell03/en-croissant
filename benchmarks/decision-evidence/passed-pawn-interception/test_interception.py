"""Regression coverage for the evidence and both branches of the experiment."""
import json
from pathlib import Path
import unittest

import chess

from defuses import paired_defence
from interception import examples
from paired_probe import pawn_outcome

FIXTURES = json.loads(Path(__file__).with_name("examples.json").read_bytes())
REPLAY = {row["input"]["id"]: row for row in FIXTURES["replay"]}

class PawnInterceptionTest(unittest.TestCase):
    def test_promoting_pawn_can_win_a_rook_through_a_check_before_recapture(self):
        women = next(
            case for case in FIXTURES["development"] if "disabilities-women" in case["id"]
        )
        certificate = women["proof"]
        board = chess.Board(certificate["other"]["fen"])
        result = pawn_outcome(board, chess.D7, certificate["other"])
        self.assertEqual(result["move"], "d8=R+")
        self.assertEqual(result["trail"], ["Rxd8", "Rc5+", "Ke6", "Bxd8"])
        self.assertEqual(result["loss"], 400)
        self.assertIsNone(pawn_outcome(board, chess.C7, certificate["other"]))

    def test_counterexample_requires_a_checked_alternative(self):
        case = REPLAY["O04YF"]
        witness = examples(case["input"])[0]
        self.assertNotEqual(witness["sacrifice"]["fen"], witness["repeat"]["fen"])
        self.assertEqual(
            case["alternativeChecks"]["proof"]["status"], "different-checkpoints"
        )

    def test_better_choices_prevent_cost_to_stop_the_same_pawn(self):
        case = REPLAY["IT54z"]["input"]
        witness = examples(case)[0]
        details = paired_defence(case["fen"], witness)
        self.assertEqual([row["move"] for row in details], ["Nxd2", "Nxd2"])

    def test_both_searches_of_the_weaker_move_are_insufficient(self):
        for puzzle in ("LNC1C", "JVWeJ"):
            with self.subTest(puzzle=puzzle):
                case = REPLAY[puzzle]
                self.assertTrue(case["alternativeChecks"]["proof"]["proved"])
                witness = examples(case["input"])[0]
                self.assertIsNone(paired_defence(case["input"]["fen"], witness))

if __name__ == "__main__":
    unittest.main()
