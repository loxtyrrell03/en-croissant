# Existing evaluation-store discovery

Novelty df7bd865/676f8206 recognizes existing immutable evaluation data without
requiring a new download ledger. En Croissant now does this through its own
native source preference and the existing phone/PC read-only services.

A saved native selection always wins, including an explicit Reset to the legacy
folder when it is empty. Service environment/config paths also remain authoritative.
For an unconfigured default, an existing nonempty legacy En store stays first.
Only confirmed absence or emptiness permits recognition of the shared store.
This target-specific order preserves older En data instead of silently replacing
it with another corpus. Missing roots stay uninstalled; unreadable, foreign,
incomplete or invalid data stays an explicit error rather than a fallback.

Shared locations use Local AppData/ChessData on Windows, Application Support/
ChessData on macOS and the local data root/chess-data on Linux, followed by
lichess/evaluations. The current Windows lookup aliases the one retained corpus;
there is no copy, migration, new download, lifecycle ownership or preference write.
Native Stored evals and phone service/engine choices retain their existing state.
The phone has no on-device corpus builder.

Default recognition uses the existing native bounded compatibility validator.
It resolves a root alias, checks the supported manifest, sparse shard inventory
and one populated sample; nested linked data entries are refused. Manifest reads
are bounded to1 MiB and decompressed samples to64 MiB. The shared JavaScript
reader performs equivalent metadata, index, variation and bucket checks, with
an80 MiB compressed-input cap and64 MiB decoded cap. Its encoded-field scan avoids
allocating every PV string; ordinary lookup still uses the production decoders.
Both supported record versions are covered. This is compatibility validation,
not a full-corpus scan or independent chess-engine verification.

Cheap canonical-root/manifest identity checks run on reads. Successful bounded
sample checks coalesce and revalidate after30 seconds; failed checks can retry
immediately after repair. Native automatic revisions include the recognized
identity, so stale expected-revision saves fail within the preference transaction.
Default changes also participate in the existing source-epoch polling and pending
read guards. JavaScript results cannot cross a default-source change while a
shard read is in flight. Immutable stores remain the contract; there is no global
filesystem transaction against an uncooperative writer.

The existing approved Settings A row shows Ready/data counts for recognized data
and visible error/retry for unusable data. Failed discovery still permits a
checked explicit replacement. Native source choices/reset retain their prior
15-minute token and expected-revision ownership. The optional discoveryError
wire field is verified against pure Specta export; command arguments are unchanged.
New PC-engine installations leave the default unpinned. Existing explicit config
paths survive installer preparation, checked without running the installer.

Source verification:126 native library checks pass, with three explicitly opt-in
helpers ignored;14 new checks cover discovery and the real checked-choice/reset
flow. The normal native registry compiles with22 existing warnings. Forty-three
Node checks pass, with one pre-existing optional engine probe skipped; they include
actual isolated home-server and PC-engine HTTP reads with workers cold, source
priority, versioned data, errors, repair and in-flight ownership. Four production
installer-field expression cases pass without installing or changing a service.
Fifty-one frontend checks in nine files, full TypeScript and eight-file lint0 pass.
All routine data is tiny/disposable. Retained-corpus timing, clean/primary source
reconciliation, native package and actual service delivery are separate follow-ups.
No owner profile, pinned sync helper, hosted route, running app or service was changed.
The broader managed rated/broadcast catalogue and other history items remain open.
