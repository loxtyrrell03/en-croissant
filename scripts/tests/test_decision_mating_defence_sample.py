import importlib.util
from pathlib import Path
import unittest

import chess
import chess.engine
import chess.pgn


SPEC = importlib.util.spec_from_file_location(
    "mating_defence_sample",
    Path(__file__).resolve().parents[1] / "benchmarks" / "decision-evidence-mating-defence-sample.py",
)
sample = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sample)


class MatingDefenceSampleTest(unittest.TestCase):
    def setUp(self):
        self.board = chess.Board("5k1r/p3b3/3Np3/2p2p2/1p4p1/6K1/PP1RbP2/R1B5 b - - 4 31")

    def test_checks_all_legal_evasions_after_the_attacking_move(self):
        self.board.push_san("Bxd6+")
        self.board.push_san("Kg2")
        fen = self.board.fen()
        self.assertEqual(sample.short_check_mate(self.board), 2)
        self.assertEqual(self.board.fen(), fen)
        self.board.pop()
        self.board.push_san("Rxd6")
        self.assertIsNone(sample.short_check_mate(self.board))

    def test_samples_an_unplayed_mating_branch_without_using_classifier_output(self):
        game = chess.pgn.Game()
        game.setup(self.board)
        check = game.add_main_variation(self.board.parse_san("Bxd6+"))
        played_board = check.board()
        reply = check.add_main_variation(played_board.parse_san("Rxd6"))
        for node in (check, reply):
            node.set_eval(chess.engine.PovScore(chess.engine.Cp(-548), chess.WHITE))
        recorded = list(sample.check_cases(self.board.copy(), list(game.mainline())))
        legal = list(sample.check_cases(self.board.copy(), list(game.mainline()), legal_witness=True))
        self.assertEqual(recorded[0]["stratum"], "broadcast-stable-evasion")
        self.assertEqual(legal[0]["stratum"], "legal-check-mate-branch")
        self.assertEqual(legal[0]["selectorEvasionUci"], "g3g2")


if __name__ == "__main__":
    unittest.main()
