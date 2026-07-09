# Proprietary rebuild handoff — fork-side reference

**Status:** current handoff · **Last rewritten:** 2026-07-09 · **Active rebuild:** `C:\Users\loxty\Desktop\Repos\outpost-chess`

The active proprietary plan now lives with the product being built:

- [Current Outpost execution plan](../../outpost-chess/docs/PROPRIETARY_REBUILD_PLAN.md)
- [2026-07-09 parity audit](../../outpost-chess/docs/parity-audit/2026-07-09/README.md)
- [Full surface and behavior matrix](../../outpost-chess/docs/parity-audit/2026-07-09/MATRIX.md)
- [Active gap ledger](../../outpost-chess/docs/parity-audit/2026-07-09/GAP_LEDGER.md)
- [Deterministic fixture contract](../../outpost-chess/docs/parity-audit/2026-07-09/fixtures/README.md)
- [Hidden screenshot workflow](../../outpost-chess/docs/parity-audit/SCREENSHOT_WORKFLOW.md)
- [Long-running rebuild goal prompt](../../outpost-chess/docs/PROPRIETARY_REBUILD_GOAL_PROMPT.md)

This fork-side file is deliberately short. The old plan mixed clean-room strategy, speculative architecture, completed implementation waves, commit chronology, prompt templates, and several superseded audits. Git history retains that history; it is not the current backlog.

## Vision

Build the same capable chess product as the owner’s En Croissant fork as the owner’s own proprietary software that can be sold.

That means:

- equivalent user jobs, depth, flows, intermediate states, persistence, scale, and reliability;
- an original commercial implementation boundary, identity, copy system, assets, schemas, build files, packaging, and release process;
- explicit decisions for deliberate Outpost improvements rather than silently calling differences “parity.”

It does not mean copying protected fork/native implementation, branding, or final shipped assets.

## Non-negotiable boundaries

- Keep the Tauri 2, Rust, TypeScript, React, Vite, and SQLite baseline unless the owner explicitly changes it.
- Do not copy GPL/native base implementation into the proprietary shipping tree without a separate written license.
- Reuse owner-authored non-native deltas only after provenance extraction confirms ownership and separation from inherited code.
- Ship only original or right-cleared branding, copy, icons, board/pieces, fonts, sounds, screenshots, sample data, and other assets.
- Record the origin/license of every shipped dependency and asset.
- Treat final legal release approval as an owner/counsel gate, not an engineering assumption.
- Never use the owner’s live data for destructive, migration, or corruption testing.

## Purpose of this fork

This repository is the behavior/reference side of the clean-room process. It may be used to:

- enumerate features and states;
- observe behavior and flows;
- produce internal parity references;
- write behavior specifications and tests;
- identify and provenance-check owner-authored reusable deltas.

It is not the implementation base for Outpost’s proprietary native layer, schemas, assets, build identity, or packaging.

## Current phase

Outpost already has broad desktop coverage. The current phase is not “build an MVP.” It is:

1. build an isolated deterministic fixture/capture harness;
2. close Database and review correctness/scale gaps;
3. complete durable full-game analysis and Prep jobs;
4. resolve owner decisions;
5. perform fixture-backed visual and interaction sign-off;
6. complete provenance, migration, packaging, signing, recovery, and release gates.

The exact row-by-row status and acceptance conditions are in the linked Outpost matrix and ledger. Do not recreate a second backlog here.

## Reference and screenshot rules

- Browser captures are supplementary and cannot prove native Tauri behavior.
- Empty/setup images cannot prove populated Database, Prep, review, Files, Accounts, Engines, or report parity.
- Database and Prep evidence must show started data-bearing tables, every fixture row across top/middle/bottom captures, counts, source, Strength/After Prep or CP, Games, WDL, Games evidence, and Options.
- Missing transient/error/progress states must remain marked fixture-required; do not fabricate mocks and call them product evidence.
- All fork and owner-data captures are internal-only and must never ship or appear in marketing.
- Future capture must run hidden/off-screen and must not activate the owner’s app or move the operating-system pointer.
- Follow the linked screenshot workflow for the exact WebView2/CDP launch, capture, top/middle/bottom, validation, manifest, comparison, and cleanup procedure.

## Phone/PWA

Phone/PWA/web-companion parity is deferred unless the owner explicitly reopens it. Historical phone screenshots remain useful reference evidence, not an active Outpost completion gate.

## Next-agent workflow

1. Read the active Outpost plan, matrix, ledger, and fixture contract.
2. Check both worktrees and preserve unrelated changes.
3. Work from the first unfinished ledger item in the recommended order unless the owner directs otherwise.
4. Implement and verify in Outpost using isolated fixture data.
5. Add deterministic paired evidence and update the authoritative Outpost matrix/ledger.
6. Use this fork only for behavior reference/provenance work that is necessary for that item.

The goal remains stable: **the same product and usefulness, rebuilt as the owner’s own commercial software without inheriting the fork’s protected implementation or identity.**
