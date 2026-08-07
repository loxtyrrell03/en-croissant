from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import chess


SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from chess_book_supplements import (  # noqa: E402
    ingest_pgn_course,
    ingest_plain_text,
    ingest_wikibook_jsonl,
    parse_annotated_pgn_game,
    pawn_structure_key,
)


class ChessBookSupplementTests(unittest.TestCase):
    def test_private_course_keeps_plan_comments_and_tolerates_teaching_sidelines(self) -> None:
        pgn = """[Event "Carlsbad plans"]
[SetUp "1"]
[FEN "4k3/ppp2ppp/8/3p4/3P4/4P3/PP3PPP/4K3 w - - 0 1"]
[Result "*"]

{White's plans are the minority attack or a prepared e4 break. Black seeks ...Ne4 and ...c5 counterplay; the exact piece placement decides which plan works.}
1. Kd2 Ke7 (1... Qh9 {An intentionally illegal analogy should not erase the lesson.})
2. Kc3 *
"""
        parsed = parse_annotated_pgn_game(pgn)
        self.assertGreaterEqual(parsed.illegal_tokens, 1)
        self.assertTrue(any("minority attack" in comment for _, comment in parsed.comments))
        self.assertTrue(any(line for line in parsed.lines if line[0].san == "Kd2"))

        with tempfile.TemporaryDirectory() as temporary:
            course_root = Path(temporary)
            (course_root / "01 - Carlsbad.pgn").write_text(pgn, encoding="utf-8")
            corpus = ingest_pgn_course(
                {
                    "id": "private-structures",
                    "title": "Chess Structures: A Grandmaster Guide",
                    "access_scope": "user_owned_full",
                },
                {"path": str(course_root)},
            )
        self.assertEqual(corpus.audit["source_files"], 1)
        self.assertEqual(len(corpus.structure_anchors), 1)
        self.assertIn("minority attack", corpus.chunks[0].text)
        self.assertEqual(corpus.structure_anchors[0].source_chunk_id, corpus.chunks[0].chunk_id)

    def test_pawn_key_uses_fen_rank_order_and_ignores_pieces(self) -> None:
        fen = "4k3/ppp2ppp/8/3p4/3P4/4P3/PP3PPP/4K3 w - - 0 1"
        key = pawn_structure_key(fen)
        self.assertEqual(len(key), 64)
        self.assertEqual(key[:8], "........")
        self.assertEqual(key[8:16], "ppp..ppp")
        self.assertEqual(key, pawn_structure_key(chess.Board(fen)))

    def test_wikibook_snapshot_preserves_revision_attribution_and_legal_move_path(self) -> None:
        record = {
            "pageid": 123,
            "revid": 456,
            "title": "Chess Opening Theory/1. e4/1... e5",
            "permalink": "https://en.wikibooks.org/w/index.php?title=Example&oldid=456",
            "extract": (
                "Black mirrors White's central claim. White can build quickly with Nf3 and d4, "
                "while Black must choose active central counterplay and sound development. "
                "The resulting open positions reward rapid mobilisation and king safety."
            ),
        }
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "pages.jsonl"
            path.write_text(json.dumps(record) + "\n", encoding="utf-8")
            corpus = ingest_wikibook_jsonl(
                {
                    "id": "wikibook",
                    "title": "Chess Opening Theory",
                    "access_scope": "cc_by_sa_4_0",
                },
                {"path": str(path)},
            )
        self.assertEqual(len(corpus.opening_lines), 1)
        self.assertEqual(corpus.opening_lines[0].uci_line, "e2e4 e7e5")
        self.assertIn("revision 456", corpus.chunks[0].citation)
        self.assertTrue(corpus.chunks[0].text.startswith("Source page: https://"))

    def test_gutenberg_markers_do_not_leak_into_public_domain_chunks(self) -> None:
        text = """Project Gutenberg header
*** START OF THE PROJECT GUTENBERG EBOOK TEST ***
CHAPTER I
OPENING PRINCIPLES
Develop the pieces rapidly, control the centre, and avoid unnecessary pawn moves. A lead in development matters only when it can be converted by opening lines or gaining time against the king.
*** END OF THE PROJECT GUTENBERG EBOOK TEST ***
Project Gutenberg footer
"""
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "book.txt"
            path.write_text(text, encoding="utf-8")
            corpus = ingest_plain_text(
                {
                    "id": "capablanca",
                    "title": "Chess Fundamentals",
                    "access_scope": "public_domain",
                },
                {"path": str(path), "ebook_id": "33870"},
            )
        combined = " ".join(chunk.text for chunk in corpus.chunks)
        self.assertIn("control the centre", combined)
        self.assertNotIn("Project Gutenberg footer", combined)


if __name__ == "__main__":
    unittest.main()
