# Bounded evaluation builds

Novelty `2a083a83` added bounded, cancellable construction of the optional
evaluation store. En's command and CLI already built the same record format,
but had unbounded lines/sorts, no build quota or cancellation, permissive PV
token filtering and repeated records for the same position. Four actual
old-code failures reproduce those input/record gaps with tiny synthetic data.

`local_eval/build.rs` now streams into 32 KiB spool buffers, limits each source
line to 1 MiB and each sort shard to 64 MiB, and releases spool files after their
compressed shards are complete. The byte quota includes buffered spool data,
compressed outputs and the final manifest. It measures file contents, rather
than filesystem allocation overhead or a reserved amount of free space. The
decoder and line buffer are released before sorting. A source requiring larger
shards must use more shards rather than bypassing the memory bound.

The default quota is 64 GiB, matching Novelty's default. Native requests accept
an optional numeric `diskLimitGib` from 1 to 512; existing requests remain valid.
Rust callers can use `LocalEvalBuildControl` with a smaller byte quota for
synthetic sources. Each run needs a fresh control. CLI options are
`--disk-limit-gib` and `--cancel-file`; the signal's existing parent must be
outside the new output directory, and the signal is retained. CLI byte labels
use KiB/MiB/GiB consistently.

Native `cancel_local_lichess_eval_db` takes the request ID. The registry retains
the run through cancellation and cleanup, refuses overlapping IDs and removes
only its owned entry. Omitted IDs are generated per run; callers filtering
events should supply their own unique ID. Cancellation and publication share
an atomic boundary: a successful cancel cannot race a completed publication,
and cancel returns false once publication has won. It does not undo a completed
store or change the selected database.

Network connects have a 10-second bound and each blocked read a 30-second
stall bound. Progressing downloads have no total deadline. Cancellation is
cooperative between parsing, spool writes and sort/compression steps; it can
wait for an in-flight network read or sort. The opening event is emitted before
source access. Existing new-directory ownership, changed-owner retention,
nonempty completion and retryable errors remain; the manifest is synced through
a pending file and published last. Existing installed stores are never replaced.

PV syntax failures cannot reconnect moves across an invalid token. Exactly one
score kind is required, including valid zero scores. Candidate selection uses
validated PVs, so corrupt high-priority candidates cannot hide usable data.
Duplicate position keys retain the most PVs, then greater depth/node count,
with a deterministic byte tie-break. Reports/manifests count unique positions;
reports separately expose duplicates. Ingest progress counts usable input rows,
sorting/ready progress counts stored positions, and skipped counts unusable rows.
This validates syntax and storage evidence; it does not independently verify
source evaluations with an engine or re-analyse every source PV for chess legality.

The native entry points use these controls. The phone's installed readers have
no on-device corpus builder and continue to consume the existing immutable
store. This change does not copy, rebuild or select the retained corpus. GUI
download-management states and durable interrupted-job recovery are separate
audit items; ordinary failure/cancellation removes only the owned incomplete
output, and process termination can leave it for guarded recovery.

Verification uses small zstd/HTTP fixtures, actual CLI calls, exported native
type/function metadata and the generated command transport. The library tests
avoid constructing the GUI exporter; the normal application command registry
is checked by the native application build. No platform manifests, system DLLs,
running apps or browser sessions are modified for these tests.

Primary and the independent delivery checkout pass all 63 native library tests,
including 30 evaluation tests (18 new bounds/validation/transport-metadata
cases). Three generated command-transport checks, full TypeScript checks and
scoped lint pass. The actual CLI passes eight tiny-fixture acceptance cases;
the normal native application command registry compiles with 22 existing
warnings. No broad GUI test-exporter or platform-manifest change is required.
Clean delivery source `f33263de` packages successfully in 2m04s, with 22
existing native warnings and a 24.94-second frontend build. Its 47,953,920-byte
EXE has SHA256
`876f001e3c571e67bf5ca964397c253dd85639e681da824c27de3997c921593c`.
Four exact boot/App/files/bindings assets and the Windows IPC script are
embedded. All 102 engine/source resources (104,581,828 bytes) and eight owned
product/test files match. Generated command changes propagate new import hashes;
the consumer source is unchanged. Only two known generated outputs were
restored; delivery source is clean.

The actual packaged release CLI separately passes the same eight acceptance
cases (SHA256 `3195f4e8a11a2d3836c1c07772f4546ffe95672ca54cc9ee297582a8562b737f`).
The phone has no matching builder entry point and its currently delivered readers
are unchanged. No phone publication, explicit Dev restart, owner corpus build
or data/profile operation was needed. Rendered/native-window/physical-device
verification and the remaining history audit stay open.
