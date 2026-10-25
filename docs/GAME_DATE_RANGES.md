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
rendered narrow/touch and physical-phone verification. Phone controls and their
independent persisted date scopes remain a separate delivery slice.

Primary `ac39c301` and clean delivery `74c3a1d6` pass 559 related frontend
checks across 69 files and full types. The new date suites pass 17 checks/five
files; the final ownership guard passes ten checks/two files. Scoped lint reports
zero warnings/errors across 23 code files. Clean desktop and canonical-phone
builds pass in 26.91/22.64 seconds; all 24 owned source/test/style files match.
The compact private receipt records hashes and the phone bundle identity.
These builds do not deploy the controls or add phone date UI.
