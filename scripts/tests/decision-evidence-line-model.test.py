"""Regression checks for legal line features and grouped diagnostic rankings."""
import importlib.util
from pathlib import Path
import unittest

import chess
import numpy as np


path = Path(__file__).resolve().parents[1] / 'benchmarks' / 'decision-evidence-line-model.py'
spec = importlib.util.spec_from_file_location('line_model', path)
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


def candidate(board, *moves):
    return dict(fen=board.fen(), cp=0, mate=None, pvUci=list(moves))


def decision(index, *, label=True, current=False, event='a'):
    return model.Decision(str(index), f'board-{index}', f'game-{index}', event,
                          {'mixed': label}, {'mixed': current}, np.zeros(1), np.zeros(1))


class LineModelTests(unittest.TestCase):
    def test_continue_only_from_matching_boards_and_distinct_legal_choices(self):
        board = chess.Board()
        one = candidate(board, 'e2e4', 'e7e5')
        two = candidate(board, 'd2d4', 'd7d5')
        self.assertEqual(model.features(board.fen(), [one, two])[0][0], 2)
        self.assertEqual(model.features(board.fen(), [one])[0][0], 1)
        with self.assertRaisesRegex(ValueError, 'distinct'):
            model.features(board.fen(), [one, one])
        with self.assertRaisesRegex(ValueError, 'empty'):
            model.features(board.fen(), [candidate(board)])
        with self.assertRaisesRegex(ValueError, 'different board'):
            model.features(board.fen(), [dict(one, fen=chess.Board.empty().fen())])
        with self.assertRaises(chess.IllegalMoveError):
            model.features(board.fen(), [candidate(board, 'e2e5')])
        with self.assertRaisesRegex(ValueError, 'null move'):
            model.features(board.fen(), [candidate(board, '0000')])

    def test_replay_accounts_for_en_passant_and_promotion(self):
        board = chess.Board('4k3/7P/8/3pP3/8/8/8/4K3 w - d6 0 1')
        for moves, captured, promoted, material_change in [
            (('e5d6',), 1, 0, 1),
            (('h7h8q',), 0, 1, 8),
        ]:
            with self.subTest(moves=moves):
                metrics = model.replay(board, candidate(board, *moves),
                                       model.board_features(board, board.turn))
                self.assertEqual(metrics[2], captured)
                self.assertEqual(metrics[5], promoted)
                self.assertEqual(metrics[8], material_change)

    def test_training_and_scoring_require_separate_events(self):
        with self.assertRaisesRegex(ValueError, 'share event'):
            model.assert_disjoint([decision(1)], [decision(2)])
        model.assert_disjoint([decision(1)], [decision(2, event='b')])
        same_board = decision(2, event='b')
        same_board.board = 'board-1'
        with self.assertRaisesRegex(ValueError, 'share board'):
            model.assert_disjoint([decision(1)], [same_board])

    def test_mixed_reference_uses_three_valued_logic(self):
        self.assertIs(model.joint(True, True), True)
        self.assertIs(model.joint(False, None), False)
        self.assertIs(model.joint(None, False), False)
        self.assertIsNone(model.joint(True, None))

    def test_unknown_and_negative_references_cannot_refill_review_slots(self):
        rows = [decision(0, current=True), decision(1, label=None),
                decision(2, label=False), *[decision(i) for i in range(3, 11)]]
        picks = model.select(rows, np.arange(len(rows))[::-1], 'mixed')
        self.assertEqual([row.id for row in picks], ['1', '2'])


if __name__ == '__main__':
    unittest.main()
