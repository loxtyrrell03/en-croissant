# Game date ranges

Native Database (side and below-board), Compare and Prep use the same compact
date control. All time, rolling month/year presets and an editable custom range
retain the app's existing source options and calendar precision: local databases
use inclusive days, Lichess All whole months and Lichess Masters whole years.
Help explains the source resolution. Applying an inverted or impossible range is
disabled; invalid saved filters stay visible for explicit repair and cannot
silently cause an unfiltered search.

Database and Compare save range metadata in their existing per-file option maps.
The two Database placements remain independent. Prep keeps a date map separate
from Database and keyed by Player/General mode and source family, within each
tab/placement's state and saved Prep defaults. Existing shared explorer filters
are snapshotted once during migration; subsequent Database changes do not change
an initialized Prep selection. Explicit handoffs retain only their specified
range; unspecified slots use All time.

`utils/gameDateRange.ts` resolves bounds at the native and online query
boundaries. Rolling presets clamp month ends and recalculate from the local
calendar. `useCalendarDay` refreshes mounted queries/cache keys at local midnight
and after focus/visibility changes, including daylight-saving transitions.
Plans, Engine Plans, Gaps and Coach also read effective explorer dates.

Prep applies the chosen range to source games, branch/line searches, building,
training evidence and reference queries. Its query context includes the owner,
starting position, root path, source and effective dates. A changed context
invalidates cached work and cancels outstanding builders; delayed replies cannot
append moves to the new context. Moves already generated before cancellation
remain available to save.

Verification uses synthetic fixtures and the actual native Database, Compare,
Prep and date controls, plus actual native-query and online-query serializers.
It covers both placements, source/mode independence, stored selection hydration,
repair, calendar validation, delayed replies, help focus/Escape and the 25-hour
October calendar day. Source tests and builds are separate from installed-app,
rendered narrow/touch and physical-phone verification. The phone implementation
uses the same calendar control and pure date calculations, as described below.

Primary `ac39c301` and clean delivery `74c3a1d6` pass 559 related frontend
checks across 69 files and full types. The new date suites pass 17 checks/five
files; the final ownership guard passes ten checks/two files. Scoped lint reports
zero warnings/errors across 23 code files. Clean desktop and canonical-phone
builds pass in 26.91/22.64 seconds; all 24 owned source/test/style files match.
The compact private receipt records hashes and the phone bundle identity.
These builds do not deploy the controls or add phone date UI.

## Phone dates

Phone Database and Prep now reuse the calendar control, including in their
started move/training views. Database stores independent Local/Lichess All/
Lichess Masters choices in each workspace's `workspacePreferences.gameDates`.
Draft Prep has its own group, with independent Player/General and source-family
slots; temporary imports have a separate slot. Starting Prep copies the entire
Prep date map into its durable `dateRanges`, so a rolling choice keeps rolling
after creation, file switches and remounts. Existing filters migrate once through
the retained root writer; non-date explorer options keep their existing storage.

Both the parent training/branch calculations and child source tables use the
effective range. Pure Prep evidence and actual direct/proxy explorer URL builders
resolve metadata again at use time. Midnight/focus/visibility refresh cached
views; online abort guards discard superseded current/root requests. Chosen
bounds are never discarded by the old picker defaults: an unsupported API
request reports its error instead of silently showing a broader range.
Recognizable invalid saved selections remain repairable; malformed map shapes
use the existing preserved-workspace load failure path.

Lazy synced sources are an intentional phone exception. Their static position
shards and current En position helper expose aggregate move counts, without
individual game dates. Filtering those counts by the latest game date would
produce incorrect results. A date-filtered lazy source therefore shows the
full-PGN requirement and blocks the query/Start action. Choosing All time restores
its existing position query. Full PGN databases, temporary PGNs and online
explorers support the new ranges; no corpus rebuild or owner-data migration is
performed. Native local queries retain their existing full date support.

Synthetic actual-phone controls cover custom calendars, file/source/mode
independence, starting/remounting Prep, daily training-row refresh and explicit
repair/clearing before a lazy query. Serializer/evidence tests cover inclusive
bounds, rolling updates and unchanged unrelated options. These source/component
checks do not establish browser layout, installed delivery or physical-phone
verification.

Phone source `5e12da56` and clean delivery `be9e7eb1` pass 570 related frontend
checks across 71 files, full types and nine-file lint with zero warnings/errors;
WebApp retains 25 existing warnings. All eleven new date checks pass. One
existing workspace-preference fixture exceeded its unchanged five-second timeout
while a build ran concurrently; its isolated recheck and complete 570-check
recheck pass without changing timeouts or assertions. Keep production builds
separate from the heavy actual-app UI suite on this machine. Clean desktop and
canonical-phone builds pass in 28.51/26.23 seconds; all ten owned files match.
The private receipt records hashes and this transient failure as well as the
passing rechecks. No live publication occurred.
