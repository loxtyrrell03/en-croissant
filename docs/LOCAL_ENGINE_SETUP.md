# Local engine setup

Native Add engine and Edit engine now retain ownership of file selection,
explicit UCI checks and profile saves. This ports Novelty's late-validation
protection through En Croissant's existing native dialogs and profile writer.

A check requires `uciok`, has a total 15-second response deadline and awaits
process shutdown with a separate two-second bound. Cancellation addresses only
the matching request. Silent programs, continuous output and EOF before
`uciok` cannot leave setup waiting indefinitely or produce a partial success.
Closing the dialog or changing its tab invalidates replies and requests native
cancellation. A cancelled check cannot register an engine, including when its
original native reply succeeds later. Setup does not run an analysis search.

Custom names entered during a check survive its result. Rechecking the same
program preserves tuning, network paths, visibility and profile metadata;
selecting another program uses that program's required defaults. Cancelling an
image chooser keeps the existing image. A draft restored without a trusted
validation is checked before registration; editing a known profile's labels
does not start its program.

Manual additions receive a fresh profile ID and check the latest saved profile
list before writing. Add/Edit await the ordered profile writer and readback.
Failed writes retain their original operation for Retry save without appending
another profile. Reopening Add exposes the retained save or Done state. Editing
uses profile identity and a baseline comparison so another owner's changed
profile cannot be silently overwritten. Save confirmation, including the
managed Stockfish card's Added state, reacts to persistence snapshots even when
the profile array itself has not changed.

The primary source passes 95 focused frontend checks across eight files, full
TypeScript checking and seven-file lint with no warnings or errors. Four real
component failures were reproduced against the old form before the repair:
late closed-dialog replies, overwritten names, cleared images after chooser
cancellation and lost custom/hidden engine settings. The new checks also cover
cancel/retry, stale image replies, retained save failures, duplicate prevention,
profile conflicts and saved-state loss.

Six native checks pass, including explicit validation of the pinned real
Stockfish 19 identity/options without searching. Tiny synthetic peers exercise
EOF, silent/flooding programs, cancellation and ignored quit, with actual
process-exit checks. The main native target also compiles. The pre-existing
broad native baseline failures are tracked separately and are not relabelled
as passing by these focused checks.

This is a desktop setup surface. The phone's managed WASM engine and existing
PC service do not offer arbitrary local-program selection, so these native
setup commands do not apply there. No phone publication or service restart is
required for this slice. Clean source `dab8e02d` independently passes 549
related frontend checks across 71 files and full types. Primary `d7f563ca` and
clean source contain the same owned setup changes. Combined package checks
follow separately.
Browser control remains disabled; no rendered native-window or physical-phone
verification is claimed.
