# Interrupted evaluation builds

Novelty `7128c5ed` preserves a download's identity across app termination. En's
native evaluation command and `build_lichess_eval_db` CLI now use that behavior
through En's existing bounded v1/v2-compatible builder. A process kill no longer
leaves an anonymous incomplete output that the app cannot safely identify.

The profile's `evaluation-download/jobs.sqlite3` records the exact job ID,
canonical new output path, random 16-byte ownership identity, shard count,
progress and settled outcome. SQLite commits use synchronous FULL. A separate
OS file lease remains held through processing, publication and final status.
Process termination releases that lease; recovery never guesses from a PID,
folder age or timeout. An active process can be observed but cannot be replaced
or cleaned up by another process. Native cancellation remains attached to its
original worker until that worker settles; status distinguishes cancelling and
whether the current native process can cancel it.

Reading status does not restart, resume or activate a build. With no owner
process, an unfinished output is shown as interrupted. A completed manifest is
recognized even if the process died before saving its final report. Such a job
has a validated store status and an absent report: unknown duplicate counts are
not invented. Failed and cancelled outcomes remain visible after reopening.
Corrupt, oversized, newer or unrecognized journal records stay visible as errors
and are not replaced with fresh state.

Cleanup requires the exact current job ID and the OS lease. It accepts only the
recorded canonical plain directory, its matching ownership marker, and a full
inventory of known incomplete files. Numeric shard names must fit the recorded
En shard count, including supported counts above 2048. Any published manifest,
unknown entry, changed marker, moved output or link/reparse point refuses cleanup
before deletion. Legacy or unrecorded folders are never guessed or swept.

Individual filesystem failures retain the recovery record and remaining files.
The marker stays until the final empty-directory removal; if Windows holds that
directory open, cleanup attempts to restore the marker with an exclusive new
file and exposes a retry. If that restoration also fails, the error says manual
inspection is required; no unmarked folder is recursively deleted on retry.
Completed stores are protected even if they cannot currently be read.

The native commands are `get_local_eval_build_job` and
`discard_local_eval_build_job`. Existing builds use the durable wrapper. The CLI
supports `--job-status`, `--remove-incomplete <id>` and `--journal-dir <path>`.
Recovery commands reject supplied output/build options: their scope comes from
the journal, not an arbitrary cleanup path. The default CLI journal is beside
its default store; fixture runs must specify an isolated journal explicitly.

Verification uses tiny synthetic zstd sources and canonical temporary folders.
It includes actual child-process termination during ingest, sorting and after
manifest publication, competing OS leases, settled cancellation, journal
corruption, stale cleanup IDs, unknown entries, Windows junctions and locked
files/directories. No full archive, retained corpus or owner profile is copied,
built or cleaned by these tests.

This is a native recovery backend and command milestone. The approved
[Settings row and dialogs](design/evaluation-data/README.md), reviewed acquisition
and validated persistent folder selection remain subsequent work. The phone
companion has no on-device corpus builder; its installed readers and hosted
service remain unchanged. Source/CLI proof is separate from native packaging,
rendered interactions and physical-device verification.

Primary and the separate delivery checkout each pass all 76 native library
tests, including 13 recovery tests. The ignored private child helper is exercised
by the process-termination test. Both pass six generated command-transport tests
and full TypeScript checks; scoped frontend lint has no warnings/errors. The
normal native command registry compiles with its existing 22 warnings. Actual
CLI acceptance passes 15 cases on synthetic data; the latest clean CLI includes
the stricter recovery-record parsing. Native packaging and approved UI delivery
are not claimed by these source/CLI checks.
