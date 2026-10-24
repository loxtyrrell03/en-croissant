# Database game save ownership

Database query results carry a SHA-256 identity of the original stored game row
and its joined player, event and site metadata. The token is captured before
movetext decoding, so annotations, clocks, variations, FEN and stored metadata
are covered even when normalized presentation is lossy. All five native database
opening surfaces pass that token into the tab's persisted source binding.

`write_db_game` requires the expected token. An immediate SQLite transaction
reads the current identity, creates related names, replaces the row and returns
the resulting identity. Other SQLite connections cannot write between the check
and replacement. A failed update rolls back related name creation as well.
Only a committed write invalidates the search cache. This changes no owner
schema, IDs, database paths or import architecture.

The tab-owned save queue refreshes its source token only after success, follows
its own queued saves and retains edits made during I/O. Conflicts, deleted rows
and restored legacy bindings without a token fail closed with a visible error;
the board stays open and can be saved as a separate PGN copy. A copy preserves
the original binding and dirty state. Global player/event/site edits can
conservatively trigger a conflict. The token identifies content, not a permanent
physical row: recreating precisely identical stored content has the same token.

Phone workspaces keep their separate root-owned transaction protocol. They do
not use this native database-row replacement API. Automatic Clear tabs and
runtime delivery remain separately tracked in the synchronization ledger.

Verification: seven native SQLite/protocol checks cover normalized identity,
competing connections, deleted rows, stale snapshots, annotation/name changes,
rollback and generated binding agreement. Twenty-four frontend save/open checks
include queued identity refresh, legacy bindings, delayed ownership changes and
separate copies. Full TypeScript passes; seven-file lint has no errors and one
existing unused-variable warning in TournamentCard. No owner data or corpus is
used. These are source/fixture checks; native-window and runtime delivery remain
separate.
