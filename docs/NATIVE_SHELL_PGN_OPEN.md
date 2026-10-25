# Retained native PGN requests

Novelty e8914f49 fixes more than Finder startup: PGN paths must survive until a
workspace can receive them. En's old second-instance callback ignored both args
and cwd, revealing its window without opening the requested files. The old
frontend read one CLI file only during startup. An isolated Rust harness executes
the exact old callback with synthetic arguments and reproduces the lost batch
while confirming the reveal still occurs. No owner file or app was opened.

## Native and frontend ownership

The shared native shell_open module validates existing PGN files without reading
or changing them. It resolves relative paths against the sender's directory,
accepts case-insensitive extensions and paired shell quotes, and preserves real
filename spaces. Directories, missing paths, other formats and remote URLs do not
enter the queue. Initial argv and second-instance requests use the same managed
queue. Pending duplicates retain first-request order; an explicit later request
can reopen a previously drained file. Window reveal behavior remains.

The shell://open-paths event is only a hint. The native queue retains its batch
until take_shell_open_paths is called. The native App starts its subscription only
after existing startup initialization is ready, and subscribes before its first
drain. One frontend queue serializes returned batches and retains them across
root cleanup, delayed subscription and an in-flight native read. Its lifetime is
the running document; this is not cross-crash file-open persistence.

Each path uses En's existing openFile/pgnFiles.read path and captured native source
identity. There is no foreign PGN decoder, separate file writer or replacement of
existing tabs. A cancelled owner checks its AbortSignal before starting and
immediately before the synchronous, prepared-tab commit. It cannot create an
obsolete tab after its read completes; its replacement retries that request.
Already committed requests are removed even if cleanup follows, avoiding a
duplicate tab. A failed file shows the existing error notification and does not
block the rest of the batch. Native queue/subscription failures retain requests;
opening the file again supplies another notification/retry.

The native Mac Opened event is routed through the same validation/queue behind
its target cfg. Windows source, fixtures and compilation do not establish Mac
delivery. The phone's browser-upload/server transport stays separate; its
existing opening and persistence tests remain in the combined regression gate.

## Verification boundaries

Five tiny native fixtures cover sender paths, quotes/spaces, validation, retained
ordering/deduplication and initial argv. Ten frontend queue fixtures cover races,
serialization, cancellation/remount, delayed IPC/listeners, failure/retry,
completed-request ownership and browser exclusion. Two real React hook fixtures
cover readiness and effect cleanup; two additions to the actual protected
openFile fixtures cover cancellation before/during a read. Existing source
identity/clock-hydration checks remain intact.

The original combined phone workspace fixture exceeded its default5s deadline
in the initial primary/clean530-check runs (529 passed, one timed out). Prior
source control completes its assertions in4.55s, leaving little timing margin.
Its17 assertions now run as two independent real-component workflows with fresh
synthetic workspace state: orientation/remount, and per-file Database/Prep source
choices. Both retain the default deadline; none are skipped or weakened. The
isolated split takes1.18s/3.30s, and the full primary run passes531 checks/76 files.
Full types and eight-file lint pass without warnings/errors. The native library
fixtures and the actual Windows command registration compile; the latter retains
22 existing warnings. The separate13 known broad native failures are unchanged
and were not rerun for this slice.

The source milestone, independent clean checks and native package evidence are
tracked in NOVELTY_SYNC_2026-10-24_DELIVERY.json. Rendered native-window behavior,
Windows shell association interaction, Mac packaging and physical-phone proof
are separate. No owner profile, database, active review or hosting route needs
to change for this native feature.
