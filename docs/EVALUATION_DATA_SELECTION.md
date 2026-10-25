# Evaluation folders and Settings controls

The approved A layout is implemented in native Settings → Directories: one
Evaluation data row opens folder selection and download dialogs. The existing
serif/cyan theme and adjacent PerformanceHelp controls are retained. Narrow
Settings windows use a category selector and full-width content. Paths and
facts wrap; build phases without a total remain indeterminate.

Choosing a folder first checks it without changing the current source. Native
recognition accepts the exact store or an unambiguous known child, resolves a
root alias, and checks the supported manifest, shard inventory and one bounded
sample through the real v1/v2 decoder. It refuses foreign/incomplete manifests,
empty data, ambiguous parents, nested linked entries and invalid sample records.
Manifest reads are bounded to 1 MiB and decoded shard reads to 64 MiB. Sparse
bucket layouts are supported; the manifest bucket count does not imply every
bucket has a file. This is compatibility validation, not a full-corpus scan.

Use evaluations separately rechecks the candidate and commits the canonical
path to a dedicated profile `evaluation-source.sqlite3` preference. A random
revision and immediate SQLite transaction prevent a stale window overwriting a
newer selection. Unsupported/corrupt settings remain intact; failed commits keep
the old preference and allow retry. Tokens expire after 15 minutes and a newer
choice supersedes an earlier check. Metadata plus the sample hash detect changes
between check and use, including a same-size sample with restored modification
time. There is no filesystem-wide atomic snapshot of an externally editable
store; evaluation data is expected to be immutable.

Reading an untouched profile retains its legacy `lichess-cloud-evals` location
without creating a settings database or downloading data. This slice adds
explicit selection, not automatic source discovery or fallback. Remaining
Novelty automatic-discovery/readiness history is still listed in the audit queue.

Successful activation clears native shard caches and emits a source event.
Frontend cache epochs reject old hits, misses, pending responses and displayed
stored scores. Other processes' selections are observed by read-only focus,
visibility and 15-second visible polling. Actual UCI analysis and the Stored
evals On/Off preference retain their own ownership; a folder change does not
stop or restart a local-only engine search.

The download dialog uses the reviewed backend and durable job described in
[EVALUATION_DOWNLOAD_REVIEW.md](EVALUATION_DOWNLOAD_REVIEW.md) and
[EVALUATION_BUILD_RECOVERY.md](EVALUATION_BUILD_RECOVERY.md). Review and Start
are separate. Closing/reopening restores the native job; a failed status read
keeps the last known job. A lost Start acknowledgement is checked rather than
replayed, with cancellation retained until the job can be identified. A ready
build needs explicit Use evaluations. Cleanup confirms the frozen recorded
path/ID and exposes refusal or retry beside it.

Primary and the separate delivery checkout pass 101 native library checks
(12 new source tests), 48 focused frontend checks across eight files, and full
TypeScript checks. Pure specta metadata and transport checks verify all three
new commands and the source event. Scoped lint has no errors and one pre-existing
unused-helper warning in SettingsPage. The normal command registry and CLI are
checked separately: the registry compiles with 22 existing warnings and the
rebuilt legacy CLI passes 15 synthetic compatibility cases. Package results are
recorded in the delivery JSON.

A normal-user unpackaged read-only helper resolved the retained shared alias to
its real backing store, checked its metadata and one bounded shard, then returned
a real starting-position stored evaluation (depth 65, +19 centipawns). The store
advertises 401,283,893 positions and has 1,024 populated files in 2,048 buckets.
The sample decoded to 32,187,260 bytes. No preference was activated, corpus
copied, full archive requested or owner data written. The task-owned helper was
removed after terminal success. This is neither full-dataset validation nor a
fresh Stockfish search.

These controls are native desktop operations. They do not repoint the managed
phone service or add a phone corpus builder. Hosted phone routes, service
choices, Library/opening/OTB data and running sessions remain separate. Browser
control is unavailable; component/static/package evidence does not establish
rendered 320/390-pixel, touch, native-window or physical-phone verification.

The combined native package from clean `97b66650` (primary source `46476beb`)
passes: 48,861,696 bytes, SHA-256
`a1a1f83361e2b3b868ff05843844cc68ec1556923c9dec105dfb1e4ceb16f51f`.
Native release compilation takes 120 seconds with 22 existing warnings; the
frontend build takes 24.20 seconds. Ten exact embedded JavaScript/CSS assets
cover boot, Settings, App, source bindings/reads and evaluation consumers. Native
commands/event, the Windows IPC shim, all 102 Stockfish/source resources and
the full About/standalone notice text match. The rebuilt release CLI passes all
15 synthetic cases. Two reviewed generated service outputs were restored to
exact source bytes in the delivery checkout; primary owner changes were kept.
The prior verified executable remains as the task's rollback artifact. No app
was launched or manually restarted, and no phone runtime was published by this
milestone. This proves package linkage, not rendered or native-window behaviour.

Reset to default closes the remaining selection action in Novelty `3ab6cf2e`.
It uses the same check/explicit-Use/token/transaction path: an empty validation
request is reserved for this explicit action and resolves only the legacy
profile default. An existing default must pass normal compatibility checks.
Only a confirmed absent or empty default may be selected without evaluations;
the dialog says so before Use default folder. Unreadable, corrupt, incomplete or
unrecognized contents remain intact and cannot replace the current selection.
The target is checked again before use, including a folder appearing after a
missing-folder check, and stale windows cannot overwrite a newer preference.
Reset does not create/download evaluation data or change Stored evals On/Off.

Both checkouts pass 104 native library checks and all 50 focused frontend
checks/eight files after the reset addition. Three new native tests and two
real-component cases cover this action; types and scoped reset lint pass, and
the normal registry compiles with its existing 22 warnings.

The latest native package includes Reset from clean `d4aab304` / primary
`08c105ee`: 48,862,208 bytes, SHA-256
`542c1f02f0fd6c14ed1d0142e20c703374fdb810fa1a5ee16ff0c5a46e48adb5`.
Native compilation takes 108 seconds with the same 22 warnings; frontend takes
24.47 seconds. Ten exact JS/CSS assets, native reset/selection/review/recovery
contracts, IPC shim, all 102 engine resources and full About/resource notices
match. The two generated outputs exactly matched their earlier reviewed derived
versions before restoration. The checkout is clean and rollback retained.
The CLI entry/builder were unchanged by Reset; the preceding 15-case release
CLI receipt is historical compatibility evidence, not counted as rerun. No
manual app launch/restart or phone publication occurred. Rendered and physical
checks remain separate, as does the wider source audit.
