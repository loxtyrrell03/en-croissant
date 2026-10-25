# Stored evaluations in live analysis

Novelty `ece3e18e` and `18f81ed0` introduced one explicit stored-evaluation
choice. En Croissant now carries it through its native and phone analysis paths.

## Native desktop

The Engines header and both analysis panel layouts share **Stored evals** and
the existing adjacent keyboard/touch help control. The saved
`local-engine-stored-evaluations` boolean defaults to On, preserving the former
local-engine behavior. A saved Off is read before the first analysis render.
Off skips stored lookup for local UCI engines. Explicit Lichess, ChessDB and PC
engine profiles keep their independent enabled settings and routing.

The engine cache filters stored provenance on both read and write. This covers
the evaluation bar, rows, arrows, detached view and later cache consumers;
deferred row/header snapshots receive the same display guard. Actual engine
lines remain available. A stored local fallback score is hidden immediately.
Turning the choice on again permits the existing stored cache.

Each local-analysis lifetime owns an abort signal. A late stored hit or miss
cannot start an obsolete UCI search, restore a stored score or launch local
continuations. An already issued shared lookup may finish and populate its
shared cache; cancelling its consumer does not cancel other users of that read.
Continuation searches receive the same lifetime. Successors await queued stop
or kill RPC settlement for the same native engine/tab; independent engines and
tabs do not wait. Waits are abortable and bounded at fifteen seconds. An expired
wait is not evidence that an unknown stop completed.

Failed preference writes keep the current choice through route unmount/remount,
show the failure and offer **Retry saving**. Saving does not warm an engine.
This preference is separate from the retained engine-profile writer and does
not rewrite executable paths, custom tuning, profile IDs or the default engine.

## Hosted phone

Analysis A's Live settings expose **Stored evals** for PC Stockfish. The existing
saved `useCloud` setting was previously ignored by the request path; it is now
honored. Valid saved values, the fresh-profile Off default and the legacy
missing-field On normalization remain unchanged. This is an intentional
target-specific default, rather than a migration to native's default.

Off bypasses stored requests, cached hits, prefetch and failure fallback, even
when a caller also asks to prefer stored evaluations. Wrong-engine and stored
display snapshots are filtered immediately, including the retained parent score
and arrow source. Real prior engine scores remain stable during retargeting.
Old requests cannot publish after the choice changes.

The transport's optional `useStoredEvaluations` defaults to On for existing
batch callers. Local WASM and LCZero retain their fresh-analysis paths. Finite
game reports and Engine Plans keep their exact, fresh evidence and budget rules.
Saved annotations are unchanged. Failed Live-setting writes retain the desired
settings through panel remount and offer retry without reanalysis.

## Verification and delivery

The old native cache exposed stored scores after Off and accepted late stored
writes; the old phone panel did not pass its saved Off choice to analysis.
These failures were reproduced before the fixes. Focused checks exercise actual
Jotai/React controls and EngineListener, cached transport/failure routing,
ownership, first-render preferences, retained scores and save failure/retry.
Related engine setup, streaming, startup and bounded-report regressions pass.

Source/component tests do not prove rendered 320/390px layout, native-window
interaction or physical-phone behavior. Browser control remains disabled in
Work settings. Clean delivery package/build and publication receipts are
recorded separately in `NOVELTY_SYNC_2026-10-24_DELIVERY.json`; this document alone
does not establish that a running installed binary or hosted app was updated.


Clean source `41f60e91` independently passes 591 related checks across 79 files,
including all phone tests, and full types. The native release build passes
(22 existing warnings); eight exact compressed assets are embedded in the
47,864,320-byte executable, SHA-256
`13c5b5d33781d1fa4fd08e8375e10fb5a6372ad350300bc8a6c630c8b3cfe4bb`.
All 102 engine/source files match the retained 104,581,828-byte tree, and all
22 owned committed files match primary `645932cc`. The canonical phone build
passes in 22.47 seconds; both native helpers build. Only the two known generated
outputs were restored, leaving the delivery checkout clean.

That source is now live at `https://lox-pc.tail89d19b.ts.net/`, shell SHA-256
`a0917a23e5df33c1c63646d8b6a001b2ae43f7905d99a650c30f5de3a463642c`.
Independent HTTPS checks verify metadata, exact entry/plan/WASM assets, unchanged
saved workspace/tournament settings, library reads and a legal exact Stockfish 19
depth-8/50-ms report. The owner enabled choice, engine-service PID and Serve
configuration remain. The home-server PID changed for the intended publication.
The live library has a volatile generatedAt, so a normalized before/after library
content comparison is not claimed from the original complete-hash preflight.

The publisher's redirected output wrapper remained open after successful live
activation. After independent checks, only that wrapper was stopped and its
temporary task removed; the same verified server stayed running. There is no
normal publisher-exit receipt, and publication was not replayed. Future helpers
must avoid PowerShell output capture around this publisher, including implicit
file-redirection pipelines, until the inherited-output problem is repaired.
Fresh browser inventory remains disabled. Rendered and physical-device checks
and the wider history audit remain open.

## Recovery after downloaded-data read failures

The separate Novelty `848f4527` fix is now implemented in the native stored
reader. A rejected command or unreadable shard raises a structured lookup
failure; only a completed readable lookup can establish a cached miss. Pending
reads for the same FEN/PV count are shared, bounded and removed on settlement.
Failed cleanup cannot remove a newer pending request. Native status-aware
analysis can show the failure and use the engine, while optional-score consumers
retain their existing local catches. The reader avoids the generic unwrap
helper's extra global notification. No network fallback or data rewrite is added.

Three failures were reproduced on the prior source: swallowed read errors,
same-position recovery blocked by a false miss, and duplicated pending reads.
Four native fixtures now pass, including genuine-miss caching. A phone transport
fixture verifies its existing 503/rejected-request eviction: real PC evidence
can answer the failure, and the same position gets stored evidence once readable.
The phone's production routing already had that behavior and is unchanged.
An actual EngineListener check also verifies inline failure status, real local
fallback and same-FEN wake/retry recovery.
Twenty-four related checks across five files, full types and four-file lint
without warnings/errors pass. Native package verification is tracked separately
in the delivery JSON; the live phone remains verified source `41f60e91`.
