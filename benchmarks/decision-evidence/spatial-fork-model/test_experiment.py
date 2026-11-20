from unittest import TestCase, main

import chess
import numpy as np
import torch

from experiment import (ExactNetwork, baseline, board_identity, encode_candidate,
                        move_planes, pretraining_samples, train_groups)


class SpatialForkExperimentTest(TestCase):
    def test_colour_mirror_keeps_move_and_castling_planes(self):
        board = chess.Board()
        move = board.parse_uci("d2d4")
        mirrored = board.mirror()
        np.testing.assert_array_equal(move_planes(board, move),
                                      move_planes(mirrored, mirrored.parse_uci("d7d5")))

    def test_exact_position_marks_en_passant_and_promotion(self):
        board = chess.Board("4k3/P7/8/3pP3/8/8/8/4K3 w - d6 0 3")
        values = move_planes(board, board.parse_uci("a7a8n")).reshape(-1, 64)
        self.assertEqual(values[13, chess.D6], 1)
        self.assertEqual(values[14, chess.A7], 1)
        self.assertEqual(values[15, chess.A8], 1)
        self.assertEqual(values[16, chess.A8], chess.KNIGHT)

    def test_reply_must_start_after_exact_move(self):
        frame = dict(fen=chess.STARTING_FEN, move="e2e4", quick=[dict(pv=["e7e5", "g1f3"])])
        moves, masks = encode_candidate(frame)
        self.assertEqual(moves.shape[0], 9)
        self.assertEqual(masks.tolist(), [[True, True, False, False], [False] * 4])
        model = ExactNetwork(16).eval()
        inputs = (torch.as_tensor(moves[None]), torch.as_tensor(masks[None]), torch.zeros(1, 16))
        labels = model(*inputs)
        inputs[0][:, -4:] = 5
        torch.testing.assert_close(labels, model(*inputs))
        frame["quick"][0]["pv"] = ["e2e3"]
        with self.assertRaises(chess.IllegalMoveError):
            encode_candidate(frame)

    def test_pretraining_excludes_both_source_games_and_intermediate_boards(self):
        board = chess.Board()
        row = dict(game="one", split="train", fen=board.fen(), line=["e2e4", "e7e5", "g1f3"])
        self.assertEqual(pretraining_samples(dict(cases=[row]), set(), set())[1]["pairs"], 2)
        self.assertEqual(pretraining_samples(dict(cases=[row]), {"one"}, set())[1]["pairs"], 0)
        board.push_san("e4")
        held = {board_identity(board.mirror())}
        self.assertEqual(pretraining_samples(dict(cases=[row]), set(), held)[1],
                         {"excludedByBoard": 1, "pairs": 0})
        with self.assertRaises(ValueError):
            baseline.enforce_groups([
                dict(identity=dict(game="one", boardKey="board-one", split="train")),
                dict(identity=dict(game="two", boardKey="board-one", split="test")),
            ], [])

    def test_training_group_orders_positive_before_negative(self):
        rows = [dict(identity=dict(game=key, boardKey=key)) for key in ("g", "g", "h", "h", "i")]
        pairs, singles = train_groups(rows, np.array([0, 1, 1, 1, 1]),
                                      np.array([True, True, True, True, False]))
        self.assertEqual(pairs.tolist(), [[1, 0]])
        self.assertEqual(singles.tolist(), [2, 3])


if __name__ == "__main__":
    main()
