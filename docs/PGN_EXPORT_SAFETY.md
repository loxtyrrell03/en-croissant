# PGN export safety

Reviewing Novelty `89af6af2` exposed a related En desktop failure class. The
actual old export truncated the destination before reading, flattened cursor
errors, silently substituted invalid positions/moves and ignored final buffered
flush errors. Three real tiny-SQLite tests reproduced dropped corrupt rows,
invalid-position substitution and a source-database truncation/crash.

The native command now opens an independent read-only URI connection, with a
250 ms busy timeout and no pool creation or journal-mode change. A read
transaction pins the count and joined streaming cursor to one snapshot. Row,
move, position and missing-linked-metadata errors abort visibly. The common
decoder returns errors for invalid positions and corrupt UTF-8 rather than
panicking or replacing data. Export preserves notes, NAGs, variations and custom
starts; tag quotes/backslashes are escaped and invalid multiline tags refused.

The existing PGN writer lock and publication boundary are reused. Output is
staged beside the chosen destination, explicitly flushed and synchronized, then
published. Existing output is checked again by content, metadata and physical
file identity; new output uses no-clobber publication. Database/sidecar paths and
their hard-link aliases cannot be export targets. Linked, non-file or read-only
destinations refuse. Ordinary read/write/publication failure preserves the
previous export and removes owned staging. Windows replacement failure retains
any recovery original and reports its location.

The actual desktop button checks both native error results and transport errors,
settles its loading state and supports explicit retry. Picker delays retain the
original database. Switching away cannot put an old error under a new database;
late failures identify their original source in a persistent notification.

Phone export already snapshots one complete immutable PGN into a browser Blob,
without truncating a server file or streaming a database cursor. Its toolbar now
reports Blob/download-dispatch errors, supports retry and owns temporary anchor
and URL cleanup. Tests retain annotations, drawings and personal-sync transport
tags. Browser dispatch is not proof that the operating system saved a download.

Verification uses only synthetic temporary files and databases. Native checks
cover source aliases, same-size/same-time destination edits, final flush errors,
Windows locked destinations/retry, corrupt rows, malformed moves/positions,
escaped metadata, concurrent WAL generations, read-only/missing inputs and the
actual asynchronous command. Pure specta metadata verifies its unchanged
two-argument client contract without opening a window. Desktop/phone component
checks exercise cancellation, failures, retry and original-request ownership.
Current counts and package/runtime evidence are in the delivery JSON.

This is the PGN export safety slice. The full mutable app-state recovery ZIP and
per-database backup feature from Novelty remain a separate open parity question;
they are not satisfied by a PGN export. Shared immutable corpora must not enter
backup copies. No owner database, profile or retained corpus was used by tests.
The final existing-file recheck is not a filesystem CAS against an uncooperative
external editor. Process/power-loss recovery, real full-size exports, rendered
interaction and physical-device evidence remain separate. Hosting and owner
personal-sync state are preserved when preparing phone delivery.

Native packaging from clean `b4d2f671` / primary `6924750f` passes: 48,909,312
bytes, SHA-256
`3f0bfa2e6ab2e0167bef906912926e3ec40fbe0e4d3655e2717fd9167f26a24e`.
Native compilation takes 162 seconds with 22 existing warnings; frontend takes
33.53 seconds. Eleven exact JS/CSS assets include the real Databases control;
native export/refusal contracts, Windows IPC, all 102 engine/source resources
and full About/standalone notices match. The two generated service outputs
exactly match their previously reviewed derived versions before clean-checkout
restoration. The latest prior verified executable is retained for rollback.
No app launch/manual restart, profile/corpus write or new CLI entry was used.

Read-only live health identifies phone source `7e7804f2` on the separate personal
sync branch, with shell hash `1c0b7edbf324…`. That version includes finished phone
usability and personal-sync work absent from the current delivery checkout.
Phone release therefore requires source reconciliation before publishing this
toolbar change; the existing serving version and data remain intact. This is
verified source-version evidence, not a phone update or rendered download proof.
