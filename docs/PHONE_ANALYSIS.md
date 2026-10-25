# Phone Board Analysis

The owner selected design A in `design/phone-analysis-parity`. The existing
Engine board tool is labelled Analysis, with Live / Game report / Plans beneath
the board. The internal `engine` panel value remains compatible. Live stays
mounted across tab changes; report and Plans jobs suspend it without changing
its saved enabled/disabled or engine settings. Report/Plans/coach jobs cannot
start over one another. PC services Off remains authoritative.

## Game reports

The real board path uses `gameReport.ts` for canonical accuracy, legal custom
roots and terminal/history evidence. Low/Medium/High/custom limits are distinct
from live-engine and Strength preferences. Controls retain their last limits;
completed results show their own recorded caps, actual search-depth range,
engine and completion time. Missing sides show a dash; sample counts identify
analyzed half-moves. Flagged moves navigate the same board line.

Reports belong to the SHA-256 of the complete replay-validated game identity.
The optional `WebCompanionState.gameReports` record is stored in the existing
workspace transaction; old state requires no migration or second database.
Only the completed immutable snapshot enters the writer. The panel displays
the previous `savedState` result until a successful durable write acknowledges
the replacement. Save failure retains both the old saved result and new pending
evidence. Retry report save flushes that evidence without another engine run.
Pending evidence survives view/root remounts through the app-level session.
Readback validates game, score/depth and portable run identity before display.

Changed games or replaced/unmounted requests abort and cannot apply late
scores, progress or status to another game. Cancellation/failure keeps the old
report. Panel switching alone does not unmount a report job. Source games,
comments, variations, prep work and calibrated Strength calculations remain.

## Engine Plans

Fresh settings use depth 17. A finite Stockfish request bypasses cloud/stored
fallback, excludes bound scores, malformed/illegal PVs and over-cap lines, and
requires search completion. The adapter passes White-relative scores and real
MultiPV ranks to the existing native pure `buildEnginePlanReport` implementation.
It retains all evaluated root choices, exact continuation/preparation routes and
cached horizon filtering. Side/horizon changes use cached evidence. A changed
position/depth cancels obsolete work; failed refreshes preserve prior results.

Details expose exact supporting PVs/depths, the existing conditional-score help
and a Play this line action. The complete line is replayed before a single board
update; a stale position cannot apply it. The imported source game is preserved.
Phone presentation intentionally uses the compact Plans list selected in design
A; independent setup-strength/practical mining controls remain desktop-specific.
Conditional continuation scores never become independent setup/strength scores.
The in-memory cache holds twelve recent position/depth reports.

## Verification and delivery boundary

The selected 98 checks across ten files pass: actual Mantine panels cover saved
limits, failed-save retry without reanalysis, cancellation and changed games;
real WebApp navigation covers report save, mistake selection and playing a plan
without modifying the imported game. Engine transport tests cover fresh legal
rank-preserving lines; shared extraction/evidence/coverage tests retain the
native behavior. TypeScript, scoped lint and both primary and clean-delivery
frontend builds pass; the latter completes in 21.06 seconds.

Browser control was disabled in Work settings when responsive verification was
attempted. Therefore narrow rendering, touch/focus help and large-text layouts
of these new controls are not yet visually verified. The earlier three static
designs were visually reviewed; those screenshots are not implementation proof.
No native Computer Use or alternate browser automation was used.

The shared engine service now runs protocol version 1 from clean `ff5f271c`.
Canonical HTTPS checks complete a depth-8/50-ms report with legal exact chosen
evidence and an ordinary finite depth-2 search. The first request includes
engine startup (939 ms total); its selected exact depth is 8. No queue remains.
The existing config, task, routes and owner enabled choice are preserved.

Later committed deliveries supersede those historical snapshots. Canonical
phone metadata currently identifies `89f64228`, with shell SHA-256
`cd2b67baafef215710391a4a0a58a21a9aabfc31b6acf1b7dc5ec7a43534d1dc`.
That delivery includes managed WASM 19 and actual PC Stockfish 19 service
evidence; native setup/logo package source is `0a0056a6`. Separate UI, backend
and package receipts are in `NOVELTY_SYNC_2026-10-24_DELIVERY.json`.

Plans now has source-verified Auto arrows/limit controls within direction A.
Visible plan controls take priority over live arrows without changing live
settings. Automatic routes remain during hover/focus/tapped details; hidden
panels and changed workspaces release their owned layers. All layers follow the
displayed FEN and stay outside saved annotations. Sixty-five shared checks
include actual phone controls and Chessground SVG rendering; this does not
prove narrow layout or physical-phone interaction. The new arrow slice still
requires clean builds, rendered verification and its own phone publication.
See `PLAN_ARROWS.md`.
Install the UCI report helper before the engine entry point; never interrupt an
active shared engine. No full corpus test or database migration is required.
