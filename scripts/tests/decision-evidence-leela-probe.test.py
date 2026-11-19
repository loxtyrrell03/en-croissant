"""Regression checks for Leela's board encoding and exact legal replay."""
import importlib.util
from pathlib import Path
import unittest

import chess
import numpy as np


source = Path(__file__).resolve().parents[1] / 'benchmarks/decision-evidence-leela-probe.py'
spec = importlib.util.spec_from_file_location('leela_probe', source)
leela = importlib.util.module_from_spec(spec)
spec.loader.exec_module(leela)


class PlaneTests(unittest.TestCase):
    def test_initial_position_has_no_invented_history(self):
        result = leela.planes(chess.Board()).reshape(112, 64)
        self.assertEqual(result.shape, (112, 64))
        self.assertEqual(result[0, chess.E2], 1)
        self.assertEqual(result[6, chess.E7], 1)
        self.assertEqual(result[13:104].sum(), 0)
        self.assertTrue(np.all(result[104:108] == 1))
        self.assertTrue(np.all(result[108:111] == 0))
        self.assertTrue(np.all(result[111] == 1))

    def test_black_to_move_uses_same_side_across_history(self):
        root = chess.Board()
        root.push_san('e4')
        result = leela.planes(root).reshape(112, 64)
        self.assertEqual(result[0, chess.E2], 1)
        self.assertEqual(result[6, chess.E5], 1)
        self.assertEqual(result[13, chess.E2], 1)
        self.assertEqual(result[19, chess.E7], 1)
        self.assertEqual(result[26:104].sum(), 0)
        self.assertTrue(np.all(result[108] == 1))

    def test_history_free_fen_fills_with_inferred_pawn_move(self):
        root = chess.Board('4k3/4pppp/8/8/3pP3/8/PPPP4/4K3 b - e3 0 40')
        result = leela.planes(root).reshape(112, 64)
        self.assertEqual(result[6, chess.E5], 1)
        self.assertEqual(result[19, chess.E7], 1)
        self.assertEqual(result[19, chess.E5], 0)
        self.assertTrue(np.all(result[19] == result[32]))

    def test_repetition_is_drawn_from_known_history(self):
        root = chess.Board()
        for san in ('Nf3', 'Nf6', 'Ng1', 'Ng8'):
            root.push_san(san)
        result = leela.planes(root).reshape(112, 64)
        self.assertTrue(np.all(result[12] == 1))
        self.assertTrue(np.all(result[25] == 0))


class BranchTests(unittest.TestCase):
    def test_keeps_exact_history_of_search_frames(self):
        probe = leela.load_position_runner().load_probe()
        root = chess.Board()
        child = root.copy()
        child.push_san('e4')
        line = {'pvUci': ['e2e4', 'e7e5']}
        reply = {'fen': child.fen(), 'pvUci': ['c7c5', 'g1f3', 'd7d6']}
        boards = leela.branch(probe, root, 'e2e4', line, [reply])
        self.assertEqual([len(board.move_stack) for board in boards], list(range(5)))
        self.assertEqual([move.uci() for move in boards[-1].move_stack],
                         ['e2e4', 'c7c5', 'g1f3', 'd7d6'])
        self.assertEqual(root.fen(), chess.STARTING_FEN)
        with self.assertRaisesRegex(ValueError, 'different child'):
            leela.branch(probe, root, 'e2e4', line, [dict(reply, fen=root.fen())])


if __name__ == '__main__':
    unittest.main()
