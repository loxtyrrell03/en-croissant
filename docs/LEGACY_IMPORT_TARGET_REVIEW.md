# Legacy migration and import-index history

This review covers five specific Novelty history entries. It does not certify
the entire import pipeline, app recovery or matching throughput between products.

## Checkpointed legacy conversion

Novelty `aa25aa07`, `84308b8b` and `0b97d3bb` change its `migrate.rs` and
`migrate_cli.rs`. That tool reads the original En Croissant `*.db3` schema,
decodes each game's legal-move-index bytes, and converts it into Novelty's
different Library schema. Checkpoints retain the source cursor, target
collection and committed batches so this conversion can resume safely.

En Croissant desktop already opens that original SQLite schema through
`src-tauri/src/db/mod.rs`; `db/models.rs` and `db/schema.rs` retain its `Moves`
byte column. It has no legacy-to-Novelty conversion or corresponding checkpoint
to resume. The hosted phone's `scripts/home-server.mjs` likewise recognizes
native `.db3` catalog entries and serves them through its native database path,
rather than running Novelty's migration CLI. The companion's PGN/collection
imports remain their own operations.

These three changes are therefore specific to Novelty's format migration. No
reverse conversion, duplicate collection or second importer is added to En.
This is a source/call-chain finding; no owner database was imported or modified.
General PGN import interruption, persistence and recovery are separate audit
questions and are not closed by this decision.

## Novelty's per-position index acceleration

Novelty `701b7e10` and `6734869d` carry the same optimization family across its
`pgn_stream.rs`, migration decoder and `storage.rs`: retain precomputed position
bitboards, group/sort per-ply `position_hit` inserts, reuse the prepared statement
and enlarge its WAL checkpoint window. These operations target Novelty's Library
schema and position-hit B-trees.

En's actual PGN visitor maintains a board as it reads SAN and directly encodes
the native `Moves` bytes. Its database conversion uses the native game/name
tables, a conversion transaction and deferred index creation; it does not insert
Novelty `position_hit` rows or reparse Novelty position-key strings for each such
insert. Hosted tournament collection/download storage likewise has no copied
Novelty `NewPositionHit`/`position_hit` writer. Existing native OTB publication
uses a private staged database and reopens it with normal transactions before
deduplication and publication (`save_otb_database_inner`).

Copying those schema-specific SQL/bitboard/WAL changes would create a different
storage model, rather than speed the actual En write path. The original parser,
game results and import-safety contracts remain authoritative. These two commits
are recorded as architecture-specific adaptations, not as an En performance
improvement or measured speed parity. No full-data benchmark, corpus rebuild or
new test dataset was run for this source review.
