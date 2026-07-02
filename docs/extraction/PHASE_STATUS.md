# Proprietary Rebuild — Phase Status

Canonical copy: once the fresh repo exists, `docs/PHASE_STATUS.md` in the proprietary repo is canonical; this file tracks extraction-side work only.

Last updated: 2026-07-02.

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Provenance, scope, design direction | **In progress** — provenance manifest done; owner-delta bundle built (154 files); parity checklist generating; design brief done |
| 1 | Fresh repo + product shell | Starting — sibling repo `outpost-chess` with independent history |
| 2 | Chess core + fresh data model | Not started |
| 3 | Engine/eval foundation | Not started |
| 4 | Databases, files, sources, search | Not started |
| 5 | Owner import: research/planning | Not started |
| 6 | Owner import: prep + coach | Not started |
| 7 | Owner import: review/training/play | Not started |
| 8 | Online data, studies, sync, phone/web | Not started |
| 9 | Polish, packaging, migration | Not started |
| 10 | Full parity audit + release gate | Not started |

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
