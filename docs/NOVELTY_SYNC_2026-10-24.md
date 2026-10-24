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

Native file transactions now capture source identities, find fresh game spans,
stage atomic replacements and preserve neighbouring bytes. New filenames and
metadata cannot clobber existing entries. Per-file UI ordering, list/preview
request generations, deletion identity and append guards are included. Eighteen
native filesystem and 93 frontend checks, types, scoped lint and a full native
check pass. See `NATIVE_PGN_FILES.md` for source/delivery boundaries and remaining
database-row/Clear-tabs work.

Native tab saves and close requests now retain the original tab/source and
immutable annotated PGN, check native errors, serialize/coalesce automatic writes,
and keep cancelled, failed or newly edited work open. Canonical live trees also
fix delayed-session duplication and background-close ownership; game selection
rejects stale reads and protects newer edits. Forty-one source/component checks,
TypeScript and scoped lint pass. Native atomic/source-checked file writes and
automatic Clear tabs remain open; this is source proof, with native/browser
delivery separate. See `TAB_SAVE_OWNERSHIP.md`.

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
The standalone desktop binary has subsequently been rebuilt as recorded below.
Phone Engine Plans capability remains a separate gap.

## Second verified delivery

Clean source `cc3e71d20bcaffc0604a6bb9ac0aae0ef9cce170` combines the native
Engine Plans/accuracy ports and source-picker refresh on both targets. It passes
151 selected checks across 23 files. Types, scoped lint, frontend/worker builds
and the existing guarded publisher pass. Unrelated primary source edits remain
outside this clean delivery snapshot.

Phone release `cc3e71d20bca-95ba505d5b32` is live at the canonical HTTPS root.
Health/version metadata agree with the source and shell SHA-256; library,
workspace and native tournament settings reads pass. Chrome at 390px verifies
Ready, the selected local database, refresh progress and retained search focus.
Original database/view/board state was restored after verification. This is PC
browser evidence, not a physical-phone check. Serve configuration is unchanged,
controller PID remains 24080, and the owner's enabled state is preserved. The
publisher restarted only the intended home server; native helper hashes are
unchanged.

The standalone desktop executable contains 51,086,336 bytes, SHA-256
`e52d696950b1976dbab760d6dc76cabb621556f2c0c3450732099ec133053952`.
The normal native frontend and Cargo release build pass (22 existing native
warnings). Embedded Engine Plans, analysis, live database selector and root-style
asset identities match the clean build. No native window was launched or
controlled; the existing Dev App launcher continues to use primary source.

The broader parity goal remains active. Phone analysis bounds/canonical reports,
Engine Plans/saved marks, date scopes and the remaining persistence families
still require implementation or target-specific evaluation.

## Third verified delivery

Clean source `5f5f45c48820d58e8f5d6edbeca70cf792d78190` includes native report
presets/combined limits, exact selected-move recovery, request/game ownership,
cancel/retry controls and verified PGN/session run-limit metadata. It also brings
the newly added Novelty result-label fix into native Database/Prep/review/health
and phone Database/Prep. Source details are in `GAME_ANALYSIS_LIMITS.md` and
`DATABASE_RESULTS.md`.

The clean delivery passes 54 selected checks across 11 files, full TypeScript
and frontend/worker builds. The nine result checks pass again after the colour
correction. Earlier native protocol checks and two real Stockfish 81-position
Low runs establish the search behavior; the real runs finish in 1.66/1.04 s with
legal exact evidence and depth no greater than 8. Suite counts overlap.

Phone release `5f5f45c48820-ea68491a9bec` is live at the canonical HTTPS root.
Health/version metadata agree, and library/workspace/native tournament settings
reads pass. Connected Chrome at 390px verifies tiny/zero result labels, no row
clipping/page overflow and actual White/draw/Black segment colours. Production
verification caught stylesheet precedence overriding class-only colours; the
final component binds them through Mantine's colour property. Original source,
Database setup stage and Moves view are restored, with board/engine state
preserved. This is PC-browser proof, not physical-phone interaction.

Serve JSON is byte-identical and controller PID 24080 is retained; only the
intended home server restarts. Owner enabled state and both native helper hashes
are preserved. The standalone desktop rebuild passes with 22 existing warnings:
51,084,800 bytes, SHA-256
`6dc8bea7db02715d7423db1e56f3d8041f0ad092004ed3416646bca24f8c809d`.
Embedded analysis, notation, result-bar and stylesheet keys match the clean
build. The previous executable is retained for rollback. The active Dev session
and shortcut remain; native-window interaction is unverified. Separate ongoing
primary edits are excluded from the delivery.

## Fourth verified delivery

Clean source `44c37e09869d94e66a091e7beef54b5cd7cf9805` carries imported PGN
perspectives and standalone starting positions through native preview/tab and
phone opening. Native previews now show saved annotations and variations in
read-only mode, with correctly oriented selected-node drawings and isolated
navigation/clock ownership. Circle export, default drawing brushes and palette
redraws are repaired; complete boards fit short/narrow panes. See
`PGN_ORIENTATION_PREVIEW.md`.

All 37 selected checks across 13 files pass with no unhandled errors. These
include real Chessground rendering/style changes, both notation layouts, native
tab ownership, actual phone PGN import controls and existing Prep regressions.
Types, scoped lint, frontend/worker and native builds pass. Chrome fixtures at
900/390/320px verify pieces/marks, side-line navigation, explicit perspectives
and bounded controls. Synthetic PGN imports use isolated test storage.

Phone release `44c37e09869d-d38a3d5b2fb0` passes matching canonical HTTPS
health/version, library/workspace/native tournament settings reads and connected
Chrome startup at 390px. Original owner source/view/board/engine state is
preserved; no synthetic game was imported into the live workspace. Serve JSON,
controller PID 24080, enabled state and helper hashes are preserved; only the
intended home server restarts. Physical-phone interaction is unverified.

The standalone desktop build passes with 22 existing warnings: 51,088,896 bytes,
SHA-256 `a1f6f3b0162a50795ced5a17ecb55bcc367706b02c19a1d3d2fa837f714eb329`.
Its embedded GamePreview, GameNotation, Chessground wrapper, orientation and
root-style asset keys match the clean bundle. The previous executable is kept
for rollback, and the active Dev session/shortcut remain. Native-window
interaction is unverified. The broader parity goal remains active.
