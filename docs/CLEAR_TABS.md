# Save before Clear tabs

The compact Clear tabs control stays beside the scrollable tab strip. One click
saves meaningful original analysis/play boards, then closes those original tabs
together. New tabs and a manual active selection are preserved. Repeated clicks
share the same operation; the control shows Saving, a nearby error and Retry.
No filename or confirmation prompt is used for this action.

New games use bounded, sanitized automatic names in the existing Files directory
and native no-clobber creation. Bound games use the protected PGN/database save
paths. Meaningful temporary PGNs are promoted with their source identity and
other games intact. Optional Coach-sidecar lookup/copy failures do not invalidate
a saved PGN. Ordinary Save/Close prompts retain their existing behavior.

Live canonical trees are captured before I/O, including initially clean boards.
The final boundary checks every remaining original's content, source binding and
game phase after all saves/review flushes. Newer edits or any failed/conflicting
save retain all remaining originals. Earlier successful saves keep their fresh
bindings, so Retry does not create duplicate copies. Empty drafts need no file.
Malformed restored state fails before closing anything.

Review tabs flush their own retained deck writers and check for new pending
progress before closing. Tab-list/selection persistence failures restore their
in-memory values before yielding. Session/atom cleanup and engine stopping run
only after the originals have been removed together; cleanup failures are
reported as warnings without claiming the already-closed tabs remain open.
No live owner files, databases, sessions or services are touched by verification.

Eighteen new synthetic/component checks cover active/background full PGNs,
zero-move studies, temporary/file/database sources, safe names, save failures,
review retry, later edits, new tabs, phases, malformed state and browser-storage
failures, plus the real busy/error/Retry control. Related source/preview/practice
and retained-writer checks total 95 across eleven files. Whole-project types
and six-file lint pass without warnings/errors. Native I/O is mocked here; the
underlying filesystem and SQLite contracts have separate native tests.

The phone has a root-owned workspace writer rather than native multi-tab close.
Browser control is disabled in Work settings, so responsive rendered inspection,
native-window interaction and standalone runtime delivery remain pending.

Clean delivery `9b2d0b5a` independently passes the combined 95-check,
eleven-file suite, full TypeScript and the production Vite build (22.56 seconds).
All 24 owned source/test files match the primary milestones. Eighteen-file
combined lint has zero errors and the existing TournamentCard unused-variable
warning. Database source `b8b1bb3a` also passes all seven native SQLite/protocol
checks and the complete native Tauri check (22 existing warnings). These native
files are unchanged in the later practice/Clear milestones. No standalone or
hosted release was published by these milestones; rendered/native-window
verification remains separate.
