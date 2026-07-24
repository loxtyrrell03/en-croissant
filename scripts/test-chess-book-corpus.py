#!/usr/bin/env python3
"""Deterministic smoke tests for the generated chess-book retrieval corpus."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SEARCH_SCRIPT = REPO_ROOT / "scripts" / "search-chess-book-corpus.py"
DEFAULT_CORPUS = (
    Path.home()
    / "Documents"
    / "EnCroissant"
    / "AI Chess Coach Library"
    / "00 AI Corpus"
    / "chess-books.sqlite3"
)

CASES = [
    {
        "query": "candidate moves calculation visualization",
        "expected_books": {"thinking-calculation", "thinking-ramesh", "thinking-tisdall", "thinking-super-gm"},
        "label": "calculation process",
    },
    {
        "query": "when should I exchange pieces and what remains after the exchange",
        "expected_books": {"middlegame-exchanges", "middlegame-understanding-exchanges"},
        "label": "exchange decisions",
    },
    {
        "query": "defend against an attack create counterplay and counterthreats",
        "expected_books": {"defence-hellsten", "attack-defence-gmp", "tactics-swindler"},
        "label": "defence",
    },
    {
        "query": "rook endgame practical technique theoretical position",
        "expected_books": {"endgame-theoretical-rook", "endgame-conceptual-rook", "endgame-nunn-2", "endgame-100"},
        "label": "rook endings",
    },
    {
        "query": "AlphaZero neural engine improve human chess understanding",
        "expected_books": {"practical-game-changer", "practical-silicon-road", "practical-reengineering"},
        "label": "computer chess",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--mode", choices=("hybrid", "fts", "semantic"), default="hybrid")
    parser.add_argument("--output", type=Path, default=None)
    return parser.parse_args()


def search(corpus: Path, query: str, mode: str) -> dict:
    completed = subprocess.run(
        [sys.executable, str(SEARCH_SCRIPT), "--corpus", str(corpus), "--mode", mode, "--limit", "8", "--json", query],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr or completed.stdout)
    return json.loads(completed.stdout)


def main() -> int:
    args = parse_args()
    if not args.corpus.exists():
        raise FileNotFoundError(args.corpus)
    connection = sqlite3.connect(f"file:{args.corpus.resolve()}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        counts = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "books",
                "pages",
                "chapters",
                "chunks",
                "opening_lines",
                "opening_line_moves",
                "embeddings",
            )
        }
        citation_failures = connection.execute(
            "SELECT COUNT(*) FROM chunks WHERE citation='' OR pdf_page_start IS NULL"
        ).fetchone()[0]
        orphan_chunks = connection.execute(
            "SELECT COUNT(*) FROM chunks c LEFT JOIN books b ON b.book_id=c.book_id WHERE b.book_id IS NULL"
        ).fetchone()[0]
        foreign_key_failures = len(connection.execute("PRAGMA foreign_key_check").fetchall())
        malformed_opening_lines = connection.execute(
            """
            SELECT COUNT(*)
            FROM opening_lines line
            LEFT JOIN (
                SELECT line_id, COUNT(*) AS actual_moves
                FROM opening_line_moves
                GROUP BY line_id
            ) moves ON moves.line_id=line.line_id
            WHERE line.move_count != COALESCE(moves.actual_moves, 0)
            """
        ).fetchone()[0]
        broken_opening_chains = connection.execute(
            """
            WITH ordered AS (
                SELECT
                    line_id,
                    move_index,
                    fen_before_key,
                    LAG(fen_after_key) OVER (
                        PARTITION BY line_id ORDER BY move_index
                    ) AS previous_after
                FROM opening_line_moves
            )
            SELECT COUNT(*)
            FROM ordered
            WHERE move_index > 0 AND fen_before_key != previous_after
            """
        ).fetchone()[0]
        initial_position_matches = connection.execute(
            """
            SELECT COUNT(*)
            FROM opening_line_moves
            WHERE fen_before_key=?
              AND uci IN ('e2e4', 'd2d4', 'c2c4', 'g1f3')
            """,
            ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",),
        ).fetchone()[0]
    finally:
        connection.close()

    case_results = []
    for case in CASES:
        payload = search(args.corpus, case["query"], args.mode)
        retrieved = [result["book_id"] for result in payload["results"]]
        hit_ranks = [index + 1 for index, book_id in enumerate(retrieved) if book_id in case["expected_books"]]
        case_results.append(
            {
                "label": case["label"],
                "query": case["query"],
                "expected_books": sorted(case["expected_books"]),
                "retrieved_books": retrieved,
                "passed": bool(hit_ranks) and min(hit_ranks) <= 5,
                "first_expected_rank": min(hit_ranks) if hit_ranks else None,
            }
        )

    report = {
        "corpus": str(args.corpus.resolve()),
        "mode": args.mode,
        "integrity_check": integrity,
        "counts": counts,
        "citation_failures": citation_failures,
        "orphan_chunks": orphan_chunks,
        "foreign_key_failures": foreign_key_failures,
        "malformed_opening_lines": malformed_opening_lines,
        "broken_opening_chains": broken_opening_chains,
        "initial_position_matches": initial_position_matches,
        "retrieval_cases": case_results,
        "passed": (
            integrity == "ok"
            and counts["books"] >= 100
            and counts["chunks"] > 500
            and counts["opening_lines"] > 0
            and counts["opening_line_moves"] > counts["opening_lines"]
            and counts["embeddings"] == counts["chunks"]
            and citation_failures == 0
            and orphan_chunks == 0
            and foreign_key_failures == 0
            and malformed_opening_lines == 0
            and broken_opening_chains == 0
            and initial_position_matches > 0
            and all(case["passed"] for case in case_results)
        ),
    }
    output = args.output or args.corpus.parent / "retrieval-tests.json"
    temp = output.with_suffix(output.suffix + ".tmp")
    temp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    temp.replace(output)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
