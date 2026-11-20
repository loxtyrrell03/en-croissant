import unittest

import chess

from selection import choices, plausible_replies


def frame(cp, line, depth=24):
    return dict(cp=cp, mate=None, depth=depth, pvUci=line.split())


class CaptureOrderSelectionTest(unittest.TestCase):
    def setUp(self):
        self.board = chess.Board("8/6k1/1P5R/8/7p/2PKB1b1/1r6/8 b - - 0 45")
        self.root = frame(0, "g3f2 h6h5")
        self.reply = frame(0, "h6h5 f2e3 d3e3 b2b6 h5h4")

    def test_independent_reply_recovers_short_principal_line(self):
        row = dict(candidates=[self.root], replyProbes=[dict(moveUci="g3f2", lines=[self.reply])])
        pool, selected = choices(self.board, row)
        candidate = selected["cached"]
        self.assertEqual(pool[candidate], ["reply"])
        self.assertEqual((candidate.remove, candidate.take), ("f2e3", "b2b6"))

    def test_conflicting_score_cannot_lend_a_continuation(self):
        self.assertEqual(list(plausible_replies(self.root, [dict(self.reply, cp=100)])), [])
        self.assertEqual(list(plausible_replies(self.root, [self.reply, frame(-150, "h6h7")])), [self.reply])
        self.assertEqual(list(plausible_replies(self.root, [self.reply, frame(0, "h6h7", 23)])), [self.reply])

    def test_deduplicates_same_question_from_two_searches(self):
        root = frame(0, "g3f2 h6h5 f2e3 d3e3 b2b6 h5h4")
        row = dict(candidates=[root], replyProbes=[dict(moveUci="g3f2", lines=[self.reply])])
        pool, selected = choices(self.board, row)
        self.assertEqual(len(pool), 1)
        self.assertEqual(pool[selected["cached"]], ["principal", "reply"])
        self.assertEqual(selected["cached"], selected["agreement"])


if __name__ == "__main__":
    unittest.main()
