# Provenance Manifest — Fork vs Upstream En Croissant

Date: 2026-07-02
Extraction workspace: this GPL-derived fork repository (read/inspect only; no proprietary implementation here).

## Baseline facts

- Upstream remote: `origin` = franciscoBSalgueiro/en-croissant (GPL).
- Fork branch analyzed: `codex/en-croissant-fork` (HEAD as of 2026-07-02).
- Merge-base with `origin/master`: `14ae9478a35e12798ccbe6582af142ac20277d25` (2026-03-13, upstream commit "Updated French translation").
- Owner commits after merge-base: **626**, all authored by **Lox Tyrrell** (single-author history; matches the owner attestation that all non-native functionality was owner-added).
- Changed paths vs merge-base: **194 added**, **127 modified**, **1 deleted**.
- Parallel-addition check: **none** of the 194 added files exist anywhere in current `origin/master` — every added file is owner-only, not an upstream backport.
- `src-tauri/src/lib.rs` (added) was verified to contain only a single owner-written line (`pub mod local_eval;`) — it is NOT relocated GPL base code.

## Classification rules applied

| Class | Meaning | Reuse status |
| --- | --- | --- |
| `owner-code-ts` / `owner-code-rust` | New file created by owner after the fork point, absent upstream | Copy allowed via approved-owner-delta bundle |
| `owner-test` | New owner-authored test file | Copy allowed via bundle |
| `owner-doc` | Owner-authored docs (`agents.md`, `docs/*`) | Copy allowed via bundle (internal use) |
| `owner-script` | Owner-authored scripts (`scripts/*`) | Copy allowed via bundle; adapt fork-specific names/paths |
| `owner-web-asset-review` | Owner-authored public/PWA files | Copy allowed after stripping old product naming/branding |
| `excluded` | Third-party assets, branding derivatives, screenshots, session artifacts, generated reports | DO NOT copy into the proprietary repo |
| `gpl-base-modified` | Pre-existing GPL file modified by owner | DO NOT copy wholesale; owner hunks only via controlled per-feature extraction passes, or reimplement from behavior specs |

## Excluded items of note (do not copy)

- `public/pieces/chesscom-neo/**` and `public/pieces/chesscom-neo.css` — chess.com Neo piece set (third-party). Proprietary app must ship original or rights-cleared pieces.
- `sound/chess-com/*.mp3` — chess.com sounds (third-party). Ship original/cleared sounds.
- `scripts/assets/en-croissant-fork.ico` — En Croissant branding derivative.
- `public/daily-goals/streak-fire.png` and all `*.png` screenshots — unclear rights or session artifacts; private design references only.
- `reports/**` — generated owner report artifacts; private references, not product code.
- `.playwright-mcp/**` — session artifacts.

## Modified GPL-base files (127)

These files existed at the fork point and were edited by the owner. They contain interleaved GPL base code and owner feature hunks. Policy:

1. Never copy these files wholesale into the proprietary repo.
2. Behavior they carry is preserved through the behavior-only parity checklist (`docs/extraction/PARITY_CHECKLIST.md`).
3. If a specific owner hunk is later needed verbatim, run a controlled extraction pass in THIS repo (`git diff 14ae9478..HEAD -- <file>` + manual hunk review) and add the reviewed hunk to the bundle with an `owner-hunk` entry. Default is reimplementation from spec.
4. Generated files over GPL base (`src/routeTree.gen.ts`, `src/bindings/generated.ts`, lockfiles) and translation files are never copied; regenerate/rewrite fresh.

High-value files in this class (behavior to reimplement fresh, hunk extraction optional later): the game-tree state module, board/analysis UI containers, opening-stats table, database search/index Rust modules, engine process module, PGN/chess utility modules, settings page, files page, and state atoms module.

## Full file-level listing

See `approved-owner-delta/manifest.csv` for the complete row-per-file classification (path, class, included yes/no, note) covering all 194 added + 127 modified paths.

## Owner attestation record

- 2026-04-27 past-week attestation: recorded in the rebuild plan.
- 2026-07-02 full-history attestation: owner states all non-native fork functionality was owner-added; verified consistent with single-author post-fork history (626/626 commits by owner).
- Items still requiring manual/legal review before commercial release: third-party service adapters' terms (Lichess, Chess.com, World Chess/FIDE Online Arena), engine distribution policy (Stockfish/Maia/LC0 stay user-supplied or separately downloaded), and any asset whose provenance is not listed here.
