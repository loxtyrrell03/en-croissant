"""Regressions for the offline capture-order experiment."""

import unittest

import chess

from capture_order import checkpoint, comparison, nomination


class CaptureOrderTest(unittest.TestCase):
    def setUp(self):
        self.board = chess.Board("8/6k1/1P5R/8/7p/2PKB1b1/1r6/8 b - - 0 45")
        continuation = "g3f2 h6h5 f2e3 d3e3 b2b6 h5h4"
        self.candidate = nomination(self.board, continuation.split())
        assert self.candidate
        self.after = checkpoint(self.board, self.candidate)
        self.strong = dict(depth=26, cp=-20, mate=None, pvUci="f2e3 d3e3 b2b6 h5h4 g7f8 e3d4".split())
        self.early = dict(depth=26, cp=-607, mate=None, pvUci="b2b6 e3f2 b6b8 h5h4 g7g6 f2d4".split())

    def judge(self, first, second):
        return comparison(self.after, self.candidate, [first, second])

    def test_guard_removal_before_pawn_capture(self):
        self.assertEqual(self.judge(self.strong, self.early), dict(
            label="guard-causal", gap=587, takesTarget=True, guardRole="takes-preparer"))

    def test_geometry_and_losing_score_without_guard_action(self):
        other_reply = dict(self.early, pvUci=["b2b6", "h5h4"])
        self.after.variation_san([chess.Move.from_uci(x) for x in other_reply["pvUci"]])
        self.assertEqual(self.judge(self.strong, other_reply)["label"], "other-or-unresolved")

    def test_equal_orders_and_incomparable_scores(self):
        self.assertEqual(self.judge(self.strong, dict(self.early, cp=-25))["label"], "order-harmless")
        self.assertEqual(self.judge(self.strong, dict(self.early, depth=27))["label"], "unresolved")
        self.assertEqual(self.judge(self.strong, dict(self.early, lowerbound=True))["label"], "unresolved")

    def test_source_line_must_actually_remove_defender_first(self):
        self.assertIsNone(nomination(self.board, "g3f2 h6h5 b2b6 e3f2 b6b8".split()))


if __name__ == "__main__":
    unittest.main()
