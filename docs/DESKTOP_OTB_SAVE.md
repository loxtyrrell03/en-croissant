# Desktop OTB save boundary

The additive native command save_otb_database prepares a new OTB database before making it discoverable by the Library. The desktop panel is not yet wired to this command; this is a verified native capability milestone, not completion of the desktop import flow.

## Behavior

The command fingerprints the retained source PGN, title and description. An existing destination is opened read-only and accepted only when its saved job ID and fingerprint match. A completed retry counts current games and preserves later edits or deliberate removals. Invalid, unrelated, changed-request and non-file destinations are refused.

A new conversion uses an exclusively created .otb-save-*.pending file beside the intended destination. The Library discovers .db3 files, so an incomplete conversion is not offered as a ready database. The existing tolerant converter and duplicate/empty cleanup run against this private file. Connections close on both success and failure; cleanup uses normal journaled transactions. The source is checked again, SQLite quick_check must pass, and an empty result is refused. Job identity and fingerprint are committed into the existing Info table before flushing the file.

tempfile persist_noclobber publishes the completed file without replacing another destination. A competing identical job can reuse the winner's current count; other collisions remain errors. Only the exclusively owned private file is discarded on failure, while the source PGN remains available. The ordinary convert_pgn append/valid-prefix behavior is unchanged.

This does not promise power-loss durability of directory entries, prevent duplicate preparation work from concurrent identical requests, or remove abandoned .pending files after process termination. The persistent identity is in the database, not an in-memory receipt. A retry needs the retained source PGN and original metadata to validate that identity. The desktop command does not change the phone service or shared source collector.

## Verification, 12 September 2026

Both primary and isolated checkouts passed nine file/SQLite cases: completed retry preserving edits/counts, failed-prefix retry with source retention, unrelated/invalid destinations, changed job/content/metadata, source changes during preparation, competing unrelated and identical publication, empty/corrupt output, and invalid job IDs.

Three native converter/export checks passed in both: two identical PGN records yield one saved game and replay preserves deliberate removal; a malformed suffix publishes no database and leaves no open connection/private file, then a repaired PGN saves once; the generated command matches the actual Tauri Specta export. The existing five duplicate/empty/orphan/partial-parser regressions also pass. Isolated file checks used the headless collector test target; primary ran all twelve new checks together in the main native test target.

Both TypeScript checks and production frontend builds pass. Scoped Rust formatting passes. Existing native dead-code/import warnings and frontend bundle/plugin warnings remain. Evidence is under tmp/desktop-otb-save in each checkout. All databases and PGNs were temporary fixtures; no owner database, app/service restart, real collection, phone deployment or customer release was performed.

## Next integration milestone

- Reserve a unique source PGN/job location before collection and a collision-safe destination; titles alone and a stale database list cannot establish file ownership.
- Switch the desktop panel to saveOtbDatabase with the retained job ID/report/paths. Preserve pending work across navigation and expose a save-specific retry that does not repeat source collection.
- Checkpoint database-list refresh and Prep attachment independently. A later callback failure must not append/reconvert a completed database or resurrect deliberate edits/removals.
- Verify actual Home/Prep flows, failure/retry, partial coverage/Stop, cancellation and narrow/200% layouts. The new native command needs the normal Dev rebuild before it can be called; do not silently fall back to the old append sequence.
