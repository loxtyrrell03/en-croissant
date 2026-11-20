import json
from pathlib import Path
import unittest
from unittest.mock import patch

import chess
from rank import audit, encode, evaluate
from search_pairs import classify_pair, finish_pair, root_map, trace


class PairedChoiceTests(unittest.TestCase):
    def setUp(self):
        fixture = Path(__file__).resolve().parents[1] / "sibling-refutation" / "fixture.json"
        bavaria = json.loads(fixture.read_bytes())["bavaria"]
        self.board = chess.Board(bavaria["input"]["fen"])
        self.roots = root_map(bavaria["input"]["candidates"])
        self.good, self.bad = "b5d4", "f5c8"
        good_line = self.roots[self.good]
        self.replies = {
            self.good: dict(good_line, cp=-good_line["cp"], pvUci=good_line["pvUci"][1:]),
            self.bad: bavaria["causal"]["reply"],
        }

    def test_same_knight_is_captured_even_when_defender_takes_attacker_in_control(self):
        pair = classify_pair(self.board, self.bad, self.good, self.roots, self.replies)
        self.assertEqual(pair["outcome"], "provisional")
        self.assertEqual(pair["originalVictimSquare"], "b5")
        with patch("search_pairs.select_lines") as unexpected_search:
            result = finish_pair(self.board, pair, self.roots, self.replies, "", 0)
            unexpected_search.assert_not_called()
        self.assertEqual(result["outcome"], "verified")
        self.assertEqual(result["control"], "better move takes attacker")
        self.assertEqual(result["refutedLine"][:2], ["f5c8", "d4b5"])

    def test_unverified_score_gap_is_not_a_negative_or_positive(self):
        replies = {
            **self.replies,
            self.bad: dict(self.replies[self.bad], pvUci=["c8b8"]),
        }
        actual = classify_pair(self.board, self.bad, self.good, self.roots, replies)
        self.assertEqual(actual["outcome"], "unresolved")

    def test_capture_identity_after_en_passant_and_castling(self):
        ep = chess.Board("r3k2r/ppp2ppp/8/3pP3/8/8/PPP2PPP/R3K2R w KQkq d6 0 1")
        _, captures = trace(ep, ["e5d6", "c7d6"])
        self.assertEqual(captures, [(1, "c7d6", chess.PAWN, chess.E5)])
        castling = chess.Board("4kr2/8/8/8/5q2/8/5PPP/4K2R w K - 0 1")
        _, captures = trace(castling, ["e1g1", "f4f2", "f1f2", "f8f2"])
        self.assertEqual(captures[-1], (3, "f8f2", chess.ROOK, chess.H1))

    def test_training_features_do_not_read_the_reference(self):
        row = {
            "id": "position", "event": "bavaria", "fen": self.board.fen(),
            "history": {"fen": self.board.fen(), "moves": []},
            "preview": [self.roots[self.good], self.roots[self.bad]],
            "previewReplies": {move: [line] for move, line in self.replies.items()},
            "reference": list(self.roots.values()), "referenceReplies": {},
            "pairs": [{"move": self.bad, "outcome": "verified"}],
        }
        features = encode(row)
        without_reference = encode(dict(row, reference=[], pairs=[]))
        self.assertEqual([case["x"] for case in features], [case["x"] for case in without_reference])
        self.assertNotEqual([case["target"] for case in features], [case["target"] for case in without_reference])

    def test_split_groups_tournament_families(self):
        row = {"game": "a", "event": "bavaria", "fen": self.board.fen()}
        with self.assertRaisesRegex(ValueError, "overlap on event"):
            audit([row], [dict(row, game="b")])

    def test_unresolved_nomination_consumes_a_slot(self):
        available = [
            {"id": "row", "move": "a2a3", "target": None, "rank": 0, "event": "sample"},
            {"id": "row", "move": "a2a4", "target": 1, "rank": 1, "event": "sample"},
        ]
        result = evaluate(available, [0.7, 0.5])
        self.assertEqual(result["onePerBoard"], {"None": 1})
        self.assertIsNone(result["candidateAveragePrecision"])


if __name__ == "__main__":
    unittest.main()
