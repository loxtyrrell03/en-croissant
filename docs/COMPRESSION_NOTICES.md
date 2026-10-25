# Compression notices in En Croissant

Novelty `d230b44f` added complete compression grants to About and the native
distribution. En's existing About dialog and native resource mapping omitted
them. Its root Cargo.lock also pins older versions, so Novelty's version labels
cannot be copied unchanged.

The native application uses zstd 0.13.2, zstd-safe 7.2.1 and
zstd-sys 2.0.13+zstd.1.5.6. The manifest records the exact MIT wrapper grants and
BSD-3-Clause bundled C grant. Both independent existing Cargo registry copies
contain identical source bytes; the retained notice files match their SHA-256
hashes. No dependency was upgraded or downloaded. Licence bytes use LF in Git.

About now has a collapsed Compression library notices disclosure in the existing
Mantine dialog. The complete text wraps, can receive focus and scrolls within
a bounded area. The existing close button has an explicit accessible name.
The standalone THIRD_PARTY_NOTICES.txt is mapped into native distributions.
The normal Tauri before-build hook verifies versions, exact grant bytes,
complete distributed text and resource mapping before compiling the frontend.
Run the check directly with `node scripts/verify-compression-notices.mjs`.

Five Node checks cover the current record and failures for changed versions,
modified/omitted grant text, lost resource mapping and omitted bundled C notice.
One actual About component workflow checks disclosure, complete text, focus,
wrapping and closing. These six checks and full TypeScript pass independently
in primary and delivery checkouts; scoped four-file lint has no warnings/errors.
Clean `abf029e6` native packaging passes in 1m54s with 22 existing warnings,
and the frontend builds in 24.21 seconds. The 47,958,016-byte EXE has SHA256
`adc1ff307c51326697a872a30c827a18ab644d72c008337d91dcc7194e1ccad4`.
The guard ran before building; the exact complete notice literal appears in the
packaged About code. Three exact boot/App/bindings chunks and the native IPC
script are embedded. The standalone 2,931-byte notices file matches SHA256
`ee7e052f5730ae06fd117412056d5337675a06e18e84d858a9065ad7e6c4db2a`.
All 102 engine/source resources and ten owned source/test/notice files match.
Only two known generated outputs were restored; delivery source is clean.
Browser-rendered narrow/touch and native-window proof remain unavailable while
browser control is disabled.

This record covers the root native lockfile's compression dependencies. The
phone frontend has no native About entry point and receives no Rust compression
code. Its separately compiled hosted helper uses a different Cargo.lock
(zstd 0.13.3, zstd-safe 7.3.0, zstd-sys 2.1.0+zstd.1.5.7); its distribution
now has a separate `helper-manifest.json` and complete
`PHONE_HELPER_NOTICES.txt`. All four helper grants match cached crate archives
authenticated against its lockfile checksums, without extracting archives to
disk. The newer safe/sys wrappers use BSD-3-Clause with a 2026 copyright;
reusing the native MIT wrapper labels would be incorrect.

The compiled helper exposes `--third-party-notices` and `--help` before opening
state/cache roots. Extra arguments to those flags are refused. The normal
JSON-lines protocol is unchanged. The PC phone publisher validates both
lockfiles and exact helper CLI text before staging releases, including SkipBuild.
Separate immutable notice files for the root-lockfile collector and standalone
helper are staged beside their runtime files, named with the source commit.
Existing different notice bytes refuse publication and remain intact; failed
copies remove only the private pending file. No source licence labels are
rewritten to fit another delivery target.

Ten Node scope/text/version/resource checks pass independently on primary/clean.
Six PowerShell cases verify exact compiled text, mismatch refusal, fresh/identical
copies, conflict preservation and missing sources, including disabled module
autoloading. Existing publisher source/build/rollback guards also pass; fixture
cleanup now validates its exact temporary root. Six real CLI cases verify full
text, help, invalid arguments without data-root creation and an isolated normal
settings RPC. The release helper SHA256 is
`be1eb13d15f517c9aff997f87ba6768b105941a6c488db00981051a317dbfa71`;
its 6,230-byte notices have SHA256
`75546853135bc1ddbef9982386b7745e56d0edba281d8ad4ea7cbb4dd1ff1610`.
These are source/build/fixture checks. Hosted runtime delivery is pending;
no live service or owner data was changed by those checks. The existing Stockfish source/licence
resources are retained. This is not a complete third-party dependency inventory.

The existing Dev watcher relaunched after the native resource configuration
changed. No manual Dev restart or owner corpus/profile/service operation was
performed; the hosted phone publication is unchanged by this native source slice.
