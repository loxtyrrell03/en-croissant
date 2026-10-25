# Native engine preference safeguards

`engines/engines.json` keeps its existing array format and directory selection.
The native engine preference store distinguishes a missing file, a valid empty
list, valid profiles and an unreadable file. Reading never rewrites the file.
Recognized legacy defaults are normalized in memory, while extra fields from
newer versions remain present. Invalid JSON or profiles leave the saved bytes
untouched and stop automatic discovery from treating the list as a new install.
File absence is confirmed by listing its parent directory after a failed read;
a boolean existence check cannot turn an access error into a fresh installation.

Startup respects an intentionally empty list. Discovery waits while any tab has
analysis enabled, including focus-paused analysis, or a Play tab remains open.
It checks the current state again after lookup and discards replies after an
owner edit or unmount. File lookup does not start an engine. Existing profile
IDs, labels, images, visibility, search limits and explicit tuning values remain;
discovered defaults only fill missing settings. Metadata can refresh the known
installed version/path without replacing the owner's choices.
Matching is by executable path; a reused managed ID cannot repoint an owner's
different install. A newer saved engine version is never downgraded by discovery.

Engine edits use an ordered writer that captures an immutable JSON snapshot.
Native file output is staged beside the destination and renamed into place;
failed replacement removes only that write's temporary file. The writer checks
expected saved bytes and verifies readback. An observed external edit blocks the
save and retains pending settings; it does not force an overwrite. This check is
not a cross-process lock, and an external conflict still needs reconciliation.
If a write's outcome was uncertain, Retry observes matching destination bytes
before attempting another write.

Failed settings remain available after a component/provider remount. The Engines
page shows Retry load or Retry save, and a persistent notification points to the
error. Pending saves require keeping the app open. Editing is blocked while the
saved list cannot be loaded. Remote-profile name edits capture the input value
before awaiting state and address the original profile by ID.

`set(enginesAtom, ...)` updates the visible model and queues a retained save;
it is not a durable-write receipt. Migration code must await the preference
store's write/`flush()` before marking an upgrade complete. The controller owns
failure status so rejected UI writes cannot silently disappear.

Twenty-one focused synthetic checks cover unreadable/empty stores, preserved
settings, native staged replacement, failed/uncertain/overlapping saves, observed
external edits, mutation after capture, real startup/retry/remount behavior,
enabled/paused analysis and stale replies. Primary `66ffb51d` and clean delivery
`9a37cc0b` independently retain the same twelve owned product/test files. Clean
verification passes all 591 related checks across 75 files, whole-project types
and twelve-file lint with one existing engine-options effect warning, no errors.
Desktop and canonical-phone production builds pass in 22.56/22.08 seconds.
This is source/component/build evidence, with no manual profile migration,
binary install or service restart performed by this milestone.

Native Stockfish 19 installation/catalog/default migration and live PC/phone
delivery remain separate. Phone WASM 19 and shared-helper UCI identity are now
implemented and verified in source; see `ENGINE_VERSION_ROUTING.md`. These
profile safeguards alone do not establish installed/rendered version parity.
