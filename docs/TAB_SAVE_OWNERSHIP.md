# Tab save ownership

The native board save path captures the requesting tab, source binding and full
annotated PGN before opening a filename dialog or issuing a native write. Later
active-tab changes cannot redirect its result. Tagged native failures remain
errors; a new file binding and clean state are committed only after successful
PGN and metadata writes. Edits made during a write remain dirty. An explicit PGN
copy preserves the original binding and unsaved state.

Each live tab owns one canonical tree, shared by its board, save controller and
close controller. Restoring pending session data strips old action closures;
duplicating a tab uses the current tree rather than a delayed session snapshot.
Saves serialize per tree and coalesce waiting automatic snapshots. A queued save
can follow that queue's first successful new-file binding without another naming
dialog; unrelated source changes and closed/mismatched owners are rejected.

Save and Close waits for completion. Cancellation, write failure or newer edits
keep the original tab open with retry available. Background close controls do not
activate or save another tab. Unsaved meaningful draft boards also receive the
existing close confirmation. Ordinary close still offers explicit discard;
the separate automatic Clear tabs workflow has not yet been added.

Game selection captures its source and latest request. Late reads/parses cannot
replace another source, overtake a newer request, or overwrite edits made while
loading. Its Save and Open Game action waits for saving before navigation.

Verification: 41 checks across ten files cover native result failures, cancelled
and delayed dialogs, queued/coalesced saves, complete annotation/variation/custom
root export, tree hydration, actual Mantine close dialogs, background tab-strip
ownership and delayed game selection, plus existing PGN/preview/report ownership
regressions. Whole-project TypeScript and scoped lint pass. These are source and
component-fixture checks, with native commands mocked; rendered browser and
installed-native interaction remain separate. Browser control currently reports
disabled in Work settings. The phone already uses its root-owned durable
workspace writer and has no native multi-tab close path to copy.

Clean delivery source `6549365d` independently passes the same 41 checks, full
TypeScript, 20-file lint with zero warnings/errors and the production Vite build
(21.77 seconds). All twenty owned source/test files match primary after line
ending normalization. No native executable or hosted app was published for this
frontend foundation.

The native PGN transaction, virtual-list/preview request guards and deletion
identity are now implemented in source; see `NATIVE_PGN_FILES.md` for the fresh
span/identity checks, atomic publication, metadata ownership, cross-tab ordering,
verification and external-writer limits. Custom-root PGN counters use each resulting
FEN's turn/fullmove value, preserving relative tree indices; multi-annotation
export emits separate unambiguous NAGs instead of duplicated comma lists. Four
new regressions reproduce the old counter/annotation failures; related native
save, drawing, report and phone checks total 55 checks across seven files, with
types and scoped lint passing. Clean delivery source `549faef9` independently
passes those same checks and the production Vite build (23.64 seconds); both
owned exporter files match primary. This repair is also source-only.
Database-row compare-before-write is now source-verified in `DATABASE_SAVE_OWNERSHIP.md`; automatic Clear tabs remains separate work.
Do not infer runtime delivery from these source checks.
