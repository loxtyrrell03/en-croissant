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

Native verification: primary and clean delivery source `75ea649f` pass 76 checks
across eight files and full TypeScript. Primary scoped
23-file lint passes. Fixtures exercise actual Flip/Rename controls, source/tab
ownership, first-save rebinding, corrupt storage and pending-save orientation.
Native filesystem I/O is mocked in these frontend checks. Browser control is
disabled in Work settings; rendered/native-window and runtime delivery remain
pending. The clean production build passes in 23.58 seconds. No phone service or
owner data was changed by the native milestone.

## Phone workspace choices

The optional `workspacePreferences` map lives in the existing root-owned
IndexedDB workspace transaction. Files use their hosted file/folder identity;
device-only imports use their collection ID. A hosted folder is one collection
because the phone catalogue does not expose a per-game original file path.
Prep workspaces and blank analysis boards retain separate identities. This map
does not share Novelty's settings or IDs.

Flip is durable across navigation, reopening games in the same file and remount.
It leaves moves, saved source games and the Prep training side unchanged. Opening
Prep preserves an explicit manual view; changing the training side or resetting
Prep realigns it. Imported orientation and the existing training side remain the
fallback when no manual choice exists. File cursor reset retains its saved view.

Database source, local collection, player/colour, date bounds and result choices
are independent per workspace. Legacy global preferences seed new scopes. Prep
remembers its last mode and independent Player/General sources; explicit source
choices win over mode restore. Hosted source references survive collection-ID
refresh. Unsaved temporary Prep imports remain owned by their current workspace
and do not become reusable source defaults. View/sort/strength/explorer defaults
retain their existing architecture; rolling date/source scopes are tracked
separately in the parity ledger.

Source controls and in-flight callbacks check the actual displayed owner. Panels
reset transient requests when switching workspace, while successful imports keep
their durable data even if the original panel has closed. Malformed preference
maps fail the existing preserved-workspace load path; save failures use the
existing retained snapshot and retry UI.

Primary and clean delivery source `46bf0caa` pass all 407 product phone tests
across 53 files, full types and seven-file lint. The initial primary run also
collected 27 checks from a pre-existing temporary performance fixture (434/54
total); the final product run explicitly excludes `tmp/**`. WebApp retains its
25 existing lint warnings, with zero errors. New checks include actual
Flip/Database/Prep controls, file switching, mode restore, remount, stale owners,
source identity refresh and saved-state validation. Browser/physical-device
verification and hosted publication remain pending. The clean source passes the
canonical-origin phone build in 24.77 seconds and normal desktop build in 20.99
seconds. All 31 owned source/test files match primary after line-ending
normalization; the private compact receipt records their hashes and phone bundle.
