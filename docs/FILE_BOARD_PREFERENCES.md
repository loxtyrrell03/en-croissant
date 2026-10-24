# File board and source choices

Native file-bound boards remember orientation independently of game edits in
`en-croissant.file-board-preferences`. Flip updates presentation only, so it
does not dirty the game or make a completed save appear stale. Imported PGN
perspectives remain the fallback for files with no explicit remembered choice.
Opening another game in the file restores the same view. First Save and Save as
retain the current view; explicit copies keep their original binding.

Prep remembers its last mode and independent player/general source choices for
each file and each side/under-board placement. Explicit import handoffs and
ongoing Prep work win over stored defaults. Restore/persist callbacks check the
current tab and file, and binding changes preserve the current live selection.
Database and Compare retain their existing per-file architecture, with synchronous
initial reads and legacy path aliases. Native database-row keys remain opaque.

Successful file/folder rename and drag moves rebind open sources and recent,
pinned and archived entries, then migrate all three preference maps. This runs
immediately after the physical move, before optional metadata sidecars; a failed
sidecar cannot leave the board pointed at the old file. Windows path aliases are
equivalent; Unix case is preserved. Folder moves match path boundaries only.

Updates merge with the current saved map, preserve unrelated files/placements,
and report invalid or unwritable storage without replacing malformed data.
Optional preference failures do not fail a successfully written PGN.

Primary verification: 76 checks across eight files, full TypeScript and scoped
23-file lint pass. Fixtures exercise actual Flip/Rename controls, source/tab
ownership, first-save rebinding, corrupt storage and pending-save orientation.
Native filesystem I/O is mocked in these frontend checks. Browser control is
disabled in Work settings; rendered/native-window and runtime delivery remain
pending. Phone per-workspace view/source behavior is a separate outstanding
slice; no phone service or owner data was changed by this milestone.
