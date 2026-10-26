# Report visibility belongs to the current session and workspace

Novelty33069e28/d86b2aff starts reports minimized, remembers an explicit opening
for that tab and discards that layout choice at the next session. Search settings
and saved report evidence remain independent.

En Croissant desktop already follows this through its native Engines/Report/Logs
tabs. `currentAnalysisTabAtom` uses an in-memory per-tab atom family initialized
to Engines. Selecting Report is its explicit opening action; switching another
board does not open that board's report. A fresh app store or newly opened tab
starts on Engines. Two new actual Jotai-store checks verify those existing paths.
Adding a second collapse control would duplicate the native selector and is not
needed for this behavior. There is no desktop production-code or binary change.

The phone's approved Analysis A uses Live/Game report/Plans. Its previous single
BoardWorkspace view state leaked Report or Plans into a different loaded source
and forgot an explicit view on leaving Board. An actual WebApp regression fails
on the old source when a second file inherits Report. The app-root
`usePhoneAnalysisView` now remembers each loaded database or Prep separately,
with a distinct blank-board owner. Games within the same loaded source share
the choice. New sources and fresh app sessions start on Live; returning to an
existing source during the session restores its explicit selection. Leaving
Board does not lose that choice. Removed sources/Prep entries are pruned, so
reopening the same identifier does not revive an old report view.

This is temporary app state. It never enters localStorage, the saved workspace,
PGN/report evidence, personal-library sync or the persistent file preferences.
The loaded source ID intentionally differs from the durable normalized file
path used for orientation and source preferences. Storage failure still permits
view changes. A queued old-owner choice checks the current session snapshot
before changing either workspace. The legacy explicit online-analysis request
opens Live once, rather than replaying an earlier request on owner changes.

Report panels retain their existing mounted job/visibility behavior, saved-result
ownership, cancellation, limits and retry. The existing live-engine On/Off choice
remains authoritative. Layout, help and the owner-selected compact navigation
are unchanged. No new design direction or approval is required for this fix.

Verification:481 checks in69 files pass across the complete phone test directory
and selected native atom/report/limit suites. They include actual WebApp file/
game/route navigation and report-save/Plans actions, plus stale queued choices,
removed/reopened sources, Prep/blank-board isolation, fresh sessions and failed
storage. Full TypeScript passes. Five-file lint has no errors or new warnings;
the exact25 existing WebApp warning messages match its committed baseline.
Primary independently passes19 checks in five focused files and full types,
preserving its existing owner source remainder. Product commit c4120833 is pushed
on both source branches. The canonical phone build completes, and the normal
guarded publisher returns successfully. Ten exact HTTPS shell/WebApp/Stockfish
JS/WASM/manifest/service-worker files match the build. Saved workspace/catalog
content, PGN/database-position reads, tournament settings and healthy private
sync match before/after publication. The actual unpackaged runtime verifies15
modules, matching collector/core binaries, the fresh helper child, both immutable
notice sidecars and complete no-data CLI notices. Seven owner files, pinned sync
helpers/task, gateway PID/standby and all Serve routes are preserved; temporary
publisher/verifier tasks are removed. There is no native production change, so
the prior verified b4c9288c desktop artifact remains. Browser control is unavailable;
rendered/native-window and physical-phone evidence remain unverified. The full
parity audit remains open; see the current delivery JSON.
