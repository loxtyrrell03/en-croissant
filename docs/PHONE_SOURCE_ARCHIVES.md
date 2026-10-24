# Reversible phone source archives

The phone now has its own durable visibility labels in the optional
`sourceArchives` workspace field. They use the existing root-owned IndexedDB
writer and its retained-save/retry handling. Native file/database archives
already existed and remain separate from the phone profile.

Files and saved imports offer Archive and Show archived/Unarchive. Folder labels
cover descendants at path boundaries, preserving the hosted catalogue's case and
slash semantics. Device-only imports use their collection IDs; hosted sources
use their file/folder paths, so refreshing a collection ID cannot unarchive it.
Restoring a parent preserves separately archived children. Inherited labels show
their folder scope, and restoration explicitly targets that folder's marker.

Archives hide catalogue items and new Database/Prep source defaults. An existing
workspace's selected source remains available with an Archived label, and active
Prep retains its source IDs, games, notes and progress. Legacy active Database
selections are captured into workspace preferences before filtering. Choosing
another source removes the retained archived choice from that picker.

This changes visibility only. It does not delete files, collections or games,
change the PC's native labels, filter an existing aggregate collection's games,
or rewrite a hosted folder export. Folder-level Open all continues to read that
whole folder; hidden individual files do not silently change its identity or
coverage. Existing reviews and Prep can continue to use their saved data.

The controls reuse Mantine and the existing bounded keyboard/touch help. Archive
targets are at least 40 px. Saved imports also reopen a no-move starting position,
which previously had no Open action result because the row searched only for games
with moves. The existing custom-FEN import flow now covers that return path.

Primary verification passes all 414 product phone checks across 55 files,
TypeScript and nine-file lint. WebApp retains its 25 existing lint warnings and
zero errors. Eighteen focused archive/preference/native-marker checks pass,
including real Files/import/Database/Prep controls, source retention, folder
boundaries, saved-state validation, refresh identity and help focus/Escape.
All data is synthetic; file reads/writes and engines are mocked. Browser control
was rechecked and remains disabled in Work settings, so rendered narrow-layout,
physical-device and runtime-delivery proof remain outstanding.
