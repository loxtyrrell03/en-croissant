# AI Chess Coach book corpus

The lawful chess-book shelf has a reproducible, local ingestion and retrieval
layer. Generated data lives outside the repository at:

`C:\Users\loxty\Documents\EnCroissant\AI Chess Coach Library\00 AI Corpus`

This is the source layer used by the En Croissant desktop AI Coach and the
private PC-hosted phone Coach panel. It remains queryable from the command
line for corpus QA and retrieval experiments.

## Current corpus

- 103 catalogued books
- 95 installed official publisher-excerpt PDFs
- 8 metadata-only acquisition entries
- 1,561 indexed PDF pages
- 22 pages recovered with local OCR from the image-only *Modernized Sicilian
  Kan* excerpt
- 3,541 chapter records: 358 matched to pages available in the excerpts and
  3,183 retained as unavailable contents entries
- 1,605 page-bounded chunks with 1,605 exact PDF citations
- 1,605 local 384-dimensional `BAAI/bge-small-en-v1.5` embeddings
- 3,399 legality-checked opening variations and illustrative game lines,
  materialized as 67,054 source-linked line plies across 8,000 exact positions
- per-ply SAN, UCI, before/after FEN, source page, source chunk, and extraction
  confidence in SQLite plus portable JSONL and PGN
- SQLite FTS5 keyword search plus semantic search, combined with
  reciprocal-rank fusion
- zero extraction errors, OCR failures, orphan chunks, citation failures, or
  control/private-use glyphs in the searchable text

The corpus is approximately 33 MB, including retained OCR and on-demand page
renders. The source PDFs remain in their subject shelves and are not copied
into the corpus.

## Build

Install the local Python dependencies:

```powershell
python -m pip install -r scripts/chess-book-corpus-requirements.txt
```

Build or rebuild the complete corpus:

```powershell
python scripts/build-chess-book-corpus.py
```

Useful development options include `--limit`, `--no-ocr`, `--no-embeddings`,
`--library-root`, and `--output`. Output files are written through temporary
files and atomically replaced after SQLite integrity checks.

## Search

```powershell
python scripts/search-chess-book-corpus.py "candidate moves and calculation"
python scripts/search-chess-book-corpus.py --json "when should I exchange pieces"
python scripts/search-chess-book-corpus.py --mode fts "isolated queen pawn"
python scripts/search-chess-book-corpus.py --mode semantic "saving a bad position"
```

Hybrid search is the default. It combines FTS5 and semantic rank with
reciprocal-rank fusion, and returns at most two chunks per book by default so a
coach sees complementary sources rather than eight near-duplicate passages
from one title. Each result includes:

- book ID, title, author, shelf, and coverage
- chapter label when an available page can be matched safely
- exact PDF page and supported printed-page number
- local PDF path
- access scope and source rights class
- chess-notation and diagram-candidate flags
- a ready-to-display citation

## App integration

The desktop coach reads the corpus directly from Rust. Before the AI selects
categories and chapters, the coach compares every supplied game position with
the exact opening-line index. A match identifies the real book, accessible
chapter, cited page/chunk, exact book PGN, matched game ply, and whether the
played move followed or diverged from the book continuation. Those matches
receive priority inside the AI-selected retrieval scope. The response carries
the exact source objects separately from generated prose, so the UI can always
show the excerpt, full title, author, chapter, citation, local PDF, and
interactive cited-line board independently of what the model says. Stockfish
remains authoritative for concrete move verdicts; books support the human
lesson and use exact `[Source chunk_id]` citations.

The phone uses the same retrieval contract through the private home server:

- `GET /api/chess-coach/health` reports corpus and model readiness.
- `GET /api/chess-books/search?q=...` returns citation-safe passages.
- `GET /api/chess-books/pdf?bookId=...` streams an authorized local PDF with
  byte-range support; the UI opens it at the cited PDF page.
- `POST /api/chess-coach` completes a cache-first PC evaluation sweep, finds
  exact book-line positions, asks AI to choose the relevant categories and
  chapters, retrieves within that scope, and asks the pinned coach model to
  synthesize the review.

The phone scan is deliberately cache-first: stored PC evaluations are used
when available, and only misses are sent sequentially to live PC Stockfish.
The review does not begin until every requested unique position has either
been analyzed or reported as a failure.
The private server invokes an ephemeral, read-only `codex exec` run with the
explicit `gpt-5.6-sol` model at medium reasoning. The model receives only the
prepared Stockfish and book evidence and is instructed not to use tools. No
model credential or book text is stored in the browser.

The native En Croissant coach uses the same contract for its main answer,
Stockfish-work planner, chess-fact planner, line repair, fact audit, and inline
plan reports. Every active stage is pinned to `gpt-5.6-sol` at medium reasoning
through the locally authenticated Codex CLI; legacy request field names remain
only for binding compatibility. Stockfish remains authoritative for concrete
analysis, while the model explains that evidence and the retrieved book
passages.

Codex is installed once on the gaming PC and uses its saved ChatGPT login. The
server checks authentication with `codex login status` and disables the phone
submit button until it succeeds. Authentication probes are coalesced, use the
same explicit Codex home as model runs, and distinguish a genuine signed-out
response from a transient process failure. A temporary probe timeout cannot
erase a previously confirmed session. While the dependency is unavailable,
the phone retries readiness automatically and clears obsolete errors after the
PC recovers.

## Page and diagram fidelity

Chunks never cross PDF-page boundaries. This is intentional: a model may merge
adjacent retrieved passages in its synthesis, but every underlying claim must
remain traceable to an exact source page.

Chess diagrams are frequently encoded as private-use font glyphs. Those glyph
blocks are removed from searchable prose and replaced with an explicit visual
fallback marker. The page stays marked `diagram_candidate=true`. Render an
exact cited page with:

```powershell
python scripts/render-chess-book-page.py thinking-ramesh 29
```

The resulting PNG can be inspected by a person or sent to a vision-capable
model. The pipeline does not claim to reconstruct FEN from PDF glyphs.

Textual opening notation is handled separately. Publisher figurines are
normalized to SAN, nested sidelines branch from their real pre-move node, and
every accepted move must replay legally from a rooted position. Explicit move
numbers may re-anchor only to a unique legal prior position. Unrooted,
ambiguous, and illegal fragments are counted in `opening-line-report.json`
rather than guessed into the exact-position index.

Coach diagrams are rendered from the stored FEN chain, not from the PDF's
diagram font. Every key game position and exact cited opening line includes a
read-only board, the relevant PGN/move label, a next-move arrow, and backward
and forward controls.

## Generated files

- `chess-books.sqlite3`: normalized books, pages, chapters, chunks, FTS5, and
  embeddings
- `books.jsonl`: portable book-level source registry
- `pages.jsonl`: cleaned page text and page-level extraction metadata
- `chapters.jsonl`: available and contents-only chapter map
- `chunks.jsonl`: portable citation-safe retrieval units
- `opening-lines.jsonl`: exact opening line/game records with every mapped ply
- `opening-lines.pgn`: portable PGN export of every recoverable rooted line
- `opening-line-report.json`: per-book accepted and unresolved notation audit
- `chapter-review.json`: automatic chapter-mapping caveats
- `ingestion-report.json`: extraction, OCR, embedding, and readiness audit
- `retrieval-tests.json`: database and concept-retrieval test results
- `page-renders/`: OCR pages and on-demand visual fallbacks

## Verification

Run:

```powershell
python scripts/test-chess-book-corpus.py
```

The test checks SQLite integrity, record counts, embedding/chunk parity,
citations, foreign-key ownership, line/move cardinality, exact FEN-chain
continuity, initial-position lookup, and hybrid concept retrieval for
calculation, exchange decisions, defence, rook endings, and computer chess.
Parser unit tests separately cover figurine notation, nested sidelines, and
the refusal to guess unrooted prose fragments. The current corpus passes every
case, with an expected specialist source ranked first in each category.

## Jellyfin cover artwork

The local Jellyfin `Chess Books` library points at the source shelf directly.
Build persistent JPEG sidecars and refresh that library with:

```powershell
python scripts/build-jellyfin-chess-book-covers.py --force
```

The script reads the catalogue's product-page URLs, downloads the corresponding
official cover artwork, validates and normalizes each image, and writes it next
to its PDF using the same basename. A small reviewed override table handles
retired or generic catalogue links; a rendered first PDF page remains the final
fallback. It never writes an access token: for a local refresh it reads an
existing Jellyfin device token from Jellyfin's own database and uses the normal
HTTP API. Use `--skip-jellyfin` when only the sidecars should be rebuilt.

The current run produced 97 valid covers: 95 recognisable book covers and two
designed shelf-catalogue covers. Jellyfin indexed all 97 as primary images, and
all 97 were fetched successfully through the private HTTPS phone endpoint. The
detailed source, dimensions, digest, fallback reason, and verification result
are recorded in `00 Master Library Guide/Jellyfin cover report.json`.

Cover images are for this private personal library and must not be redistributed.

## Rights boundary

The current searchable content consists of official publisher excerpts. It is
local-only and must not be redistributed. Catalogue-only books have
`access_scope=metadata_only`; installed samples use
`access_scope=publisher_excerpt`. Lawfully acquired complete editions should
be imported as `access_scope=user_owned_full` in the future.

The corpus is technically and product-integrated for AI retrieval, but it does
not provide full-book coverage. Future full-edition imports and mini-PDF
assembly must preserve source, edition, page, access scope, and attribution.
