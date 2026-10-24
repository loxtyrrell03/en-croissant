# Native PGN source ownership

Native Files and board tabs now capture a game snapshot and SHA-256 identity at
open time. The identity covers tags, moves, variations and annotations; only
outer separators and CRLF/LF differences are normalized. Saving checks the
current bound slot. If that slot changed, the writer follows exactly one matching
game elsewhere; missing or ambiguous matches fail without overwriting anything.
Formatting changes within a game are conservatively treated as source changes.

`src-tauri/src/pgn_files.rs` owns reading, sparse indexing and mutations. Its
lexical boundaries handle quoted tags, multiline/semicolon comments, variations,
headerless games and a UTF-8 BOM. Reads invalidate sparse checkpoints when file
length, modification time or creation time changes. Writes always find fresh
spans rather than trusting cached offsets. Cold preview/list reads share one
sparse-index build. Neighbouring games retain their exact
bytes. One game is bounded at 8 MiB and a ranged response at 32 MiB; the virtual
list reads at most four games per request.

Mutations serialize natively. They stage complete output beside the destination,
flush it, and recheck the complete original file before publication. Windows
`ReplaceFileW` preserves the existing metadata/ACL/streams; an OS failure that
produces a recovery backup retains it and reports its path. Read-only, locked,
missing, changed and ambiguous sources remain visible failures. This coordinates
this process's writes and detects source changes across staging; it is **not a
filesystem compare-and-swap against uncooperative external editors**. Content
identical games also have identical content identities, rather than invented
persistent IDs.

New PGNs and metadata are individually staged and published without replacement.
Filename collisions, including existing `.info` or coach sidecars, get a returned
suffix. Metadata is reserved first; these two files are not one joint filesystem
transaction. Failed publication removes only still-matching reserved metadata,
and retains owner edits. Promoting a temporary multi-game file stages its full
contents, replaces only the captured game, preserves the original, and returns
the actual new path/index/count. A single-game Save a copy stays separate.

The renderer's per-file queue includes completion/binding/count updates, so a
save queued behind deletion rechecks its owner before native I/O. All file-open
entry points capture source identity. Preview opening validates the displayed
snapshot again. Online clock hydration remains an unsaved in-memory edit until
the ordinary save path succeeds. Legacy restored file tabs without a captured
identity fail closed and retain their edits; reopen a clean source or use Save
game to files for a separate copy.

The virtual list waits for every header parse, merges independent ranges, tracks
pending rows and rejects old path/version/retry generations. Failures offer Retry
beside the list; actual batch counts refresh changed/empty files. File previews
hide stale boards and disable Open while loading, with source/page guards and
visible retry. The list remains available while previews load. Selection/deletion
uses the displayed identity. Deleting an open source retains and unbinds its board
edits, adjusts neighbouring tab indices/counts and invalidates list caches. Add
game saves current edits first, uses the returned append index, and never resets
edits made during I/O. Save, append and delete expose busy states.

Verification: 18 native filesystem checks cover byte conservation, BOM/comments,
sparse offsets, same-size/time changes during staging, concurrent saves,
reordering, source conflicts, missing/locked/read-only files, collision-safe
creation, temporary-file promotion and metadata ownership. Ninety-three frontend
checks across seventeen files include actual Mantine/Jotai list/preview/close
controllers, queued source ownership, retries, count changes, direct-file opening,
portable exports and phone report/drawing regressions. Full TypeScript, 24-file
lint without warnings/errors and the complete native Tauri check pass (the latter
retains 22 existing unused-code/import warnings). Tests use tiny synthetic files;
no corpus or owner database is copied or changed.

Clean delivery source `094b2b0e` independently passes the same checks and the
production Vite build (27.96 seconds). All thirty owned source/test files match
the primary milestone.

This is source and temporary-filesystem/component evidence. Browser control is
disabled in Work settings; rendered layouts and installed-native interaction
remain unverified, and no standalone/hosted release was published for this slice.
The phone has its own single root-owned durable workspace writer rather than
native file tabs. Database-row compare-before-write and automatic Clear tabs are
separate remaining work; do not infer them from these file safeguards.
