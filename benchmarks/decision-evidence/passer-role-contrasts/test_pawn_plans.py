"""Regressions for pawn identity and distinct-route evidence."""

import unittest
from pathlib import Path

import chess

from pawn_plans import assets, compare, truly_distinct
from freeze import read


class PawnPlansTest(unittest.TestCase):
    def setUp(self):
        self.row = read(Path(__file__).with_name("development-witness.json"))

    def test_divergent_exchanges_control_the_same_original_pawn(self):
        proof = compare(self.row)
        move = proof["moves"]["g3f2"]
        self.assertEqual(proof["position"]["pawn"], "b6")
        self.assertEqual(move["pawn"], "b6")
        self.assertEqual([branch["role"] for branch in move["branches"]], ["remove", "remove"])
        self.assertTrue(all(branch["rootAction"] for branch in move["branches"]))
        self.assertNotEqual(move["branches"][0]["removed"], move["branches"][1]["removed"])

    def test_same_reached_board_is_one_route(self):
        first = dict(before="same", role="advance", actor=1, removed=(), effect=57)
        other = dict(first, effect=41)
        self.assertFalse(truly_distinct(first, other, ["a2a3", "h7h6"], ["b2b3", "g7g6"]))

    def test_same_pawn_moves_on_both_branches_must_be_observed(self):
        row = {**self.row, "candidates": [self.row["candidates"][0]],
               "replyProbes": [dict(self.row["replyProbes"][0],
                                    lines=self.row["replyProbes"][0]["lines"][:1])]}
        self.assertIsNone(compare(row)["position"])

    def test_opposing_pawn_ahead_prevents_passed_pawn_status(self):
        position = chess.Board("4k3/8/4p3/3P4/8/8/8/4K3 w - - 0 1")
        self.assertNotIn(chess.D5, assets(position))


if __name__ == "__main__":
    unittest.main()
