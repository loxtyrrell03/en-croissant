import importlib.util
from pathlib import Path
import unittest

import chess


SPEC = importlib.util.spec_from_file_location(
    "structure_sample",
    Path(__file__).resolve().parents[1] / "benchmarks" / "decision-evidence-structure-sample.py",
)
sample = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sample)


def moves(uci):
    return list(map(chess.Move.from_uci, uci.split()))


class StructureSampleTest(unittest.TestCase):
    def test_distinguishes_exchanged_and_held_pawn_contact(self):
        board = chess.Board("8/ppp4p/3n4/2p1k1p1/3N4/1P2KPP1/P1P4P/8 w - - 0 33")
        exchanged = moves("f3f4 g5f4 g3f4 e5f6 d4e2")
        self.assertEqual(sample.pawn_contact(board, exchanged), "central-contact-exchanged")
        held = chess.Board("4k3/7p/8/3p4/8/8/P3P3/4K3 w - - 0 19")
        self.assertEqual(sample.pawn_contact(held, moves("e2e4 h7h6 e1f1 e8f8 a2a3")), "central-contact-held")

    def test_selects_a_played_open_file_rook_exchange(self):
        board = chess.Board("3r2k1/1pq2pp1/p4b1p/8/1P2n3/1QP1BN1P/1P3PP1/3R2K1 b - - 2 21")
        self.assertEqual(sample.open_file_trade(board, moves("d8d6 d1d6 e4d6 b3d5 d6c4")), "open-file-rook-trade")
        board.set_piece_at(chess.D4, chess.Piece(chess.PAWN, chess.WHITE))
        self.assertIsNone(sample.open_file_trade(board, moves("d8d6 d1d6 e4d6 b3d5 d6c4")))


if __name__ == "__main__":
    unittest.main()
