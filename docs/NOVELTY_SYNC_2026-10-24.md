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
| Strict online PGN dates, Novelty `33978469` | Incremental database cursor rejects impossible calendar dates; unknown time retains the valid UTC day | Online PGN imports use the same validator for ordering and filtering | 28 focused tests, whole-project TypeScript, scoped lint. First batch: phone deployed, desktop executable rebuilt |

The date fix preserves completion-header precedence, valid leap days and ISO
offsets. It does not rewrite existing databases. Provider-native epoch timestamps
remain authoritative where already available.

| Shared performance inference, cancellable workers, rated/unrated filters and short/custom periods | Reconciled native Account Stats integration, preserving engine-based analysis | Reconciled Overview and provider bounds, including pre-game rating/provisional uncertainty adapter | 193 focused tests, whole-project TypeScript, production Vite build; First batch: phone deployed, desktop executable rebuilt |
| Saved board drawing ownership, Novelty `5f3ea481` | Saved arrows/circles are editable shapes; temporary engine/hover arrows stay in `autoShapes`. Hidden saved plans survive edits. Existing erase-on-click preference is passed to Chessground | Existing phone boards use transient drawings and need a separate saved-mark integration | 11 drawing/PGN/comment tests, project TypeScript. Desktop executable rebuilt; phone saved-mark integration remains pending |
| Tournament evidence and manual results | Reconciled strict known/unknown result and availability evidence, valid rounds/targets, published assignments, private manual-result projection, serialized writes and shared native snapshot assembly | Same shared Tracker, Prep and service contract; publishing must retain October phone handoff changes | 316 frontend tests; 84 native core/CLI tests pass, 3 opt-in checks ignored. Full TypeScript and main Vite build pass. First batch: phone helpers deployed, desktop executable rebuilt |
| Exact FIDE identity, ambiguity and retry | Reconciled keyboard-accessible board/Game info entry points, PGN FIDE-ID precedence, explicit match selection, aborted/stale request guards and retryable profile opening | Existing shared request-lifetime and identity helpers retain the same identity/failure contract | 25 utility/actual React component tests, project TypeScript and scoped lint. Desktop executable rebuilt; native interaction unperformed |

## Integration inventory in progress

The existing sparse phone delivery checkout now merges primary source through
`64f8a5c6` with the live-phone branch through `7ea2eadb`. September Stats conflicts
were resolved to the verified October estimator, workers and range transport;
October phone opponent-picker, orientation, direct-link and installed-root
handoff changes are retained. No new checkout, dependency tree or corpus copy was
created. The clean combined source passes 548 focused tests, 69 phone storage/import/Prep tests, 62 service/build/controller tests (one optional
engine check skipped); these focused suites overlap, full TypeScript and the complete frontend/worker build.
The existing shared review runtime was regenerated from committed source;
uncommitted checking-ray research in primary remains excluded.

The first guarded publication built both native helpers but stopped before
activation when Windows PowerShell could not resolve `Get-FileHash`. The shared
streaming .NET SHA-256 helper now removes that command dependency for manifest
and native-helper verification. The publish-guard suite passes, including the
standard `abc` digest with module auto-loading disabled; no ancestry, clean-source
or integrity check was removed. The guarded retry succeeded as source `8ff91aaa`.

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
verification. The desktop release executable was rebuilt separately from the same product source; embedded worker/FIDE/root-style asset identities match the build. Native-window interaction was not performed.

The remaining source differences are tracked in
`NOVELTY_SYNC_GAPS_2026-10-24.md`; the all-branch candidate inventory is
`NOVELTY_SYNC_2026-10-24_INVENTORY.json`. The goal remains active.

## Main source and desktop artifact

The first-batch product source is also merged into the main development branch,
retaining newer phone code. Pre-existing edits in overlapping guidance/package/
generated-runtime files were saved exactly and reapplied separately; the tactical
research source, native export work, generated bindings and other unfinished
changes remain outside the delivery commits. The Dev App shortcut continues to
use its existing primary-source launcher and was not changed or launched.

The standalone native artifact at `src-tauri/target/release/en-croissant-fork.exe`
contains 51,106,816 bytes; SHA-256
`4b6499ae43479b076a6532addd4fe8fbadf3c8368249bca6043021f156b83f9d`.
A verified pre-build rollback copy is retained under the ignored task directory.
This proves build/linkage and file replacement, not native-window interaction.
Canonical HTTPS library manifest and workspace reads and a native tournament
settings RPC also pass; the full Serve configuration is byte-identical to its
pre-publication snapshot. See the compact delivery JSON.

## Engine Plans source port

The native chessops implementation now validates legal/unique root evidence,
retains actual source ranks, uses depth 17 for fresh preferences, and displays
all first-five root choices with their own exact scores. Quiet rook/queen moves,
competitive alternative pawn breaks, castling and short minor-piece routes keep
their exact preparation/arrival snapshot. Different origins and preparation
routes cannot manufacture recurrence. Immediate/medium/long horizons filter
each occurrence before grouping and use cached lines without an engine restart.

Later ideas display a labelled conditional score from the highest-ranked
supporting root PV, with accessible help explaining its source and White
perspective. That value never enters independent plan/setup strength arithmetic.
En Croissant's existing setup mining remains intact. Sixty-six focused
plan/presentation/strength checks, full types, scoped lint and frontend build pass.
Actual changed Mantine components were checked in Chrome at 390px, including
bounded help, dismissal and horizon selection, using an invented fixture.
This is source/component evidence; the standalone desktop binary still contains
the preceding batch. Phone Engine Plans capability remains a separate gap.
