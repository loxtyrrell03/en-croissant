# Novelty to En Croissant synchronization

Audit window: 24 July–24 October 2026. Review includes current working sources
and all local branch histories, because several finished Novelty improvements
were committed on feature/release branches rather than primary. Initial history
inventory: 573 Novelty and 373 En Croissant commits touching source, native
source or scripts. These counts include research, repeated integrations and
release work; they are not counts of missing features.

## Delivery contract

En Croissant desktop and the PC-hosted phone companion are separate delivery
targets. Preserve native Mantine/Chessground interfaces and the phone's existing
navigation, service ownership and canonical HTTPS origin. Port behavior through
each target's architecture. Do not promote rejected/unvalidated research models,
Novelty licensing, payments, proprietary distribution or marketing into En
Croissant. Existing independent En Croissant features must survive integration.

Initial source snapshots and patches are retained locally under
`tmp/novelty-sync-20261024`. They include unfinished shared Stats and tournament
work and unrelated tactical changes; snapshotting does not authorize erasing or
committing unrelated work.

## Verified milestones

| Improvement | Desktop | Phone | Verification / delivery |
| --- | --- | --- | --- |
| Strict online PGN dates, Novelty `33978469` | Incremental database cursor rejects impossible calendar dates; unknown time retains the valid UTC day | Online PGN imports use the same validator for ordering and filtering | 28 focused tests, whole-project TypeScript, scoped lint. Source committed; binary/runtime delivery pending |

The date fix preserves completion-header precedence, valid leap days and ISO
offsets. It does not rewrite existing databases. Provider-native epoch timestamps
remain authoritative where already available.

| Shared performance inference, cancellable workers, rated/unrated filters and short/custom periods | Reconciled native Account Stats integration, preserving engine-based analysis | Reconciled Overview and provider bounds, including pre-game rating/provisional uncertainty adapter | 193 focused tests, whole-project TypeScript, production Vite build; source saved, runtime delivery pending |
| Saved board drawing ownership, Novelty `5f3ea481` | Saved arrows/circles are editable shapes; temporary engine/hover arrows stay in `autoShapes`. Hidden saved plans survive edits. Existing erase-on-click preference is passed to Chessground | Existing phone boards use transient drawings and need a separate saved-mark integration | 11 drawing/PGN/comment tests, project TypeScript. Desktop source saved; native and phone delivery pending |
| Tournament evidence and manual results | Reconciled strict known/unknown result and availability evidence, valid rounds/targets, published assignments, private manual-result projection, serialized writes and shared native snapshot assembly | Same shared Tracker, Prep and service contract; publishing must retain October phone handoff changes | 316 frontend tests; 84 native core/CLI tests pass, 3 opt-in checks ignored. Full TypeScript and main Vite build pass. Installed/hosted delivery pending |
| Exact FIDE identity, ambiguity and retry | Reconciled keyboard-accessible board/Game info entry points, PGN FIDE-ID precedence, explicit match selection, aborted/stale request guards and retryable profile opening | Existing shared request-lifetime and identity helpers retain the same identity/failure contract | 25 utility/actual React component tests, project TypeScript and scoped lint. Desktop source saved; binary delivery pending |

## Integration inventory in progress

The existing sparse phone delivery checkout now merges primary source through
`64f8a5c6` with the live-phone branch through `7ea2eadb`. September Stats conflicts
were resolved to the verified October estimator, workers and range transport;
October phone opponent-picker, orientation, direct-link and installed-root
handoff changes are retained. No new checkout, dependency tree or corpus copy was
created. The clean combined source passes 548 focused tests, an additional
69 phone storage/import/Prep tests, 62 service/build/controller tests (one optional
engine check skipped), full TypeScript and the complete frontend/worker build.
The existing shared review runtime was regenerated from committed source;
uncommitted checking-ray research in primary remains excluded.

The first guarded publication built both native helpers but stopped before
activation when Windows PowerShell could not resolve `Get-FileHash`. The shared
streaming .NET SHA-256 helper now removes that command dependency for manifest
and native-helper verification. The publish-guard suite passes, including the
standard `abc` digest with module auto-loading disabled; no ancestry, clean-source
or integrity check was removed. Delivery status remains pending the retry.

| Area | Initial finding | Next verification |
| --- | --- | --- |
| Performance estimator, workers and custom periods | 23 of 24 matching shared files are byte-identical, including the model, workers and controls; the phone adds adapter tests. Source reconciliation is now committed | Reconcile prerequisites, test desktop/phone adapters, then deliver |
| Tournament evidence, manual results and source integrity | Existing primary source includes substantial later guards absent from the September deployed native service | Reconcile source dependencies and test native/frontend contract before delivery |
| October phone opponent Prep handoff | Live app identifies `44f46c86`; newer than primary's phone integration | Retain its ancestry and handoff behavior in the publishing snapshot |
| Board drawings and file preferences | Novelty has new saved-mark isolation, multi-arrow and per-file preferences | Compare with native/phone Chessground and storage behavior |
| Analysis and Engine Plans | Novelty has October analysis budgets/accuracy changes and new continuation coverage | Compare algorithms and controls through each target's native interfaces |
| Prep/database controls and filtering | Novelty has source refresh, archives, date ranges and responsive fixes | Audit equivalent native/phone paths before choosing required ports |
| Scheduler, review, dialogs and Files | Novelty's October audit fixed several race/failure paths | Reproduce equivalent defects in En Croissant; do not replace different implementations wholesale |

This is an active audit ledger, not a claim of complete feature or deployment
parity. Installed desktop, served phone and physical-device evidence must be
recorded separately as work progresses.

## First phone delivery

Source `8ff91aaac8bb1c4cea21a35fc285368601781d1c` is live at
`https://lox-pc.tail89d19b.ts.net/`. Canonical HTTPS health and app-version
source/hash agree; the publisher verified native settings RPC and both rebuilt
helper hashes. Chrome renders the connected Board and Ready service status,
and Stats exposes Last day, Last 3 days, Custom duration/unit and Apply before
loading an account. This is desktop-browser delivery proof, not physical-phone
verification. The desktop release executable is being rebuilt separately.

The remaining source differences are tracked in
`NOVELTY_SYNC_GAPS_2026-10-24.md`; the all-branch candidate inventory is
`NOVELTY_SYNC_2026-10-24_INVENTORY.json`. The goal remains active.
