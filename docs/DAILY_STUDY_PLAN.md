# Daily study plans

The desktop Home Daily Goals area also reads an optional `daily-study-plan.json`
from the configured EnCroissant documents directory. No file means no additional
panel. Loading a plan preserves existing review goals, review decks and history.
The plan contains 60- and 90-minute allocations, instructions, optional summaries,
local PGN resources and HTTPS course links. Both allocations must sum correctly;
step IDs must be unique. Invalid saved plans display a Retry action.

Each block opens its instructions and resources. PGNs use the normal in-app file
workflow. Course buttons open an En Croissant study window; Open in browser uses
the normal browser and its existing login. A course whose exact URL is not yet
known explicitly says Link course rather than pretending to be linked. Changes
read the latest saved plan before updating only that resource ID. No purchased
course contents are copied or downloaded.

Study windows use the app's persistent `study-browser` WebView profile. They have
no native app capabilities; the native opener accepts only normal HTTPS links to
Chessable, Lichess or Chess.com and only requests from the main app window.
Authentication is the website's normal login. The app never collects passwords,
copies Chrome cookies or stores credentials in plan JSON. Browser-provider login
may require Open in browser; retained sessions remain subject to website expiry.

## Sessions and records

The top progress bar weights blocks by their selected 60/90-minute allocation.
Its label means planned minutes explicitly marked complete, not elapsed work or
mastery. Click within a segment to select that block and seek to that point in
its timer. Keyboard activation opens the block without seeking. The timer bar
also supports click/drag, touch and arrow/Home/End keys. Seeking changes only the
countdown position: skipped time is excluded from timed history, and expiry never
completes a block. Start/pause/resume controls one timer at a
time; expiry stops at zero without completing anything. Complete & next advances
to the next unfinished block, including an earlier skipped block. Save partial
preserves unfinished work. Mode changes pause the timer, update its target and
preserve recorded time and original allocation. Running timers survive reload
and stop at their target or London midnight, including clock-change days.

Opening a saved partial resumes the same attempt. Restart block (also available
beside each attempted block) starts a fresh paused attempt at zero, clears only
that block's current completion, and retains previous time, work and notes in
history. Restart does not create another study session. Failed writes apply
neither seeks nor resets; the current attempt and recovery drafts remain intact.

Reopening continues the same session. Only Start another session creates another
intentional session; earlier records remain and the new session requires its own
game annotation. Each begun session freezes the plan/resources it started with.
Reload plan updates future sessions; it never silently rewrites past work.

Each block has autosaved notes, explicit Save and position/chapter/game records.
The PGN picker attaches the exact legal starting FEN, file and game index; it does
not guess the currently studied board. Manual minutes mean additional untimed
work, separate from timer time. Tactics log reviewed and unseen patterns separately.
Game annotation requires a reference, work notes and manual confirmation that
annotations were saved. The app never rewrites the source game. Suggested games
exclude completed annotations logged here; prior work elsewhere remains unknown.

Study history offers this month, last 7/30 days and inclusive custom calendar
ranges, expandable work/FEN records and selected-period JSON export. Empty history
means unlogged study is unknown. Legacy checks/notes migrate once with unknown
timestamps/time; original local-storage keys remain untouched.

## Authoritative storage

The configured documents root owns `Study history/journal-<idHex>.json`, where
`idHex` is the lowercase UTF-8 hexadecimal plan ID. At implementation the owner's
root is `C:/Users/Lox/Documents/EnCroissant`; discover configuration on other
installations. No personal journal or plan belongs in Git.

Journal schema version 1 records `planId`, monotonic `revision`, current sessions
in `days`, archived `pastSessions`, and `attempts`. Sessions hold a frozen plan,
mode, completed IDs and current attempt. Attempts hold session/block identity,
timestamps, original `plannedMs`, current `limitMs`, actual `elapsedMs`, optional
signed `timerOffsetMs` (zero for existing journals), nullable
`runningSince`, status, work/FEN/source, notes, opened-resource events, manual
minutes and manual annotation/tactics outcomes. Executable schemas live in
`src/utils/studySession.ts` and `src/utils/dailyStudyPlan.ts`.

Native writes require Web Locks, check the expected revision, write a unique
same-directory temporary file, atomically rename and verify exact readback.
Corrupt files, stale revisions, unavailable locks and failed saves block advancement.
Draft recovery retains input in memory/local storage for retry. External tools
must not edit the live journal. The browser preview uses isolated local storage
and is separate evidence from the native filesystem adapter.

## Plan policy

Optional `dayAllocations` supply exact totals for all seven weekdays.
`priorities.daily`/`perSession` protect blocks from rebalancing, `adaptive` names
eligible blocks and `weeklyCaps` limits allocated blocks across intentional
sessions, counting each session once rather than counting both mode choices.

The owner's revised base split is 8/10 tactics, 10/15 calculation, 12/20 openings,
8/12 positional, 5/10 defence, 15/20 own-game annotation and 2/3 reflection minutes
(60/90 respectively). Wednesday/Sunday replace five defence minutes with endgames;
at most two allocated endgame blocks occur per Monday–Sunday week, with excess
returned to openings. These allocations are personal plan data, not installation
defaults. Positional work explicitly alternates Woodpecker 2 and Positional
Patterns Manual with review; tactical review is daily, with conditional new
patterns on Wednesday/Saturday. Every intentional session has its own annotation.

The planner needs three recorded days and 60 relevant minutes in the preceding
seven days before transferring five minutes between eligible blocks. It compares
time against all recorded sessions' allocations, including multiple sessions on
one day. Missing work is unknown, no catch-up debt is created, and the heuristic
does not estimate mastery. Every dated adjustment displays a reason and offers
Use standard plan before starting. Existing sessions/dates are immutable.
See [STUDY_AUTOMATION.md](STUDY_AUTOMATION.md) for commands and external-data limits.

## Verification and delivery

The 2026-10-25 repair passes 34 focused checks, full TypeScript, scoped lint
(zero errors; two existing test-assertion warnings) and the frontend build.
Actual-component Chrome checks verify progress-strip seeking, keyboard/touch
timer seeking, partial restart after reload, preserved history notes and bounded
390px layouts. The existing desktop Dev server serves the repaired module; this
does not update or verify an installed native build.

The 2026-10-24 source milestone passes 29 focused schema/session/mounted-React and
native-file-adapter tests, three automation/DOM-collector tests, full TypeScript,
scoped lint and the production frontend build. Tests cover pause/reload, expiry,
London rollover, mode changes, completion/next/final, intentional new sessions,
annotation gating, FEN preservation, migration, write failures and dated-plan bounds.
Fixtures are tiny and synthetic.

`node scripts/preview-study-session.mjs` runs the actual panel at an ephemeral
loopback URL with labelled invented data and browser-only storage. Chrome checks
cover timer/progress, reload, exact exercise selection, annotation gating,
month/custom history and narrow layouts. Native rendered UI, native authenticated
course access, installed release and physical phone are separate evidence. This
milestone does not restart/rebuild the installed application, publish the hosted
phone app, or change Tailscale/services.
