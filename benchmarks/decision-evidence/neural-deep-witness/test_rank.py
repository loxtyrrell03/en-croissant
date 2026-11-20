"""Regression coverage for orientation, replay and grouping."""
import unittest

import chess
import torch

from rank import BranchGRU, check_split, legal_prefix, material


class RankTests(unittest.TestCase):
    def test_colour_mirror_keeps_material_signed_for_the_mover(self):
        board = chess.Board("4k3/8/8/8/8/8/4p3/4R1K1 w - - 0 1")
        other = board.mirror()
        white, _, _ = legal_prefix(board, {"fen": board.fen(), "pvUci": ["e1e2"]}, chess.WHITE, 1)
        black, _, _ = legal_prefix(other, {"fen": other.fen(), "pvUci": ["e8e7"]}, chess.BLACK, 1)
        self.assertEqual(white, black)
        self.assertEqual(white[-1] - material(board, chess.WHITE), 1)

    def test_wrong_reply_board_rejected(self):
        board = chess.Board()
        wrong = board.copy()
        wrong.push_uci("e2e4")
        with self.assertRaisesRegex(ValueError, "wrong board"):
            legal_prefix(board, {"fen": wrong.fen(), "pvUci": ["e7e5"]}, chess.WHITE, 1)

    def test_sibling_order_does_not_change_the_encoding(self):
        torch.manual_seed(12)
        model = BranchGRU(6, 3).eval()
        seq = torch.rand((2, 4, 8, 6))
        seq[:, :, :, -1] = 1
        scores = torch.rand((2, 3))
        with torch.no_grad():
            torch.testing.assert_close(model(seq, scores), model(seq[:, [1, 0, 3, 2]], scores))

    def test_game_family_and_mirrored_board_leaks_rejected(self):
        board = chess.Board("4k3/8/8/8/8/8/4p3/4R1K1 w - - 0 1")
        first = dict(id="1", game="a", fen=board.fen(), event="event-a-2026-open")
        second = dict(id="2", game="b", fen=chess.Board().fen(), event="event-b-2026-open")
        check_split([first], [second])
        for leak in ({"game": "a"}, {"event": "event-a-2026-women"}, {"fen": board.mirror().fen()}):
            with self.subTest(leak=leak), self.assertRaisesRegex(ValueError, "identities intersect"):
                check_split([first], [dict(second, **leak)])


if __name__ == "__main__":
    unittest.main()
