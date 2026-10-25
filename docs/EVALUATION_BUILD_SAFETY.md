# Evaluation build output ownership

Novelty's optional evaluation builder (`2a083a83`) refuses existing directories
and removes only its own failed output. En Croissant's older builder instead
used second-resolution staging/backup names, replaced the destination on
success, and could leave new staging files after failure. This was an applicable
gap in the native command and the `build_lichess_eval_db` CLI.

The builder now atomically acquires a new output directory and writes a random
ownership marker. Existing files, empty directories, complete stores and another
in-progress build are refused before source processing. No timestamp-derived
staging/backup directory is reused or deleted. Completed manifests are published
only after a nonempty export has been processed and all shards have been written.

On ordinary failure, cleanup requires the same canonical directory, a matching
marker and no directory symlink/reparse point. Ownership is rechecked after
progress callbacks, before sorting/cleanup and before manifest publication.
Changed ownership is retained.
Once the completed manifest has been written, marker-cleanup failure cannot
delete that valid store or suggest repeating the build. Existing shard formats,
lookup choices and build-request fields are unchanged. CLI help now states that
the output must be new; running against an existing default returns an error.

Four regression fixtures fail on the old builder: existing output replacement,
replacement of a completed store, empty export publication and retained new
staging output after malformed input. All six new cases and the six existing
evaluation cases pass independently in primary and delivery checkouts. Added
cases cover a concurrent build and a changed ownership marker during failure.
Tests use tiny synthetic zstd sources and temporary directories only.

The phone's installed readers consume the shared immutable corpus and expose no
on-device evaluation builder. This slice neither copies nor rebuilds that corpus,
changes a selected path, nor restarts a service. Native clean `2c342d72` packages
in 1m44s with 22 existing warnings; the 47,892,480-byte EXE has SHA256
33173d188a770296a180a80e3a39c5b8168e1abb83d2fd13690ffcb845f00439.
The three exact embedded app chunks are unchanged; new builder refusal strings,
the exact Windows IPC script and all 102 engine/source resources (104,581,828
bytes) are verified. Four owned product/test files match primary `c2d054d1`. Only
two known generated outputs were restored to exact HEAD bytes; checkout clean.
Only synthetic test outputs were built; no Dev restart was requested. Packaging
is also tracked in the current delivery JSON. Frontend source is unchanged; the
previous frontend gate is not counted as rerun here. Native-window and
physical-device checks are separate.

The subsequent bounded-builder milestone in EVALUATION_BUILD_LIMITS.md adds
input/sort/disk bounds, strict PV/score validation, unique-position selection,
cooperative cancellation and network stall limits. The ownership package above
is historical proof of that earlier slice. EVALUATION_BUILD_RECOVERY.md records
the subsequent native journal, process lease and guarded recovery commands.
The reviewed acquisition backend is source-verified in
EVALUATION_DOWNLOAD_REVIEW.md. Persistent source activation and the approved
A data-management UI are now source-verified in EVALUATION_DATA_SELECTION.md.
