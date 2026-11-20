from copy import deepcopy
import json
from pathlib import Path
import unittest

import chess

from experiment import decision, initial, sustained_before_advance

CASES = json.loads(Path(__file__).with_name("fixtures.json").read_bytes())


class PasserMobilityTest(unittest.TestCase):
    def test_saved_exact_boards(self):
        for example in CASES:
            for arm, expected in example["expected"].items():
                with self.subTest(game=example["id"], run=example["run"], arm=arm):
                    self.assertEqual(decision(example, arm), expected)

    def test_rejects_an_engine_frame_from_the_other_side_of_the_comparison(self):
        verified = deepcopy(next(row for row in CASES if "d92503" in row["id"]))
        self.assertEqual(decision(verified, "persistent"), "supported")
        verified["testResults"][0] = verified["controlResults"][0]
        self.assertEqual(decision(verified, "persistent"), "mismatched-board")

    def test_promotion_does_not_erase_the_retained_pawn_before_it(self):
        case = next(row for row in CASES if "06d848" in row["id"])
        self.assertTrue(sustained_before_advance(initial(case), case, chess.C6))
        self.assertFalse(sustained_before_advance(initial(case), case, chess.C5))
        self.assertEqual(decision(case, "persistent"), "weak-advance-contained")
        self.assertEqual(decision(case, "prepared"), "supported")


if __name__ == "__main__":
    unittest.main()
