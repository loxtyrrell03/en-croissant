# Proprietary Rebuild — Phase Status (extraction side)

**Canonical status now lives in the proprietary repo: `C:\Users\loxty\Desktop\Repos\outpost-chess\docs\PHASE_STATUS.md`.** This file tracks extraction-side work only.

Last updated: 2026-07-02.

Phase 0 (provenance, scope, design direction) is **complete** in this workspace. The fresh proprietary repo `outpost-chess` exists with independent git history; Phases 1-2 are done there and Phase 3 is underway. This repository is now a read-only extraction/reference archive: open it again only for controlled owner-hunk extraction passes, appending results to `approved-owner-delta/` with new manifest rows.

## Phase 0 artifact inventory

- `docs/extraction/PROVENANCE_MANIFEST.md` — done
- `approved-owner-delta/` (MANIFEST.md + manifest.csv + 154 files) — done
- `docs/extraction/PARITY_CHECKLIST.md` — done (behavior-only, copied into fresh repo)
- `docs/extraction/DESIGN_BRIEF.md` — done

## Known blockers / needs-owner or legal review

- Piece/board/sound assets: interim permissive assets acceptable for dev; commercial release needs commissioned or verified rights-cleared set.
- Online service terms review (Lichess, Chess.com, World Chess/FIDE Online Arena) before shipping adapters.
- Engine distribution: keep engines user-supplied; bundling requires legal review.
- Product name "Outpost" is a working codename pending owner approval.
