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
