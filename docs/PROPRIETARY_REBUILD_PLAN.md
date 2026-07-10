# Proprietary rebuild handoff — fork-side reference

**Status:** focused V1 handoff · **Updated:** 2026-07-10

**Active rebuild:** `C:\Users\loxty\Desktop\Repos\outpost-chess`

The authoritative plan lives with Outpost:

- [Focused V1 execution plan](../../outpost-chess/docs/PROPRIETARY_REBUILD_PLAN.md)
- [Focused scope and full-work recovery](../../outpost-chess/docs/FOCUSED_V1_SCOPE.md)
- [Current phase status](../../outpost-chess/docs/PHASE_STATUS.md)
- [Long-running focused goal prompt](../../outpost-chess/docs/PROPRIETARY_REBUILD_GOAL_PROMPT.md)
- [Hidden screenshot workflow](../../outpost-chess/docs/parity-audit/SCREENSHOT_WORKFLOW.md)
- [Historical parity evidence](../../outpost-chess/docs/parity-audit/2026-07-09/README.md)

## Current product decision

The long-term vision remains the same capable chess product, rebuilt as the
owner's independently controlled proprietary software with original/right-cleared
implementation, identity, assets, schemas, packaging, and release process.

The immediate release target is deliberately smaller: a preparation-first V1.
Retained scope is Home analysis/latest/online/import, Files/folders, Databases,
board/notation/annotations, engines, Prep, Plan Explorer, Engine Plans, Compare,
Info, Accounts, and focused Settings.

Deferred features are Play Chess, Blindfold, Opening Review, repertoire
Practice/review due badges, Mistake Review, Puzzle Training, standalone Reports
and Files style reports, Daily Goals, Pawn Structures, AI Coach, and phone/PWA.
Their absence on Outpost `main` is not a parity bug.

## Preserved full rebuild

The exact Outpost state before this reduction is preserved at:

- branch `codex/full-parity-rebuild-2026-07-10`;
- commit `194c0e3` (`Checkpoint complete parity rebuild before V1 focus`).

Outpost `docs/FOCUSED_V1_SCOPE.md` contains exact inspect, switch, worktree, and
selective-restoration commands. No Git remote was configured when the checkpoint
was made, so the archive is local until the owner adds a remote and pushes it.

## Clean-room boundary

This fork remains behavior/provenance reference material, not the implementation
base for Outpost's proprietary native layer, schemas, build identity, assets, or
packaging. Do not copy GPL/native-base implementation into the shipping tree
without a separate written licence. Reuse owner-authored deltas only through the
reviewed provenance process. Final commercial release still requires owner/legal
review.

## Screenshot rule

Use the July corpus only for retained V1 surfaces during this phase. Capture
hidden/off-screen; never activate either product or move the owner's pointer.
On Windows, changing `APPDATA`/`LOCALAPPDATA` did not isolate Tauri
`app_data_dir()`. Before fixture writes, verify an explicit backend data-dir
override with `storage_status`; otherwise capture read-only. Follow the linked
workflow for populated Database/Prep top/middle/bottom sequences, manifests,
diffs, and cleanup.

Do not recreate another backlog in this fork. Update the authoritative Outpost
plan and use Git history plus the archive branch when deferred work is resumed.
