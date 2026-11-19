"""Small deterministic checks for the motif experiment. No downloads or engine."""

import importlib
from pathlib import Path
import sys
import unittest

import chess
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "benchmarks"))
model = importlib.import_module("decision-evidence-motif-sequence")
corpus = importlib.import_module("decision-evidence-motif-corpus")


class MotifSequenceTest(unittest.TestCase):
    def test_color_mirrored_fork_has_same_inputs(self):
        board = chess.Board("3r2kr/pp3p1p/1q4p1/2b1Q3/1P6/P2P4/5PPP/RN3RK1 b - - 0 23")
        moves = ["c5d4", "e5f4", "d4a1"]
        mirrored = [chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square)).uci()
                    for move in map(chess.Move.from_uci, moves)]
        original, mask = model.encode(board.fen(), moves)
        reflected, _ = model.encode(board.mirror().fen(), mirrored)
        np.testing.assert_array_equal(original, reflected)
        np.testing.assert_array_equal(mask, [True] * 3 + [False] * 7)
        self.assertEqual(corpus.board_identity(board), corpus.board_identity(board.mirror()))

    def test_human_source_game_partition_and_board_deduplication(self):
        board = chess.Board()
        cases = [dict(game=game, fen=position.fen(), split=corpus.partition(game))
                 for game, position in [("game0001", board), ("game0002", board.mirror())]]
        with self.assertRaisesRegex(ValueError, "Duplicate position"):
            model.check_splits(cases)

    def test_illegal_late_continuation_does_not_yield_features(self):
        board = chess.Board()
        moves = ["g1f3", "g8f6", "f3g1", "f6g8"] * 3 + ["a1a8"]
        with self.assertRaisesRegex(ValueError, "Illegal move .* ply 13"):
            model.encode(board.fen(), moves)

    def test_model_masks_padding_before_temporal_context(self):
        torch.manual_seed(11)
        network = model.TemporalMotifs(5).eval()
        x = torch.rand(2, 10, 5)
        mask = torch.arange(10)[None, :] < torch.tensor([3, 8])[:, None]
        alternative = torch.where(mask.unsqueeze(-1), x, 1000 * torch.rand_like(x))
        with torch.no_grad():
            torch.testing.assert_close(network(x, mask), network(alternative, mask))
            self.assertEqual(network.local_logits(x, mask).shape, (2, 10, len(model.THEMES)))


if __name__ == "__main__":
    unittest.main()
