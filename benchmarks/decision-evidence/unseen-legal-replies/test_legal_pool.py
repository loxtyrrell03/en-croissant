"""Regression tests for exact, nonleaking nomination."""

from pathlib import Path
import unittest

from legal_pool import order_questions
from capture_order import Candidate, checkpoint
from freeze import read
from trials import initial


class LegalPoolTest(unittest.TestCase):
    def setUp(self):
        self.samples = read(Path("benchmarks/decision-evidence/cached-capture-selection/fixture.json"))

    def test_cached_reply_stays_out_of_unseen_queue(self):
        case = self.samples["amager"]
        root, reply = case["captureOrder"]["moveUci"], case["captureOrder"]["replyUci"]
        candidates = list(order_questions(case["input"]))
        self.assertTrue(any(item["proposal"]["reply"] == reply and item["proposal"]["root"] == root
                            for item in candidates))
        self.assertTrue(all(not item["unseen"] for item in candidates
                            if item["proposal"]["reply"] == reply and item["proposal"]["root"] == root))
        self.assertTrue(any(item["unseen"] for item in candidates))

    def test_other_legal_replies_can_create_order_questions(self):
        original = self.samples["amager"]["input"]
        board = initial(original)
        for item in order_questions(original):
            candidate = Candidate(**item["proposal"])
            reached = checkpoint(board, candidate)
            take = reached.parse_uci(candidate.take)
            self.assertTrue(reached.is_capture(reached.parse_uci(candidate.remove)))
            self.assertTrue(reached.is_capture(take))
            reached.push(take)
            recapture = reached.parse_uci(candidate.remove[2:] + candidate.take[2:])
            self.assertTrue(reached.is_capture(recapture))

    def test_cannot_peek_at_reference_or_recorded_moves(self):
        original = self.samples["amager"]["input"]
        spoiled = dict(original, recorded=["a1a8"], candidate={"reply": "a1a8"}, gold="positive")
        self.assertEqual(list(order_questions(original)), list(order_questions(spoiled)))

    def test_inferior_root_excluded_by_exact_paired_search(self):
        case = self.samples["weakerMove"]
        root = case["captureOrder"]["moveUci"]
        self.assertNotIn(root, {item["proposal"]["root"] for item in order_questions(case["input"])})


if __name__ == "__main__":
    unittest.main()
