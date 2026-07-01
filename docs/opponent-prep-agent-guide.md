# Opponent Prep Agent Guide

This guide is for future agents handling requests like:

> Do prep for this tournament / opponent list.

The expected output is not just research notes. The agent should create
opponent-ready En Croissant assets:

- One folder of PGN files per opponent in the user's En Croissant Files root.
- One En Croissant `.db3` database per opponent in the active app database
  directory.
- A final chat response that states exactly what was researched, what was
  created, how many games were found for each opponent, and which players still
  have missing or low-confidence game coverage.

The goal is to avoid missing games that are online somewhere, especially
Lichess broadcast PGNs, Chessscope-indexed broadcast games, ChessBase/Mega
database games, tournament-site PGN downloads, and current online-account
sources such as Chess.com, Lichess, and World Chess / FIDE Online Arena.

## Critical Lessons From The Muswell And Oxford Prep Sessions

- Create a separate database per player. Do not create only one combined
  database unless the user explicitly asks for it.
- The active app data identifier may not match the fork name. Check
  `src-tauri/tauri.conf.json` for `identifier`; for this fork it was
  `org.encroissant.app`, so the real database directory was:
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db`.
- The compiled `pgn_to_ec_db.exe` overwrites the target `.db3`; it does not
  append. If the app has a database open, Windows may lock the file. Close/stop
  the running fork before replacing databases, then restart it.
- Keep the user's Files folder and the app database directory in sync. If you
  add new PGNs to a player folder, rebuild that player's `.db3`.
- Search online PGN sources for every single target player, even when local
  Mega/reference databases already found many games. Local database hits are
  never a reason to skip Chessscope, Lichess broadcasts, TWIC, event PGNs, or
  other online source checks for that player.
- For real web prep or account-finding work, spawning online-account subagents
  is mandatory when tooling is available: assign at least one dedicated
  account-finding subagent per player being prepped. Give each subagent explicit
  player identities, FIDE/national IDs, source targets, and the requirement to
  search hard for credible Chess.com, Lichess, World Chess / FIDE Online Arena,
  and other online-account links with corroborating evidence. Use additional
  source-family subagents for downloadable PGNs when useful. The lead agent
  still owns dedupe, database creation, verification, and the final honesty
  check. If multi-agent tooling is unavailable, say so in the final response
  and do the same source checklist manually.
- Do not do a shallow global pass and call it finished. Work player by player,
  and do not move on from a player until that player has completed the full
  exhaustive checklist: identity normalization, local/reference databases,
  Chess-Results PGN search by FIDE ID, Lichess FIDE page, direct Lichess
  broadcast rounds, the official Lichess broadcast database, Chessscope, TWIC,
  event/tournament PGN sources, federation/event leads, public game databases,
  and account research where relevant.
- The Oxford U2300 prep proved that a "Mega + current Lichess FIDE page" pass
  can miss hundreds of games. The full public Lichess broadcast database and
  Chess-Results direct PGN search by FIDE ID added large numbers of games that
  were not exposed by local Mega or current player-page links.
- For every player, record both source PGN counts and converted database
  counts. The converter can skip malformed games; a small difference between
  source PGNs and `.db3` game count is possible and must be reported rather
  than hidden.
- Re-check players with zero or suspiciously low game counts before finalizing.
  If the first pass finds few games, make a second targeted pass with alternate
  spellings, FIDE/national IDs, event leads, Chessscope, Lichess broadcasts,
  TWIC, and local/reference databases before reporting the count as final.
- Public online-account guesses are not OTB game sources. Keep online-account
  research and imported online games separate from OTB/broadcast PGN imports.
  After candidate accounts are found, import public Chess.com, Lichess, World
  Chess / FIDE Online Arena, or other account games into separate account
  databases when PGN export is available, compare their opening profile against
  the OTB prep games, and update confidence. If the comparison shows a clear
  mismatch, delete the imported PGN/`.db3`/search index and keep only a rejected
  lead note so the bad account is not reused.
- At the end of an event prep run, organize app-side databases into a clear
  event folder rather than leaving many flat files in the database root. Use
  subfolders such as `OTB Prep` and `Online Accounts`, and make account
  filenames link the OTB player to the platform and handle/profile ID, for
  example `02 Onuoha, Obioma - Chess.com obiosky.db3` or
  `00 Kodukula, Sameera - World Chess 853760.db3`.
- Chessscope pages may show only an accessible recent slice for prolific
  players. Still check them, because they can reveal many Lichess broadcast
  games missing from local Mega databases.

## Local Paths And Conventions

Start from the repo root, for example:

```powershell
Set-Location 'C:\Users\loxty\Desktop\Repos\En croissant chess'
```

Find the active app data directory:

```powershell
Get-Content .\src-tauri\tauri.conf.json
```

Look for `identifier`. For `org.encroissant.app`, databases live at:

```text
C:\Users\loxty\AppData\Roaming\org.encroissant.app\db
```

The default En Croissant Files root is usually:

```text
C:\Users\loxty\Documents\EnCroissant
```

But the user may have configured a custom directory in app local storage. When
in doubt, inspect app settings or ask the user before writing a large prep set.

Use a stable prep folder name, for example:

```text
C:\Users\loxty\Documents\EnCroissant\Muswell Congress player games
```

Inside it, create one folder per opponent. Include account guesses in the
folder name only after research, for example:

```text
Large, Peter G [cc Plimsol high]
Pattni, Kishan [cc kishanpattni84 high]
Yu, Rock [cc none credible]
```

Keep folder names short enough for Windows paths.

## End-To-End Workflow

1. Parse the entrant list.
   - Use the official tournament page first: Chess-Results, Tornelo, Vega,
     Swiss-Manager, event website, federation page, or PDF.
   - Record name, rating, federation, club, FIDE ID, ECF code, title, and any
     username/account fields.
   - Apply the user's threshold exactly, for example "above 1650".
   - Work from highest rated to lowest rated.

2. Normalize player identities.
   - Store surname-first and forename-first variants:
     `Large, Peter G`, `Peter G Large`, `Peter Large`.
   - Store initials variants:
     `B R Gagan`, `Gagan, BR.`, `Gagan, B.R.`, `Gagan, B R`.
   - Record FIDE ID and national ID where possible. FIDE ID is the strongest
     dedupe and broadcast-filter signal.
   - For UK players, check ECF rating pages for clubs and exact ECF code.

3. Create a working manifest.
   - Keep a local JSON/CSV/Markdown table with one row per target while doing
     the work. This is an internal tracking aid, not a required final
     deliverable.
   - Columns: player, rating, FIDE ID, national ID, club, federation,
     online account leads, confidence, OTB PGNs found, broadcast PGNs added,
     most recent game found, notes.

4. Coordinate a web-search subagent team by default.
   - Before doing the online pass, use the available multi-agent tooling to
     spawn account-finding subagents. This is mandatory when the tools exist:
     assign at least one dedicated online-account search subagent for every
     player being prepped. For a single-player account-finding task, use at
     least two focused searches when possible: one for identity/club/context and
     one for online-account candidates and profile verification across
     Chess.com, Lichess, World Chess / FIDE Online Arena, and similar public
     platforms. For larger prep jobs, use one account-search subagent per
     player plus any broader source-family subagents that would help.
   - Use subagents to speed up and broaden the online research pass, especially
     for larger entrant lists or events with many possible sources.
   - Assign work by player or by source family, for example Chessscope/Lichess
     broadcasts, Chess-Results/TWIC/event PGNs, federation/FIDE/event leads,
     public game databases, and online-account research for Chess.com,
     Lichess, World Chess / FIDE Online Arena, and other public platforms.
   - Every subagent brief must include the player's normalized name variants,
     FIDE ID, national ID, federation/club/event clues, and the expected output:
     downloadable PGN links or files found, source pages checked, most recent
     game found, candidate online accounts with confidence, and unresolved
     gaps.
   - Tell subagents to search hard, not just run one query. They should use
     alternate spellings, initials, FIDE IDs, event names, club names, FIDE
     Online Arena/World Chess profile IDs, and broadcast sources before
     returning "no games found" or "no credible online account".
   - The lead agent must merge subagent findings into the working manifest,
     dedupe PGNs, verify counts, and resolve conflicts. Subagent reports are
     evidence, not final truth.
   - Do not use subagents as a reason to skip the required per-player checklist.
     Each player must still have a complete online-source result recorded.
   - If multi-agent tooling is unavailable or blocked, record that limitation
     and continue manually with the same source checklist instead of silently
     skipping the team-search expectation.

5. Complete the full search checklist for player 1 before player 2.
   - This is the most important workflow rule. Do not batch a weak source pass
     across all players and then report the job as done.
   - For each player, finish the checklist below, import/dedupe any games,
     update that player's manifest row, and only then move to the next player.
   - The only acceptable batching is mechanical download/filter work that still
     records a complete per-player source result. For example, streaming the
     full Lichess broadcast database once is fine if every target player's
     FIDE IDs/name variants are included and per-player added/missed counts are
     recorded.

6. Search local databases for the current player.
   - Check the app database directory for Mega/Big/local reference databases.
   - Search exact player names and known aliases.
   - Prefer exporting by exact internal player ID after resolving the player
     table match. Name-only searches can pull the wrong player when names are
     similar.
   - Export matching games to per-player PGNs.
   - Do not assume local Mega is complete. It missed many recent Lichess
     broadcast games in the Muswell and Oxford prep.

7. Search online PGN sources for the current player.
   - This step is mandatory for every target player, regardless of how many
     games were already found in local/Mega/reference databases.
   - Do not stop after local database matches. Recent Lichess broadcasts,
     Chessscope-indexed games, TWIC files, and event PGNs can add important
     games that Mega/local databases miss.
   - Use the subagent team for this step by default, but keep one lead manifest
     row per player and verify every claimed source/link yourself before
     importing or reporting it. If subagents cannot be used, explicitly note
     that and complete the searches manually.
   - Query Chess-Results `partiesuche.aspx` by FIDE ID and download the result
     as PGN. This is not optional when a FIDE ID is known.
   - Check the Lichess FIDE player page for broadcast round links, then
     download each round PGN and filter by FIDE ID/name.
   - Stream the official Lichess broadcast database from
     `https://database.lichess.org/broadcast/list.txt` and filter every monthly
     `.pgn.zst` file by the player's FIDE ID/name. Do this before declaring
     Lichess broadcasts exhausted.
   - Check Chessscope player slugs and follow linked broadcast rounds.
   - Search TWIC, event pages, Chess-Results event pages, and public databases
     for event PGN downloads.
   - Use FIDE ID/name matching, not only visible names.
   - Prefer downloadable PGN endpoints over manually copied movetext.
   - Dedupe before writing files.
   - Keep source tags in `.info` sidecars and the working manifest.

8. Re-check the current player if they have no games or a low count.
   - After the first source pass, sort the manifest by `OTB PGNs found` plus
     `broadcast PGNs added` and flag players with zero games or counts that are
     clearly low for their rating/activity.
   - Run a second targeted search for each flagged player before rebuilding
     databases. Try alternate name orders, initials, diacritics/ASCII variants,
     FIDE ID, national ID, club/event names, and likely recent tournaments.
   - Revisit Chessscope, Lichess broadcast `.pgn` URLs, TWIC/event PGN zips,
     ChessBase/Mega/local databases, FIDE event history, and national
     federation pages for these flagged players.
   - If a player still has no credible PGNs or only a small count, record the
     specific second-pass sources checked in the working manifest so the final
     response can show that the gap was investigated rather than missed.

9. Rebuild one database per player.
   - For every player folder with one or more PGNs, concatenate that player's
     PGNs into a temporary/source `.pgn`.
   - Convert it to `.db3` with `pgn_to_ec_db.exe`.
   - Verify `Games` count with SQLite.
   - Leave players with zero PGNs as folders only, with notes; do not create
     empty `.db3` files unless requested.

10. Import and test online-account databases.
   - For every credible or plausible Chess.com, Lichess, World Chess / FIDE
     Online Arena, or other public online-account candidate, download public
     PGNs when available and create a separate online-account `.db3`. Do not
     merge these games into the OTB prep database.
   - Compare the online account's opening profile against the player's
     OTB/broadcast games before treating the account as active: check White
     first moves, Black first replies, top opening families/ECOs, repeated
     4-6 ply line prefixes, time-control mix, rating plausibility,
     country/location/profile metadata, club membership, FIDE ID/profile ID
     links, and activity recency.
   - Update account confidence from the comparison. Strong line overlap can
     raise confidence; a completely different repertoire, implausible rating,
     wrong country/club context, or contradictory profile metadata lowers it.
   - If the account is a clear mismatch, delete the imported `.pgn`, `.db3`,
     and any stale `.ecsi` search index. Keep a rejected-lead note in the
     manifest/comparison file so future agents do not reimport the same bad
     account.
   - If the account is credible but stale or only partly useful, keep it
     clearly labelled as such rather than presenting it as current prep truth.

11. Organize app-side databases into event folders.
   - Before finalizing, move/rename the app-side databases into a dedicated
     event folder under the active database root.
   - Use clear subfolders, usually `OTB Prep` and `Online Accounts`.
   - OTB database names should identify the event and player, for example
     `02 Onuoha, Obioma - Southall U2400 OTB prep.db3`.
   - Online-account database names must identify the OTB player, platform, and
     handle/profile ID, for example `02 Onuoha, Obioma - Chess.com obiosky.db3`
     or `00 Kodukula, Sameera - World Chess 853760.db3`.
   - Update manifests, comparison reports, and any folder/account labels after
     moving files so paths and confidence notes remain accurate.

12. Prepare the final response.
   - Do not create a separate `research-summary.md` unless the user explicitly
     asks for one.
   - Include exactly what sources were researched, which assets were created,
     per-opponent game counts, most recent game found for each opponent,
     account guesses and imported online-account verdicts where relevant,
     confidence notes, and what could not be found.
   - Explicitly list "no credible PGNs found" cases.
   - For every zero-game or low-count player, include the second-pass searches
     performed and the reason the remaining count should be treated as a known
     source limitation.

## Must-Check Game Sources

### Local En Croissant / Mega Database

Search any installed local databases first:

```text
C:\Users\loxty\AppData\Roaming\org.encroissant.app\db
```

Look for files such as:

```text
Mega database  .db3
Mega database  .ecsi
```

Use exact names, aliases, and FIDE IDs where possible. In the Muswell prep, the
local Mega database found 1,178 games before online broadcast additions.

### Chessscope

Use Chessscope player pages:

```text
https://chesscope.com/player/<surname-forename-slug>
```

Examples:

```text
https://chesscope.com/player/lee-yuk-hei
https://chesscope.com/player/yu-rock
https://chesscope.com/player/sriram-gautam
```

Chessscope game pages often say "PGN body not stored locally", but they link to
the original Lichess broadcast round. Extract links shaped like:

```text
https://lichess.org/broadcast/<event>/<round>/<roundId>
```

Then download the round PGN by appending `.pgn`:

```text
https://lichess.org/broadcast/<event>/<round>/<roundId>.pgn
```

or:

```text
https://lichess.org/api/broadcast/round/<roundId>.pgn
```

Filter the downloaded round PGN by:

- `WhiteFideId` / `BlackFideId`
- exact player name in `White` / `Black`
- known alternate name spelling only if IDs are absent

This source added 488 games in the Muswell double-check pass.

### Lichess Broadcasts And Open Database

Check:

```text
https://lichess.org/broadcast
https://database.lichess.org/#broadcasts
https://database.lichess.org/broadcast/list.txt
https://huggingface.co/datasets/Lichess/tournament-chess-games
```

Lichess broadcast games are often newer than commercial database snapshots.
When you know the event, search:

```text
site:lichess.org/broadcast "<event name>" "<player name>"
site:lichess.org/broadcast "<player name>" "<FIDE ID>"
```

For any broadcast round URL, try the `.pgn` suffix. Download the entire round
and filter locally.

The full public broadcast database is mandatory for an exhaustive pass. Stream
every monthly `.pgn.zst` listed in:

```text
https://database.lichess.org/broadcast/list.txt
```

Filter by `WhiteFideId` / `BlackFideId` first, then exact normalized player
names only when IDs are absent. Do not download the full archive permanently
unless needed; stream/decompress/filter when possible. In the Oxford U2300
prep, this source found hundreds of games missed by local Mega and current
Lichess FIDE player-page links.

### ChessBase / Mega / Live Database

Check local Mega first if installed. If the user has ChessBase or a premium
account, also search:

```text
https://database.chessbase.com/
https://account.chessbase.com/
https://en.chessbase.com/
```

ChessBase/Mega is strong for older OTB games and standardized player names, but
can miss recent broadcast games. If you find games in ChessBase that are not in
local En Croissant, export PGN if the user's access allows it.

### The Week In Chess

Check TWIC for recent tournament PGN zips:

```text
https://theweekinchess.com/twic
https://theweekinchess.com/twic/twic
```

Search by event and player:

```text
site:theweekinchess.com/twic "<event name>" pgn
site:theweekinchess.com/twic "<player name>"
```

Download PGN archives, filter by player, and dedupe.

### National And Federation Databases

For UK/English players:

```text
https://rating.englishchess.org.uk/players/list
https://rating.englishchess.org.uk/players?ECF_code=<code>
```

Use ECF for exact identity, clubs, rating, and event leads. ECF pages usually
do not provide PGNs, but they reveal club and event names to search elsewhere.

Also check:

```text
https://ratings.fide.com/
https://ratings.fide.com/profile/<fideId>
```

FIDE profile/event history can reveal tournaments to search on Lichess,
Chess-Results, TWIC, ChessBase, Chess24 archive pages, or event sites.

### Tournament Platforms And Event Sites

Search for PGN/download links on:

```text
https://chess-results.com/
https://s1.chess-results.com/
https://tornelo.com/
https://lichess.org/broadcast
https://chess24.com/
https://www.followchess.com/
https://view.livechesscloud.com/
https://live.chessbase.com/
https://www.chessbomb.com/
```

Useful queries:

```text
"<event name>" pgn
"<event name>" "<player name>" chess pgn
"<event name>" lichess broadcast
"<event name>" livechesscloud pgn
"<player name>" "lichess.org/broadcast"
"<player name>" "Chess-Results"
```

Some event pages publish a single PGN zip for all rounds. Download the full
event PGN and filter locally.

Chess-Results has a direct game search that can return PGN by FIDE ID:

```text
https://s1.chess-results.com/partiesuche.aspx?lan=1
```

Use the `Txt_FideID` field, choose enough rows, and submit
`Download as PGN-File`. This source is mandatory when the target has a FIDE ID.
In the Oxford U2300 prep, it turned zero-game and low-game players into usable
prep databases and added many games beyond Mega/Lichess page links.

### Public Game Databases

These can be useful for counts, cross-checks, and sometimes PGN export:

```text
https://internet.chesstempo.com/game-database/
https://www.365chess.com/
https://chessarchive.net/en/
https://database.chessmont.com/
https://www.chessgames.com/
https://www.pgnmentor.com/
http://www.saund.co.uk/britbase/
```

Notes:

- ChessTempo has a searchable game database and can be useful for checking
  whether local Mega missed a player.
- 365Chess may require supporter access for PGN downloads.
- BritBase is especially relevant for older British events.
- PGNMentor and event PGN collections can have older curated files.
- Always dedupe and check headers; these sources can differ in name spelling.

### Online Account Game APIs

For credible or plausible online accounts found during prep, import public
account games into separate account databases so the repertoire can be compared
against OTB games. Do not merge these games into the OTB/broadcast prep
database. Chess.com, Lichess, and World Chess / FIDE Online Arena are the main
public APIs to check, but the same confidence/import rules apply to other
platforms with public PGN export.

Chess.com profile and stats:

```text
https://api.chess.com/pub/player/<username>
https://api.chess.com/pub/player/<username>/stats
https://api.chess.com/pub/player/<username>/games/archives
```

Chess.com archive PGNs:

```text
https://api.chess.com/pub/player/<username>/games/YYYY/MM/pgn
```

Lichess profile/game export:

```text
https://lichess.org/@/<username>
https://lichess.org/api/games/user/<username>
```

World Chess / FIDE Online Arena profile and public game APIs:

```text
https://worldchess.com/profile/<profileId>
https://chessarena.com/profile/<profileId>
https://api.worldchess.com/api/gaming/players/<profileId>
https://api.worldchess.com/api/gaming/players/<profileId>/ratings/current
https://api.worldchess.com/api/gaming/players/<profileId>/totals
https://api.worldchess.com/api/gaming/players/<profileId>/games?limit=50&offset=0
https://api.worldchess.com/api/gaming/players/<profileId>/tournaments?limit=50&offset=0
https://api.worldchess.com/api/online/gaming/<board_uid>/pgn/
```

World Chess profiles can be real-name profiles rather than username handles.
When a FIDE ID is known, check the FIDE profile for an FOA title/rating section
or external profile link, then search web results for:

```text
"<player name>" "World Chess"
"<player name>" "FIDE Online Arena"
"<player name>" "chessarena.com/profile"
"<FIDE ID>" "worldchess.com/profile"
"<FIDE ID>" "api.worldchess.com/api/gaming/players"
```

For a candidate World Chess profile, high-confidence evidence is an exact FIDE
ID match in the `gaming/players/<profileId>` API, matching real name,
federation/country, plausible FOA or World Chess ratings, `games_hidden=false`,
and recent public games or tournaments. If public games are available, page
through the `games` endpoint, download each game's PGN through the
`online/gaming/<board_uid>/pgn/` endpoint, exclude bot/zero-ply/broken games,
normalize the target player's name to the folder's canonical `Surname,
Firstname` form, dedupe, and build a separate online-account database.

Filter online games separately by time control and source. Label them clearly
and keep them in their own database/folder if used alongside OTB prep.

## Online Account Research

The goal is a best-guess account table, not false certainty. Search broadly
before deciding there is no credible account on Chess.com, Lichess, World
Chess / FIDE Online Arena, or another public platform, and verify hard before
marking an account as high confidence.

When using subagents, assign online-account research explicitly. Spawn at
least one dedicated account-finding subagent for each player being prepped when
multi-agent tooling is available. Each subagent should search candidate
usernames, real-name profile IDs, profile metadata, public club membership,
country/location/rating plausibility, activity recency, and any event or
federation clues linking the account to the OTB player. This search must cover
Chess.com and also World Chess / FIDE Online Arena whenever a FIDE ID is known;
include Lichess and other public platforms when the player context suggests
them. Require a confidence label and the evidence for it; do not let a
same-name account become an unqualified claim. If tooling is unavailable,
perform the same one-player-at-a-time account search manually and state that
limitation in the final response.

Direct checks:

```text
https://api.chess.com/pub/player/<candidate>
https://api.chess.com/pub/player/<candidate>/stats
https://www.chess.com/member/<candidate>
https://worldchess.com/profile/<profileId>
https://api.worldchess.com/api/gaming/players/<profileId>
https://api.worldchess.com/api/gaming/players/<profileId>/games?limit=1&offset=0
```

Generate candidates from:

- first+last: `kishanpattni`
- last+first: `pattnikishan`
- initials: `kpattni`, `jdllewellyn`
- first initial + surname, surname + first initial, initials + surname, and
  surname + initials
- forename variants, middle-name variants, shortened names, nicknames, and
  common transliterations or ASCII versions of names with diacritics
- surname-only or distinctive full-name fragments when the surname is uncommon
- year suffixes: `kishanpattni84`
- federation, club, school, city, or event abbreviations combined with name
  fragments
- known handles from club pages, federation pages, event pages, social links,
  Lichess profiles, old PGN tags, World Chess profile IDs, FOA/FIDE links, or
  local context

Required search passes:

- Search the direct candidate profile/API URLs above.
- Search web results for Chess.com member pages using full name, surname-first
  name, initials, FIDE ID, ECF/national code, club, school, city, and known
  event names.
- Search World Chess / FIDE Online Arena profile pages using full name,
  surname-first name, FIDE ID, federation, title, school/club/city clues, and
  `chessarena.com/profile` / `worldchess.com/profile` URL patterns.
- When a World Chess profile is found, verify the public API profile fields:
  exact FIDE ID, real name, country/federation, FOA title, activity status,
  `games_hidden`, ratings/current, totals, latest game, and tournament count.
- If the World Chess games API exposes public games, test a sample
  `online/gaming/<board_uid>/pgn/` endpoint and import the account when the
  profile is credible or plausibly useful.
- Find the player's real-world club from ECF/FIDE/tournament pages where
  possible, then search for that club on Chess.com.
- If a likely Chess.com club exists, inspect the public members list if visible
  and search within/around it for the player's real name, initials, aliases,
  and candidate usernames.
- Search public Chess.com club pages, news, forums, descriptions, and member
  pages for the club plus player-name variants.
- Cross-check candidate accounts against country flag/location, displayed
  name, linked clubs, activity recency, online ratings, time-control ratings,
  and exact FIDE/FOA profile IDs when available.

Club-member heuristics:

- Get clubs from ECF/FIDE/tournament pages.
- Search Chess.com clubs by club name.
- Look at public member lists if visible.
- Try club abbreviations, old club names, school names, city names, and nearby
  chess-center names.
- Treat membership in the player's real-world club's Chess.com club as useful
  evidence, especially when combined with plausible country/rating/activity.
- Search:

```text
site:chess.com/club "<club name>" "<player name>"
site:chess.com/clubs/about "<club name>" "<username>"
site:chess.com/member "<player name>" "<club name>"
site:chess.com/member "<username>" "<club name>"
site:chess.com/forum "<club name>" "<player name>"
site:chess.com/news "<club name>" "<player name>"
```

Rating and identity sanity checks:

- Higher confidence requires the online rating to be broadly plausible for the
  player's FIDE/national strength and time controls. It does not need to match
  exactly, but the order of magnitude should make sense.
- For example, a UK player rated around 1800 FIDE/ECF with an active Chess.com
  account rated around 1700-2100 rapid/blitz is plausible; an active account
  around 800 with no explanation is a major negative signal.
- For World Chess / FIDE Online Arena, exact FIDE ID match plus plausible FOA
  or World Chess ratings is stronger than a name-only match. A real-name
  profile with `games_hidden=false`, recent public games, and an exact FIDE ID
  should be treated as a serious candidate even if no username-style handle
  exists.
- Very low online ratings can still be possible for new, inactive, or puzzle-only
  accounts, but then confidence should stay low unless there is strong external
  evidence linking the account.
- Country flag/location should match or be explainable. A UK OTB player with a
  UK flag, UK city, or membership in a UK club is stronger than a same-name
  account with an unrelated country and no club/name/rating support.
- Activity recency matters. A long-dormant account may belong to the player but
  is less useful for prep; report it separately from active likely accounts.

Score confidence:

- High: strong username/name match plus multiple corroborating signals such as
  matching country/location, exact FIDE/FOA ID, real-world club or likely
  platform club membership, plausible online rating for FIDE/national strength,
  and recent or historically relevant activity.
- Medium: strong username/name match plus some corroboration, such as matching
  country and plausible rating, but no club confirmation or weak activity
  evidence.
- Low: name/username fits but country, club, age, activity, or rating evidence
  is weak, absent, or suspicious.
- None: same-name account is clearly wrong by country/rating/identity, or no
  credible account found after candidate, alias, and club-member searches.

Do not overtrust an exact-name account. In Muswell prep, several exact-name
accounts were discarded because they had US/KR/FR flags or 300-level ratings
for a 1700-1900 OTB player.

After candidate accounts are found, import and test them instead of leaving the
account confidence as a pure profile guess:

- Download all public Chess.com archives, Lichess exports, World Chess
  per-board PGNs, or other platform PGNs for each credible or plausible
  candidate account.
- Convert the downloaded PGN to a separate online-account `.db3` using the same
  converter as other PGNs.
- Store it outside the OTB prep database, in a clearly named event/account
  folder that links player to platform and handle/profile ID.
- Compare the account's openings with the OTB/broadcast prep games. At minimum,
  compare White first moves, Black first replies, common 4-6 ply line prefixes,
  top ECO/opening families, and slower-time-control samples when available.
- Treat a strong repertoire match as corroborating evidence, especially when it
  aligns with real name, country/location, club, and activity clues.
- Treat a completely different repertoire as a serious negative signal. If the
  mismatch is clear, delete the imported PGN/`.db3` and any `.ecsi` index, mark
  the account as rejected, and update the player folder label or manifest to
  avoid future reuse.

## PGN Dedupe Rules

Use a conservative canonical key:

- Date
- White
- Black
- Result
- Movetext stripped of comments, clocks, and repeated whitespace
- FIDE IDs when available

Do not dedupe only by file name. Different sources use different event names
and round tags for the same game.

If two PGNs have the same players/date/result but one has full moves and the
other is empty/truncated, keep the complete one and note the replacement.

## Creating Files Folders

For each PGN file:

- Write one game per `.pgn` file.
- Create a matching `.info` sidecar:

```json
{"type":"game","tags":["lichess broadcast","double-check"]}
```

For original local/Mega exports, tags can be empty:

```json
{"type":"game","tags":[]}
```

Use descriptive file names:

```text
2026.03.15 Player A - Player B [lichess broadcast].pgn
```

Avoid characters invalid on Windows: `< > : " / \ | ? *`.

## Creating Per-Player Databases

Use an event-level app database folder for finished prep. Do not leave a large
event run as a flat pile of files in the database root. A typical finished
layout is:

```text
C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\<Event Name>\OTB Prep
C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\<Event Name>\Online Accounts
```

Use clear titles that encode both purpose and identity:

```text
02 Onuoha, Obioma - Southall U2400 OTB prep.db3
02 Onuoha, Obioma - Chess.com obiosky.db3
00 Kodukula, Sameera - World Chess 853760.db3
```

Keep the matching source `.pgn` beside the `.db3`. If files are moved after
conversion, update the working manifest and any comparison report with the new
paths.

The converter usually exists at:

```text
C:\Users\loxty\Desktop\Repos\En croissant chess\src-tauri\target\debug\pgn_to_ec_db.exe
```

For each player:

1. Concatenate all `.pgn` files from that player's folder into:

```text
C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\<Event Name>\OTB Prep\NN PLAYER - EVENT OTB prep.pgn
```

2. Convert to:

```text
C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\<Event Name>\OTB Prep\NN PLAYER - EVENT OTB prep.db3
```

3. Example:

```powershell
& 'C:\Users\loxty\Desktop\Repos\En croissant chess\src-tauri\target\debug\pgn_to_ec_db.exe' `
  'C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Muswell Congress\OTB Prep\01 Large, Peter G - Muswell OTB prep.pgn' `
  'C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Muswell Congress\OTB Prep\01 Large, Peter G - Muswell OTB prep.db3' `
  'Muswell Prep - Large, Peter G' `
  'Public OTB and Lichess broadcast games collected for Muswell prep: Large, Peter G'
```

If replacing an existing `.db3`, close/stop the app first:

```powershell
Get-Process -Name 'en-croissant-fork' -ErrorAction SilentlyContinue | Stop-Process -Force
```

Then restart after the rebuild:

```powershell
Start-Process -FilePath 'C:\Users\loxty\Desktop\Repos\En croissant chess\src-tauri\target\debug\en-croissant-fork.exe'
```

## Verification Checklist

After importing:

1. Count files per folder:

```powershell
Get-ChildItem '<prep folder>' -Directory | ForEach-Object {
  [PSCustomObject]@{
    Player = $_.Name
    Games = (Get-ChildItem -LiteralPath $_.FullName -Filter '*.pgn').Count
  }
}
```

2. Count games per database:

```powershell
@'
import sqlite3, pathlib
root = pathlib.Path(r"C:\Users\loxty\AppData\Roaming\org.encroissant.app\db")
for db in sorted(root.glob("muswell congress prep - *.db3")):
    conn = sqlite3.connect(db)
    print(db.name, conn.execute("select count(*) from Games").fetchone()[0])
'@ | python -
```

3. Confirm the app database directory is the active one.

4. Confirm the final app-side database layout is organized by event folder,
   with separate OTB prep and online-account folders when account games were
   imported. Make sure filenames clearly link each online account database to
   the OTB player, platform, and handle/profile ID.

5. Confirm every credible/plausible online-account candidate has an import
   verdict: active, stale-but-credible, low-confidence, rejected mismatch, or no
   credible account. For active/stale/low-confidence accounts, record the
   platform, handle/profile ID, database path, and converted game count. For
   rejected mismatches, confirm the imported `.pgn`, `.db3`, and stale `.ecsi`
   files were deleted and that a rejected-lead note remains.

6. Open/refresh En Croissant Databases page and verify the per-player databases
   appear.

7. Prepare final-response counts from the verified folder and database totals:
   - original/local games found
   - online/broadcast games added
   - current total per opponent
   - most recent game found per opponent, including date, event/source if
     known, opponent, color, and result when available
   - sources checked
   - no-PGN and low-count cases
   - online-account imports, mismatch checks, and confidence verdicts where
     relevant

## Reporting To The User

Keep the final answer short but precise:

- Say how many databases were created.
- Say exactly what was researched: entrant source, local/reference databases,
  broadcast/event/TWIC sources, federation/FIDE pages, and any online account
  checks that were actually used.
- Give an honest per-opponent count table: player, local/reference PGNs,
  online/broadcast PGNs added, final PGN/database count, most recent game found
  with date/event/opponent/result where available, and coverage notes.
- For online accounts, state the platform, handle/profile ID, converted game
  count, confidence after comparing openings with OTB games, and whether any
  imported account was deleted as a clear mismatch.
- List players with zero PGNs or suspiciously low counts, including the
  second-pass sources checked for them.
- Say where games may still be missing, such as inaccessible ChessBase exports,
  events with no public PGN, Chessscope recent-slice limits, ambiguous player
  identities, or unconfirmed online accounts.
- Mention the folder and database paths, including the event database folder
  and any `OTB Prep` / `Online Accounts` subfolders.
- Mention any source limitations, for example: Chessscope only exposed the
  accessible recent slice for very prolific players.

Do not claim "all games" unless you actually checked the major sources above
and documented the limitations.
