# Whole-game analysis limits

Native `analyzeGame` accepts optional `options.searchLimits` with `depth` and/or
`timeMs`. New limits validate depth 2–30 and time 50–5,000 ms per position.
Existing callers without this field keep their finite depth/time/node mode.
This is report-specific; practice games and live engine settings are unchanged.

Low is depth 8 / 50 ms, Medium 16 / 250 ms, and High 22 / 1,000 ms. The native
request sends both UCI bounds, so the first one reached stops the search. It
reserves part of the same time allowance for exact-score recovery rather than
starting an additional unrestricted search.

Each legal root candidate retains its latest exact evidence, even when a final
search thread reports a lower depth. The selected `bestmove` must match that
evidence; bound-only, missing-score and foreign-candidate output cannot become
a report score. Standard/Chess960 castle aliases identify the same legal root.
A missing selected score may be recovered once with its own `searchmoves`, the
remaining time and depth no greater than the selected cap or 12. An exhausted
budget or unscored result fails visibly at the command boundary. Node-only runs
never add a recovery search beyond their node allowance.

Cancellation is polled during engine startup and output waits; silent engines
have a bounded watchdog. Per-request cancellation registration is cleaned on
every exit and cannot remove a replacement job's flag. Processes are owned by
the report and retain the existing BaseEngine drop cleanup.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-game-report-protocol.ps1`.
The helper compiles a tiny deterministic UCI peer, reuses the native target,
runs the opt-in protocol tests and removes its generated executable/debug file.
Eleven focused limit/protocol checks pass (13 native checks match the filter,
including two pre-existing unrelated checks). No full dataset is used.

The desktop form now offers Low/Medium/High/Custom within the existing Mantine
controls. Fresh reports use Medium; saved depth/time/node-only settings retain
their units and values. Custom depth/time inputs are independent, and the
current limits have a visible label. Both desktop report actions share these
preferences, while the quick action also exposes cancellation during a run.
Engine-list updates do not overwrite an open form's unsaved limits.

`gameReportOwnership.ts` scopes results to their original store, legal main-line
identity and request. Changed games cancel once; an old result cannot apply
evidence or clear a replacement request's progress. Navigation, comments and
live evaluations do not change game identity. Failed/cancelled searches keep
prior evidence, and failures offer Retry analysis beside the action. Collected
scores retain their actual reported depth.

Verification: 48 selected frontend checks include actual modal command wiring,
legacy settings, failure preservation, changed-game cancellation, ownership and
accuracy regressions. Whole-project TypeScript, scoped lint and the frontend
build pass. The real controls were checked in Chrome at 320/390px, with doubled
text, bounded/dismissible help, Low and custom request wiring. This is isolated
source/component proof, not a native-window or hosted-phone delivery.

Completed desktop runs retain their engine display name, exact selected limits,
completion time and a SHA-256 fingerprint of the legal main line and saved
score/depth evidence in the portable `ECGameAnalysis` PGN header. The existing
session store retains the same header. Standard `[%eval score,depth]` marks now
preserve actual depth on PGN export/import. Comments, drawings and navigation
do not invalidate a run; changed games, scores or depths do. A late checksum
cannot attach metadata to a replacement request. Reports without verified run
metadata show “Analysis limits not recorded” instead of borrowing preferences.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-game-report-stockfish.ps1 -EnginePath ABSOLUTE_STOCKFISH_PATH`
for explicit real-engine acceptance. The installed Stockfish completed two
synthetic 80-ply games (81 exact legal scores each) at Low in 1,656 / 1,041 ms,
including a reversed-order run; maximum reported depth was 8. This checks the
actual native search helper with MultiPV 2, one thread and 32 MiB hash. It does
not use the running shared engine server, a downloaded corpus or owner games.
Native requests also reject more than 2,000 moves before starting an engine.

Three persistence checks cover session/PGN restoration, stale evidence, malformed
records and obsolete checksum completion; an actual Mantine report label/help
check covers verified and invalidated labels. Phone bounds and runtime delivery
remain part of the active parity task. The existing phone playing-strength
calibration must remain separate from a canonical game report.
