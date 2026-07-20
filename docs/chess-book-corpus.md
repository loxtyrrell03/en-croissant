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
- 3,322 chapter records: 387 matched to pages available in the excerpts and
  2,935 retained as unavailable contents entries
- 1,609 page-bounded chunks with 1,609 exact PDF citations
- 1,609 local 384-dimensional `BAAI/bge-small-en-v1.5` embeddings
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

The desktop coach reads the FTS5 corpus directly from Rust. Each question is
expanded into a compact concept query, results are diversified to at most two
passages per book, and up to six page-bounded passages are included in the
existing model/Stockfish prompt. The response carries the exact source
objects separately from the generated prose, so the UI can always show the
excerpt, title, author, chapter, citation, and local PDF independently of what
the model says. Stockfish remains authoritative for concrete move verdicts;
books support the human lesson and are cited as `[Book N]`.

The phone uses the same retrieval contract through the private home server:

- `GET /api/chess-coach/health` reports corpus and model readiness.
- `GET /api/chess-books/search?q=...` returns citation-safe passages.
- `GET /api/chess-books/pdf?bookId=...` streams an authorized local PDF with
  byte-range support; the UI opens it at the cited PDF page.
- `POST /api/chess-coach` retrieves passages, scans PC-stored evaluations for
  the user's moves, ranks cache-backed critical moments, and asks the pinned
  coach model to synthesize the review.

The phone scan is deliberately cache-first. It does not start a live
Stockfish search for every move and therefore cannot clog the shared engine
queue. If stored whole-game evidence is incomplete, the prompt must disclose
that limitation and restrict concrete claims to evidence it actually has.
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
submit button until it succeeds.

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

## Generated files

- `chess-books.sqlite3`: normalized books, pages, chapters, chunks, FTS5, and
  embeddings
- `books.jsonl`: portable book-level source registry
- `pages.jsonl`: cleaned page text and page-level extraction metadata
- `chapters.jsonl`: available and contents-only chapter map
- `chunks.jsonl`: portable citation-safe retrieval units
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
citations, foreign-key ownership, and hybrid concept retrieval for calculation,
exchange decisions, defence, rook endings, and computer chess. The current
corpus passes every case, with an expected specialist source ranked first in
each category.

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
