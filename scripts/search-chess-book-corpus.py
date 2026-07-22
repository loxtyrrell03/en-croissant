#!/usr/bin/env python3
"""Search the local chess-book corpus with lexical, semantic, or hybrid ranking."""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import sys
from pathlib import Path

import numpy as np


DEFAULT_CORPUS = (
    Path.home()
    / "Documents"
    / "EnCroissant"
    / "AI Chess Coach Library"
    / "00 AI Corpus"
    / "chess-books.sqlite3"
)
RRF_K = 60


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", nargs="+", help="Natural-language search query")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--mode", choices=("hybrid", "fts", "semantic"), default="hybrid")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--candidate-limit", type=int, default=80)
    parser.add_argument("--max-per-book", type=int, default=2, help="Diversify results across books")
    parser.add_argument("--shelf", default=None, help="Optional case-insensitive shelf substring")
    parser.add_argument("--book-id", default=None)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--include-text", action="store_true", help="Include full chunk text in JSON output")
    return parser.parse_args()


def query_terms(query: str) -> list[str]:
    return [token.lower() for token in re.findall(r"[A-Za-z0-9]+", query) if len(token) >= 2]


def fts_expression(query: str) -> str:
    terms = query_terms(query)
    if not terms:
        raise ValueError("Search query has no indexable terms")
    return " OR ".join(f'"{term}"' for term in terms)


def filters(args: argparse.Namespace, prefix: str = "b") -> tuple[str, list[str]]:
    clauses: list[str] = []
    values: list[str] = []
    if args.shelf:
        clauses.append(f"lower({prefix}.shelf) LIKE ?")
        values.append(f"%{args.shelf.lower()}%")
    if args.book_id:
        clauses.append(f"{prefix}.book_id = ?")
        values.append(args.book_id)
    return (" AND " + " AND ".join(clauses) if clauses else ""), values


def lexical_candidates(connection: sqlite3.Connection, query: str, args: argparse.Namespace) -> list[tuple[str, float]]:
    where, values = filters(args)
    rows = connection.execute(
        f"""
        SELECT f.chunk_id,
               bm25(chunks_fts, 0.0, 6.0, 2.0, 3.0, 4.0, 2.0, 1.0) AS lexical_score
        FROM chunks_fts AS f
        JOIN chunks AS c ON c.chunk_id = f.chunk_id
        JOIN books AS b ON b.book_id = c.book_id
        WHERE chunks_fts MATCH ? {where}
        ORDER BY lexical_score
        LIMIT ?
        """,
        [fts_expression(query), *values, args.candidate_limit],
    ).fetchall()
    return [(str(row[0]), float(row[1])) for row in rows]


def load_embedding_metadata(connection: sqlite3.Connection) -> tuple[str, int] | None:
    model_row = connection.execute("SELECT value FROM metadata WHERE key='embedding_model'").fetchone()
    dimension_row = connection.execute("SELECT value FROM metadata WHERE key='embedding_dimension'").fetchone()
    if not model_row or not dimension_row:
        return None
    model = json.loads(model_row[0])
    dimension = int(json.loads(dimension_row[0]))
    return (model, dimension) if model != "none" and dimension > 0 else None


def embed_query(query: str, model_name: str) -> np.ndarray:
    from fastembed import TextEmbedding

    model = TextEmbedding(model_name=model_name)
    iterator = model.query_embed([query]) if hasattr(model, "query_embed") else model.embed([query])
    vector = np.asarray(next(iter(iterator)), dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm else vector


def semantic_candidates(connection: sqlite3.Connection, query: str, args: argparse.Namespace) -> list[tuple[str, float]]:
    metadata = load_embedding_metadata(connection)
    if metadata is None:
        return []
    model_name, dimension = metadata
    query_vector = embed_query(query, model_name)
    where, values = filters(args)
    rows = connection.execute(
        f"""
        SELECT e.chunk_id, e.vector
        FROM embeddings AS e
        JOIN chunks AS c ON c.chunk_id = e.chunk_id
        JOIN books AS b ON b.book_id = c.book_id
        WHERE 1=1 {where}
        """,
        values,
    ).fetchall()
    scored: list[tuple[str, float]] = []
    for chunk_id, blob in rows:
        vector = np.frombuffer(blob, dtype="<f4", count=dimension)
        score = float(np.dot(query_vector, vector))
        scored.append((str(chunk_id), score))
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[: args.candidate_limit]


def reciprocal_rank_fusion(
    lexical: list[tuple[str, float]], semantic: list[tuple[str, float]], mode: str
) -> list[tuple[str, float, int | None, int | None, float | None, float | None]]:
    lexical_rank = {chunk_id: index + 1 for index, (chunk_id, _score) in enumerate(lexical)}
    semantic_rank = {chunk_id: index + 1 for index, (chunk_id, _score) in enumerate(semantic)}
    lexical_scores = dict(lexical)
    semantic_scores = dict(semantic)
    if mode == "fts":
        candidates = set(lexical_rank)
    elif mode == "semantic":
        candidates = set(semantic_rank)
    else:
        candidates = set(lexical_rank) | set(semantic_rank)
    fused = []
    for chunk_id in candidates:
        lr = lexical_rank.get(chunk_id)
        sr = semantic_rank.get(chunk_id)
        score = 0.0
        if lr is not None and mode in {"fts", "hybrid"}:
            score += 1.0 / (RRF_K + lr)
        if sr is not None and mode in {"semantic", "hybrid"}:
            score += 1.0 / (RRF_K + sr)
        fused.append((chunk_id, score, lr, sr, lexical_scores.get(chunk_id), semantic_scores.get(chunk_id)))
    fused.sort(key=lambda item: item[1], reverse=True)
    return fused


def hydrate_results(
    connection: sqlite3.Connection,
    ranking: list[tuple[str, float, int | None, int | None, float | None, float | None]],
    limit: int,
    max_per_book: int,
    include_text: bool,
) -> list[dict]:
    results: list[dict] = []
    book_counts: dict[str, int] = {}
    for chunk_id, score, lexical_rank, semantic_rank, lexical_score, semantic_score in ranking:
        row = connection.execute(
            """
            SELECT c.chunk_id,c.book_id,b.title,b.author,b.shelf,b.coverage,c.chapter_title,
                   c.pdf_page_start,c.pdf_page_end,c.printed_page_start,c.printed_page_end,
                   c.citation,c.access_scope,c.diagram_candidate,c.contains_chess_notation,c.text,
                   b.local_path
            FROM chunks AS c JOIN books AS b ON b.book_id=c.book_id
            WHERE c.chunk_id=?
            """,
            (chunk_id,),
        ).fetchone()
        if row is None:
            continue
        book_id = str(row[1])
        if max_per_book > 0 and book_counts.get(book_id, 0) >= max_per_book:
            continue
        book_counts[book_id] = book_counts.get(book_id, 0) + 1
        text = str(row[15])
        result = {
            "rank": len(results) + 1,
            "score": round(score, 8),
            "lexical_rank": lexical_rank,
            "semantic_rank": semantic_rank,
            "lexical_score": lexical_score,
            "semantic_score": round(semantic_score, 6) if semantic_score is not None else None,
            "chunk_id": row[0],
            "book_id": row[1],
            "title": row[2],
            "author": row[3],
            "shelf": row[4],
            "coverage": row[5],
            "chapter_title": row[6],
            "pdf_page_start": row[7],
            "pdf_page_end": row[8],
            "printed_page_start": row[9],
            "printed_page_end": row[10],
            "citation": row[11],
            "access_scope": row[12],
            "diagram_candidate": bool(row[13]),
            "contains_chess_notation": bool(row[14]),
            "excerpt": re.sub(r"\s+", " ", text)[:500],
            "local_path": row[16],
        }
        if include_text:
            result["text"] = text
        results.append(result)
        if len(results) >= limit:
            break
    return results


def main() -> int:
    args = parse_args()
    query = " ".join(args.query).strip()
    if not args.corpus.exists():
        raise FileNotFoundError(f"Corpus database not found: {args.corpus}")
    connection = sqlite3.connect(f"file:{args.corpus.resolve()}?mode=ro", uri=True)
    try:
        lexical = lexical_candidates(connection, query, args) if args.mode in {"fts", "hybrid"} else []
        semantic = semantic_candidates(connection, query, args) if args.mode in {"semantic", "hybrid"} else []
        if args.mode == "semantic" and not semantic:
            raise RuntimeError("The corpus has no semantic embeddings")
        ranking = reciprocal_rank_fusion(lexical, semantic, args.mode)
        results = hydrate_results(connection, ranking, args.limit, args.max_per_book, args.include_text)
    finally:
        connection.close()

    payload = {
        "query": query,
        "mode": args.mode,
        "corpus": str(args.corpus.resolve()),
        "result_count": len(results),
        "results": results,
    }
    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"{len(results)} results for: {query}\n")
        for result in results:
            print(f"{result['rank']}. {result['title']} - {result['chapter_title'] or 'Available excerpt'}")
            print(f"   {result['citation']}")
            print(f"   shelf={result['shelf']}  hybrid={result['score']:.6f}  semantic={result['semantic_score']}")
            print(f"   {result['excerpt']}\n")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
