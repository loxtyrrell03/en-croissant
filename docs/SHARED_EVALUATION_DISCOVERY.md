# Existing evaluation-store discovery

Novelty df7bd865/676f8206 recognizes existing immutable evaluation data without
requiring a new download ledger. En Croissant now does this through its own
native source preference and the existing phone/PC read-only services.

A saved native selection always wins, including an older explicit Reset pinned
to an empty legacy folder. A new Reset previews the effective unconfigured
default under the current discovery rules; it does not change saved choices
until Use default folder is confirmed. Service environment/config paths also remain authoritative.
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
All routine data is tiny/disposable. Primary independently passes29 focused native source checks plus the pure transport
case, the same43 Node/four installer cases and51 frontend/full types. Its owner
104/2 guidance and25/1 binding remainders survive the mirrored source.
Native package and actual service delivery remain separate follow-ups.
No owner profile, pinned sync helper, hosted route, running app or service was changed.
The broader managed rated/broadcast catalogue and other history items remain open.


The normal-user unpackaged acceptance resolved the shared alias through a kernel
handle to the retained Dev corpus. Both default resolvers recognized it from an
absent disposable profile and returned its starting-position stored depth65 PV.
The manifest advertises401,283,893 positions; inventory has1,024 populated shards
in2,048 buckets. This validates one bounded sample and an actual lookup, not all
positions or independent engine accuracy. The native unoptimized helper took
4.705 seconds for recognition;100 cached reads took50 ms. Node recognition took
483.1 ms,100 cached checks68.5 ms, and its stored lookup142.0 ms on this PC, with
OS caches already exercised by the native read. Native debug timing does not
certify release or interactive responsiveness. No preference/corpus copy/write
or service change occurred. Both temporary probe tasks are removed; an initial
probe-path assertion was corrected and the successful native result retained.

Home health now exposes its own localEvals availability/error alongside the
existing service/catalogue fields. Four real isolated home HTTP cases verify
ready shared data and explicit incomplete-data failure; this adds delivery
observability without changing lookup fallback policy or service configuration.
Source/runtime and rendered/physical evidence remain distinct.


Reset now follows the same default resolver as an untouched profile. Existing
legacy data stays first, otherwise a recognized shared store can be previewed;
only genuinely absent/empty candidates permit an empty default. Unsupported
default data refuses Reset and retains the current choice. Applying a reset pins
the exact reviewed canonical path. Revalidation compares that path as well as
its fingerprint, so a different default cannot take over even with identical
sample bytes and timestamps. The prior saved reset remains authoritative until
a new action is explicitly confirmed. Thirty focused native source checks and
52 frontend/nine-file checks pass after this refinement, alongside full types
and scoped lint0. The0cda777a package is a verified historical snapshot preceding
this refinement; the latest native package must be rebuilt before delivery.
