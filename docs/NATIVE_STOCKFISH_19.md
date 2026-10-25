# Native Stockfish 19

Windows desktop builds run `scripts/build-desktop.mjs`. It selects the pinned
official universal x64 or ARM64 release in `config/stockfish-release.json`,
authenticates the complete archive and stages its full source, licence and
notices with the executable. The generated Tauri resource configuration retains
the existing sound resources. Other target builds retain their existing path.
The desktop build explicitly disables the phone-only build flag.

`stockfish_install` is also the explicit managed-download implementation. It
limits archive size/entries, rejects traversal and links, checks cancellation
while downloading/extracting, and publishes a verified private stage by rename.
A changed existing installation is preserved. Downloads have bounded header
and read-stall waits; temporary archives/stages are removed on failure. Discovery
never downloads or launches an engine. Registered current x64 executables are
recognized by the independently pinned executable hash, including renamed
copies. ARM64 discovery requires the authenticated installation receipt.

Discovery checks registered current profiles, packaged resources, the selected
engine folder, and the durable shared `Programs/Stockfish/19` installation below
the native local-data directory. Build-cache paths must not become durable owner
profiles. Portable delivery must include the adjacent engine resource tree;
copying the executable alone does not deliver those resources.

The idle startup upgrade uses the first local profile, which is En Croissant's
fallback for Play, reports and Plans. Explicit feature engine IDs remain intact.
It introduces a disabled Stockfish 19 profile only for a missing store or a
recognized compatible older Stockfish default. The old profile remains for
manual reversion. Existing current profiles retain their configuration and
visibility; new replacements retain compatible limits, tuning and visibility.
Empty, alternative, current, newer, unknown-version and incompatible/custom
network choices are acknowledged without replacing their default.

The checked-in UCI option contract was captured from the pinned x64 executable.
Removed/unknown options, custom networks and relative tablebase/log paths are
not transferred automatically. This prevents old settings from breaking the
new engine. No rating estimate or performance calibration is changed.

The upgrade waits for enabled or focus-paused analysis and Play tabs. A real
owner edit, including an unresolved async update or edit followed by reversion,
invalidates a pending lookup. The native preference reader/writer binds its
loaded folder, so a changed folder cannot redirect a write. Completion requires
a valid saved array with the exact expected byte hash. The immutable completion
marker preserves later manual choices. A failed save or marker leaves visible
retry state; keep the app open to retain pending settings. An acknowledgement
retry does not repeat default selection. These checks are not a cross-process
multi-file transaction or lock.

Primary verification: 58 frontend checks across five files, ten native library
checks, two build-target checks, whole-project types and twelve-file lint pass.
The native main/stager check passes with 22 existing warnings. The real x64
archive and executable match their pins; its full staged tree is 104,581,828
bytes, and the temporary ZIP is removed. Two real native Low reports cover all
81 positions at depth eight in 571/580 ms. Eight focused live-output checks also
pass with the actual Stockfish 19 executable. ARM64 runtime execution has not
been verified.

This milestone is source and isolated-engine evidence. Clean packaged-resource
verification, the manual catalog install/cancel flow, owner software/profile
delivery, shared-helper upgrade and rendered desktop/phone verification remain
separate. It does not claim a live installation or physical-device test.
