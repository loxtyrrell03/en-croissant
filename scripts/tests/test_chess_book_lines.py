from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_ROOT))

from chess_book_lines import (  # noqa: E402
    extract_opening_book_lines,
    normalize_book_notation,
    normalize_fen_key,
    tokenize_opening_moves,
)


class ChessBookLineExtractionTests(unittest.TestCase):
    def test_figurine_notation_becomes_san_tokens(self) -> None:
        text = "1.e4 c5 2.¤f3 d6 3.¥b5†"
        self.assertEqual(normalize_book_notation(text), "1.e4 c5 2.Nf3 d6 3.Bb5+")
        self.assertEqual(
            [(token.san, token.move_number, token.black_move) for token in tokenize_opening_moves(text)],
            [
                ("e4", 1, False),
                ("c5", None, False),
                ("Nf3", 2, False),
                ("d6", None, False),
                ("Bb5+", 3, False),
            ],
        )

    def test_nested_book_sideline_is_replayed_from_its_real_branch_position(self) -> None:
        pages = [
            {
                "pdf_page": 7,
                "printed_page": 42,
                "chapter_id": "chapter-sicilian",
                "contains_chess_notation": True,
                "clean_text": (
                    "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 "
                    "(4...a6 5.Nc3) 5.Nc3 a6"
                ),
            }
        ]
        chunks = [
            {
                "chunk_id": "chunk-sicilian",
                "pdf_page_start": 7,
                "contains_chess_notation": True,
                "text": pages[0]["clean_text"],
            }
        ]
        lines, report = extract_opening_book_lines(
            {"id": "test-sicilian", "title": "Test Sicilian", "author": "GM Test"},
            pages,
            chunks,
        )

        self.assertEqual(report["accepted_tokens"], 12)
        self.assertEqual(report["unrooted_tokens"], 0)
        self.assertEqual(len(lines), 2)
        self.assertTrue(any("4. Nxd4 a6 5. Nc3" in line.pgn for line in lines))
        self.assertTrue(any("4. Nxd4 Nf6 5. Nc3 a6" in line.pgn for line in lines))
        for line in lines:
            for move in line.moves:
                self.assertEqual(normalize_fen_key(move.fen_before), move.fen_before_key)
                self.assertEqual(normalize_fen_key(move.fen_after), move.fen_after_key)
                self.assertEqual(move.source_chunk_id, "chunk-sicilian")

    def test_prose_squares_and_unrooted_fragments_are_not_guessed(self) -> None:
        pages = [
            {
                "pdf_page": 3,
                "printed_page": 3,
                "chapter_id": "chapter-one",
                "contains_chess_notation": True,
                "clean_text": "1.e4 The h5-square matters. 1...c5 19.Nf5 is mentioned elsewhere.",
            }
        ]
        lines, report = extract_opening_book_lines(
            {"id": "test-book", "title": "Test", "author": "GM Test"}, pages, []
        )

        self.assertEqual(report["accepted_tokens"], 2)
        self.assertGreaterEqual(report["unrooted_tokens"], 1)
        self.assertTrue(all("h5" not in line.san_line for line in lines))


if __name__ == "__main__":
    unittest.main()
