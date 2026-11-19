import importlib.util
from pathlib import Path
import unittest

import chess


SPEC = importlib.util.spec_from_file_location(
    "passer_sample",
    Path(__file__).resolve().parents[1] / "benchmarks" / "decision-evidence-passer-sample.py",
)
sample = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sample)


class BlockadeSampleTest(unittest.TestCase):
    def setUp(self):
        self.board = chess.Board("r5k1/P7/4p3/1Np1P3/2P5/1P1n2K1/8/8 b - - 0 41")

    def test_tracks_current_blocker_and_resolution_in_recorded_moves(self):
        stable = list(map(chess.Move.from_uci, "g8f7 g3f3 f7e7 f3e4 d3b4 e4f4".split()))
        short = list(map(chess.Move.from_uci, "g8f8 b5c7 a8a7".split()))
        self.assertEqual(sample.blockade_trajectory(self.board, stable), "blockade-persisted")
        self.assertEqual(sample.blockade_trajectory(self.board, short), "blockade-ended-early")
        self.assertIsNone(sample.blockade_trajectory(self.board, stable[:-1]))


if __name__ == "__main__":
    unittest.main()
