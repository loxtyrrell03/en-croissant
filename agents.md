# AGENTS.md

This file is the working product map for the En Croissant fork on the
`codex/en-croissant-fork` branch. It records the major features added during
the recent Codex session and gives future agents the design intent, navigation
model, implementation map, and verification expectations for this app.

## Ongoing Workflow

- Automatically create git commits as work progresses whenever an important,
  coherent milestone has been completed.
- Keep each commit focused on the meaningful progress just made, with a concise
  message describing that milestone.
- After each meaningful change or feature, update this `AGENTS.md` product map
  with a short note explaining what was added and why, so future agents inherit
  the current design intent instead of only the code diff.
- Do not wait until the end of a long session to save progress unless the user
  explicitly asks for a single final commit.
- Avoid committing broken, half-finished, or unverified work unless the user
  explicitly asks for a checkpoint commit.
- The working tree may contain user changes or local verification artifacts.
  Do not revert or delete them unless the user explicitly asks.

## Agent Playbooks

- Opponent preparation now has a dedicated future-agent playbook at
  `docs/opponent-prep-agent-guide.md`. Use it when the user asks for chess prep
  from an opponent, entrant list, congress, tournament, or rating threshold. It
  records the required per-player folder/database workflow, source checklist,
  Lichess broadcast PGN extraction pattern, Chess.com account-confidence
  method, dedupe rules, and En Croissant verification steps.

## Local Browser Verification

- Use the Playwright MCP browser tools directly for localhost UI checks,
  screenshots, DOM snapshots, and layout measurements.
- The Vite dev server for this Tauri app normally serves at
  `http://localhost:1420`; `vite.config.ts` has `strictPort: true`, so check
  whether that port is already owned before starting a new server.
- Opening the app directly in a regular browser is outside the Tauri shell, so
  the page needs minimal Tauri globals injected before navigation. With
  Playwright, install these with `page.addInitScript` before loading the app.
  Stub
  `window.__TAURI_OS_PLUGIN_INTERNALS__` and `window.__TAURI_INTERNALS__` with
  no-op `invoke`, event listener, metadata, and `convertFileSrc` handlers before
  loading `http://localhost:1420`.
- For layout checks, inspect real DOM dimensions instead of relying only on
  screenshots. Useful measurements are `#left`, `.cg-wrap`, the eval bar
  element, and any nearby panel that may be limiting the board.
- Temporary Playwright screenshots and `.playwright-mcp/page-*.yml` snapshots
  are local verification artifacts. Do not delete them unless the user
  explicitly confirms deletion.

## Product Direction

This fork is becoming a guided chess improvement workspace layered on top of
the original En Croissant database, board, and engine tools. The product should
stay powerful, but the default path should be task-led:

- Prepare against an opponent.
- Review opening gaps from a repertoire, online games, or a reference database.
- Review mistakes from local or online games.
- Analyze a single game quickly.
- Explore opening plans and database move choices from the current board.
- Maintain local databases, online game databases, and Lichess study imports.

The design principle is "guided depth": keep all expert controls available, but
lead with the next useful action, the source of the evidence, and the safest
default.

## Product Map

### App Shell

- `/home` is now the task launcher. It opens recent files, imports games,
  starts puzzles, opens the latest online game, launches the online game picker,
  manages Opening Review decks, and manages Mistake Review decks.
- `/files` remains the file and repertoire library. Recent work improved root
  drag behavior, deselection, file-preview safety when no board tab exists,
  right-click rename actions for files and folders in the tree, and a folder
  import/export flow that splits a PGN or `.db3` database into one game file per
  game.
- `/databases` manages local databases, online game databases, merged
  Lichess/Chess.com databases, Lichess study imports, database conversion, and
  auto-update metadata. Database settings can export a whole database into the
  Files root as a folder of per-game PGNs.
- `/accounts` stores linked Lichess and Chess.com sessions. The sidebar shortcut
  was removed, but account settings remain reachable from online-game flows.
- `/engines` and `/settings` remain the local engine and global app settings
  surfaces. Settings now include trainer bot, engine display, and board behavior
  affordances.
- Board tabs now represent active workspaces: analysis, play, puzzles,
  Opening Review, and Mistake Review.
- Analysis workspaces place a Save game to files button in the top-left app
  bar near the File menu; it always saves the currently analysed game as a PGN
  copy, including games opened from online imports or database rows.

### Home Launcher

`src/components/tabs/NewTabHome.tsx` is the primary product entry point.

- "Analyse latest" pulls the newest linked Lichess or Chess.com game directly
  into an analysis board.
- The online game picker can select one recent game for analysis or multiple
  recent games for review generation.
- Opening Review opens saved decks, shows deck positions, supports focused
  practice by opening or color, launches Analyze Repertoire, and can create
  opening review decks from selected online games.
- Mistake Review opens saved mistake decks, launches a local PGN/database scan,
  and can create mistake decks from selected online games.
- Daily goals count completed Opening Review and Mistake Review trainer cards
  from any trainer entry point, including focused and long-think sessions.
- Empty states should always offer the next action: analyze repertoire, choose
  online games, add an engine, add a reference database, or link accounts.

### Board Workspace

`src/components/boards/BoardAnalysis.tsx` is the reusable analysis shell.

- The left side is the board plus always-visible annotation tools underneath.
- The right side uses responsive, independently scrollable panels.
- The top-right tabs are Practice, Analysis, Database, Plan Explorer, Engine
  Plans, Compare, and Info. Practice appears for repertoires and review decks.
- The bottom-right area contains detached eval, notation, board controls, and
  move controls.
- The under-board move-list area has a compact Moves / Database / Prep switch.
  Database and Prep reuse the existing right-panel implementations under the
  board so analysis can keep another feature open on the right; move controls
  stay visible only in Moves mode to give those panels the full lower workspace.
  The notation top bar stays stable while switching those modes. Under-board
  Prep uses a two-stage flow: setup first for source/opponent selection, then a
  training stage with the prep line, Common move, Done + next, and the move
  table so it fits the smaller space.
- Prep move tables support clickable, keyboard-accessible column headers for
  local sorting, matching the Database tab expectation: Move, Games, Results,
  Prep, and State in opponent-move mode, and Move, Games, and WDL in candidate
  reply mode.
- Engine output is docked into the active panel where possible and hidden when
  disabled.
- Board tab labels use icon-first compact tabs with hover tooltips.
- Arrow keys move through notation unless a modifier is held.

### Analysis And Engine Surfaces

- Analysis uses local engines, ChessDB, and Lichess Cloud where available.
- Lichess Cloud evals are integrated into analysis and local-engine fallback.
- Local Stockfish starts promptly while cloud checks run in parallel.
- Engine output has been compacted so lines remain single-row and the dock fits
  content.
- Engine contention was reduced so analysis, annotation, and review UI remain
  responsive.
- Engine Plan Explorer can show plan-like continuations from engine analysis,
  including automatic board arrows.

### Databases And Sources

Database work is centered in `src/components/databases/*`,
`src/components/panels/database/*`, and `src-tauri/src/db/*`.

- Local database search now has cancellable request IDs.
- Database, Compare, and Plan Explorer cancel obsolete searches when users
  leave the view or change the source.
- Exact position lookup uses serialized occurrence indexes in `.ecsi` search
  indexes where possible.
- Existing v4 `.ecsi` indexes remain readable.
- Very large databases skip the synchronous occurrence table path to avoid
  blocking Mega Database loads.
- The mmap search-index cache keeps several recent indexes warm so Compare can
  keep both selected databases active.
- Search, replay, index generation, Plan Explorer, and database panels tolerate
  Shakmaty's harmless "too much material" validation case for displayable games.
- Opening tables support compact rendering, sorting, recent move sorting,
  player-perspective filters, cloud-enhanced move ranking, WDL perspective
  styling, and board-arrow previews on hover.
- Database Compare supports local sources, Lichess All, and Lichess Masters.
- Database panels use saved default source controls.
- The Databases area now treats database folders as first-class organization:
  `.db3` files can live in nested folders under the database root, folders can
  be created or renamed from the database manager, databases can be moved into
  folders, and the Auto organize action groups common sources such as
  repertoires, online games, reference databases, personal games, and opponent
  prep databases. Folder moves preserve matching `.ecsi` search indexes.
- Database selectors used by analysis, Compare, Plan Explorer, Analyze
  Repertoire, opponent prep, and home review setup use a two-step picker:
  root-level databases remain directly selectable, while foldered databases are
  reached by first choosing the folder and then the database inside it.

### Online Game And Study Data

Online flows are in `src/utils/onlineGameImport.ts`,
`src/utils/onlineLatestGame.ts`, `src/components/common/OnlineGamePickerModal.tsx`,
and `src/utils/lichess/study.ts`.

- Lichess and Chess.com usernames can be imported into local databases.
- A merged online database can combine linked Lichess and Chess.com accounts.
- Lichess account tokens are reused when available.
- Online imports report progress and keep progress moving during long fetches.
- Online mistake and opening review decks can auto-update when linked account
  databases update.
- The online game picker has provider tabs for Lichess and Chess.com, account
  selection, recent-game previews, single-select analysis, and multi-select
  review deck creation.
- The online game picker now has Newer/Older paging so analysis and review
  creation can reach beyond the first recent-game slice without importing a
  full account database.
- Recent-game picker rows show the formatted time control next to the account,
  date, and result so online analysis/review choices can be filtered by pace at
  a glance.
- The Prep tab can import Lichess or Chess.com player games directly into the
  active opponent-prep source. Imports can use a most-recent game count with a
  preview of the oldest included game, or an uncapped date range such as last 3
  months or last year, and can optionally be saved as a normal database.
  Opening the import drawer collapses the normal prep filters so the online
  source, range, save, preview, and import controls remain compact.
- Lichess Study links can be imported as local databases.
- Lichess Study databases support auto-update metadata and refresh tracking.
- Lichess Study databases expose a database-manager reload control that
  re-fetches the latest PGN, rebuilding games, comments, variations, and clock
  annotations; the same panel includes an update-automatically checkbox.
- Lichess Study update state now carries source/activity metadata, uses a
  study-specific banner label, times out stalled PGN downloads, and clears stale
  conversion banners left behind by interrupted sessions.
- PGN import timestamp normalization was fixed so online-update ordering stays
  reliable.

### Opening Review

Opening Review is implemented in `src/components/review/OpeningReviewWorkspace.tsx`
with helpers under `src/utils/openingReview*.ts`.

- Opening Review decks are saved files, not localStorage-only state.
- Analyze Repertoire moved into the Opening Review area rather than the normal
  board tab strip.
- Analyze Repertoire has two user-oriented modes: prepare against an opponent's
  repertoire and find gaps in the user's own repertoire.
- The scan is orientation-aware and attributes positions to the side being
  prepared or reviewed.
- Opening health uses frequency, recency, practical result gaps, and only large
  engine drops to prioritize cards.
- Date filters can limit opening health to recent games.
- Opening stats cache names, show summary bars, and respect white/black result
  perspective.
- Cloud validation uses ChessDB for bulk checks, Lichess Cloud for urgent deep
  checks, and local Stockfish fallback when enabled.
- Lichess Cloud hits and misses are cached so repeated scans avoid duplicate
  requests.
- Validation progress survives leaving and returning to the tab.
- Validation updates are batched; the scan can finish after the bulk ChessDB
  pass while slower validation continues.
- Rows show source, depth, evidence, priority messages, and post-attempt review
  evidence.
- Rows can be edited, deleted, or assigned a direct correct-move override.
- Saved review decks can merge new positions into existing decks.
- Daily Review mode creates a due queue with daily progress.
- Full-deck and focused practice remain available, including filtered practice
  by opening, color, or date range.
- Review cards preserve comments, arrows, annotations, board-played move
  overrides, trainer attempts, and post-attempt exploration as saved review-tree
  data.
- Opening stats now make the active filter scope explicit, use compact
  hover-detail rows for plan gaps and best/worst openings, and provide a Train
  button on each opening group so users can practice only that opening's cards.
- Whole decks and individual cards can be deleted.
- Older cards with generic cloud-validation source labels remain compatible.

### Mistake Review

Mistake Review reuses the Opening Review workspace shell with mistake-specific
deck metadata and training logic in `src/utils/mistakeReview*.ts`.

- Mistake Review scans games for mistakes and saves them as spaced-repetition
  cards.
- Local scans and online selected-game scans both create normal review decks.
- Analysis settings include single Stockfish pass or layered fast/deep
  confirmation, severity filters, win-probability drop thresholds, and time
  control filters.
- Mistake decks record source game metadata, player database information, last
  seen text, and latest additions.
- Daily progress is stabilized and synced after online auto-updates.
- Phase training supports focused mistake categories and session progress.
- Reveal controls, auto-reveal arrows, post-attempt summaries, and game context
  were added to make training less opaque.
- Post-attempt board play stays enabled in the Review tab, so users can explore
  continuations while keeping the mistake feedback visible.
- Starting a new Mistake Review card clears stale reveal/free-play state so the
  answer move is scored and the SRS panel appears instead of a return prompt.
- Mistake Review game info is anchored below the main action area so the board
  and action controls stay primary.
- Time-management training has a per-deck long-think threshold setting on the
  trainer button; trainer counts, position filters, and future auto-updates use
  the current threshold while preserving clock-data safety.
- Focused Mistake Review trainers now respect SRS readiness: long-think, phase,
  and type batches include unseen or due cards by default and do not resurface
  cards scheduled for a future day after they have just been reviewed.
- Mistake Review no longer shows the saved answer in the pre-attempt review UI:
  the old "Current position" answer panel was removed, deletion moved into the
  session header, and board/game info summaries hide best-move text until an
  attempt or explicit reveal.
- Mistake Review and long-think review cards now preserve and hydrate the
  source-game move line up to the mistake position, show that line in the
  right-panel moves list, and use the shared move controls so back/forward
  navigation behaves like normal analysis once the answer is visible.
- Mistake Review trainer responsiveness was hardened for large decks: attempt
  bookkeeping and SRS writes are deferred out of the card-transition path,
  due-review sessions precompute their queue instead of rescanning the whole
  deck after every card, source-game line hydration is cached by stable card
  data instead of object identity, and whole-deck maintenance such as nature
  migration, clock hydration, and online mistake-deck auto-updates stay out of
  active practice.
- Mistake Review board attempts are keyed to the active practice session rather
  than the currently selected right-panel tab, so a user can still play and
  score the answer move after checking analysis, moves, or other review panels.
- Mistake Review large-deck daily practice avoids full-deck sorting and eager
  nature classification for the default trainer controls; daily queues use
  bounded ranked indices and time-management counts stay cheap until training
  actually starts.
- Mistake Review keeps the interactive engine listener alive on right-side
  panels that render engine controls, including the Review page, so reveal-time
  engine enabling and dock controls work without forcing users into the Eval
  tab.
- Opening Review and Mistake Review practice transitions load the target FEN
  first and defer source-game move-line hydration plus saved review-tree child
  cloning until the hidden-answer phase is over; idle prewarming should not
  parse full saved move sequences or clone saved child lines while the user is
  actively solving a hidden card.
- Opening Review and Mistake Review session progress bookkeeping is scheduled
  as transition work during practice starts and card advances, keeping the board
  position swap and practice-state reset higher priority than counters and
  remaining-queue UI updates.
- Opening Review and Mistake Review practice tree persistence is coalesced and
  idle-scheduled while training, so attempted moves and annotations still save
  back to the deck without forcing immediate large-deck atom updates during the
  next-card path.
- Board-side review-card lookups use the shared review FEN index instead of
  scanning the whole deck when resolving the current practice or mistake card.
- Hidden-answer review cards keep move-list and move-control subscribers
  unmounted and suppress engine-arrow derivation until feedback is visible, so
  the next-card paint is not competing with notation controls or stale analysis
  arrow processing.
- Hidden-answer mistake cards use only already-stored mistake-type metadata in
  board and game-info panels; fresh tactical/positional classification is
  deferred until answer feedback is visible.
- Due, full-deck, and scoped review trainers keep their large
  remaining-position queues stable while advancing by cursor offset, avoiding
  per-card array copies through React state on large Opening Review and Mistake
  Review decks.
- Engine enable/disable-all updates are idempotent, so Mistake Review's
  optional engine-off-on-navigation behavior does not rewrite engine settings
  or wake engine subscribers when engines are already in the requested state.
- Review summary snapshots stay frozen while a practice session is active and
  refresh when practice returns idle, avoiding the old delayed 2.5-second
  whole-deck stats refresh during card transitions on large decks.

### Practice Bot Trainer

Practice bot work is in `src/utils/practiceBot.ts`,
`src/hooks/usePracticeAgainstBot.ts`, `src/components/boards/OpponentForm.tsx`,
and `src-tauri/src/game.rs`.

- Puzzles now have a bot-practice entry point.
- The play setup can use a trainer bot profile instead of only a manually
  selected engine.
- Managed Maia trainer support installs or configures LC0/Maia where supported.
- Trainer strength is configured by FIDE-style rating and mapped to Maia or
  Stockfish as needed.
- Stockfish is used above Maia's useful capped range.
- Bot clock pacing and move delay were tuned so practice feels closer to a real
  opponent.
- Trainer settings include bot kind, rating, time usage, and time control.

### Plan Explorer

Plan Explorer lives in `src/components/panels/plan/PlanExplorerPanel.tsx`,
`src/utils/planExplorer.ts`, and backend search code.

- The tab is a ChessBase-style way to see piece routes and common plans from
  the current position.
- Sources include local reference databases, Lichess All, and Lichess Masters.
- Rows are grouped by piece, route count, result bars, side filters, ply depth,
  and selected database.
- Hovering a route previews arrows on the board.
- Hovering a piece row previews the piece's most common maneuver.
- Clicking a route pins its arrows.
- Ctrl+right-click on a board piece draws that piece's normal route.
- Auto arrows can be enabled from the panel and globally from board settings.
- Defaults are 8 ply and 10 automatic arrows.
- Automatic plan selection favors significant queen, rook, bishop, and knight
  maneuvers plus key pawn breaks or advanced pawn moves.
- Fallback scans use depth-aware sample caps and cancel as soon as enough
  continuations have been collected.
- Repeated lookups are cached, and side filters are pushed into board arrow
  data.

### Pawn Structure Trajectory

Pawn Structure Trajectory is implemented in `src/utils/pawnStructureDetector.ts`
and `src/utils/pawnStructureTrajectory.ts` using
`src/data/pawnStructureTemplates.v1.json` as the source of truth.

- All 28 Flores/Rios structure templates are first-class detector targets.
- Detection is pawn-skeleton based, supports colour reversal for every template,
  and supports file mirroring only where the template allows it.
- Required template features are weighted confidence signals rather than exact
  equality gates, while anchor pawns and forbidden conflicts keep matches
  conservative.
- Every detection returns confidence, side roles, evidence, and typical
  pawn-break plans where available.
- Open KID detection covers both common central-exchange subtypes: dxe5/dxe5
  e4/e5 liquidation and ...exd4 structures with primary c4/e4, no primary
  d-pawn, opposing d6, and the opposing c-pawn still providing KID context.
- KID Type I is calibrated as the post ...cxd5/cxd5 structure with d5/e4
  versus d6/e5 and both c-pawns gone; a position where Black has only played
  ...c6 remains pre-exchange and should not be labelled Type I.
- Benko detection includes the accepted/post-c-pawn-exchange shape where the
  primary side has d5/e4 with no c-pawn against opposing c5/d6, but still
  requires missing opposing a/b-pawn or open-file evidence so ordinary Benonis
  do not get absorbed.
- Asymmetric Benoni is calibrated as the c-pawn-exchanged d5/e4 versus c5/d6
  structure: the primary c-pawn is gone and the opposing e-pawn is gone. If the
  primary c-pawn remains on c4, use the appropriate symmetric Benoni/KID/Benko
  sibling instead of forcing Asymmetric Benoni.
- French Type I and III are calibrated around the d/e French centre while
  allowing c-pawns to remain home or advance: Type I is d4 versus d5/e6 with no
  primary e-pawn and no opposing f-pawn; Type III is d4/e5 versus d5/e6. Panov
  accepts the opposing e-pawn on e7 or e6, since c5/d4 versus d5 is the anchor.
- Najdorf, Dragon, and Scheveningen structures treat the opposing c-pawn being
  gone as a strong Sicilian-family signal rather than an absolute gate. If the
  c-pawn is still on the c-file, including c5, the detector may still classify
  the central shell but should show lower confidence and missing-c-file
  evidence.
- Central c/d/e pawn coordinates carry extra weight in Sicilian/KID/French
  overlap. In Open Sicilian shells, primary c4+e4 with no d-pawn and the
  opposing c-pawn gone is treated as a Maroczy Bind rather than Najdorf Type II,
  even if the opponent also has a d6/e5 Boleslavsky-style centre.
- The 3-3 vs 4-2 endgame-majority template allows file mirroring, so it detects
  both queenside and kingside versions of the four-pawn majority while still
  requiring simplified/central-liquidated evidence. It is strict about pawn
  files rather than ranks: primary a/b/c/f/g/h versus opposing a/b/c/d/g/h, or
  the file-mirrored equivalent.
- Main-line trajectory analysis groups consecutive structures, suppresses
  one-ply flicker, identifies transitions, picks primary and secondary
  structures, and writes a compact structural story.
- The board workspace has a compact Structures tab showing the current
  position label, confidence, role text, evidence, primary/secondary game
  structures, segment timeline, and transition moves. Clicking a segment jumps
  to the first move of that structural phase.

### Layout, Interaction, And Polish

- The old board workspace split shell was replaced with a resizable board and
  right-side layout.
- The board grows with a widened left pane, and responsive panel scaling keeps
  dense database/review tables usable.
- Resize handles are hidden unless needed visually.
- Annotation tools stay visible under the board instead of living in a tab.
- Board arrows are used for database moves, Compare rows, Analyze Repertoire,
  Plan Explorer routes, engine plans, and review feedback.
- Hover behavior should be discoverable through cursor changes, tooltips, icon
  tabs, or visible row affordances.
- The annotation editor should not steal focus from board or practice input.
- Compact panels should use icons, small labels, and stable row heights rather
  than large cards.
- Result bars should match the player's perspective in database, plan, and
  review contexts.

## Design Guide

- Keep the app board-first. The chessboard and current position should remain
  the visual anchor for analysis, review, database research, and training.
- Prefer task-first entry points over exposing raw tabs as the first decision.
  Home should answer "what do you want to do now?"
- Do not remove expert functionality to simplify the app. Layer it behind
  sensible defaults, collapsible settings, focused modals, and saved choices.
- Make evidence explicit. Rows that recommend a move, review card, plan, or
  mistake should show source, sample size, depth, recency, result impact, or
  validation source where relevant.
- Treat cloud and engine work as background work. Show progress, allow users to
  keep moving, cache results, and avoid UI freezes.
- Make data provenance visible. Differentiate local database, Lichess All,
  Lichess Masters, ChessDB, Lichess Cloud, Stockfish, Chess.com, Lichess, merged
  online database, and Lichess Study sources.
- Use compact, utilitarian chess-tool UI. This is a working analysis app, not a
  marketing page. Prefer dense tables, clear sorting, restrained panels, and
  predictable controls.
- Keep text short and user-facing. Prefer "Review due", "Analyse latest",
  "Train mistakes", and "Create Opening Review" over technical implementation
  language.
- Preserve confidence and safety around destructive actions. Deleting decks,
  deleting cards, changing trained moves, and overwriting saved data should
  require clear confirmation or obvious recovery affordances.
- Responsive behavior matters. Check board size, right-panel scroll behavior,
  tab labels, engine dock height, and table overflow on laptop and wide
  viewports.
- Use icons in compact tabs and action buttons, but provide hover labels or
  `aria-label`s so the UI remains discoverable.
- Do not add large explanatory cards inside already framed panels. Review,
  database, and analysis surfaces should feel like workspaces.

## Implementation Map

- `src/components/tabs/NewTabHome.tsx`: home launcher, recent files, online game
  picker entry points, Opening Review modal, Mistake Review modal, latest game
  shortcuts.
- `src/components/boards/BoardAnalysis.tsx`: main board workspace layout,
  right-side analysis tabs, annotation layout, engine dock integration.
- `src/components/boards/Board.tsx`: board input, review practice behavior,
  arrows, hover previews, visibility toggles, and board-played move overrides.
- `src/components/review/OpeningReviewWorkspace.tsx`: Opening Review and
  Mistake Review workspace, review panels, daily/full/focused practice,
  position list, stats, analyze view, auto-update banner integration.
- `src/components/panels/gaps/RepertoireGapsPanel.tsx`: Analyze Repertoire and
  opening health scanning UI.
- `src/components/panels/database/*`: Database and Database Compare panels,
  perspective controls, source options, games/openings tables.
- `src/components/panels/plan/PlanExplorerPanel.tsx`: database-backed plan
  explorer.
- `src/components/panels/enginePlan/EnginePlanExplorerPanel.tsx`: engine-backed
  plan explorer.
- `src/components/panels/structure/PawnStructurePanel.tsx`: current-position
  pawn structure card and full-game structure trajectory panel.
- `src/utils/pawnStructureDetector.ts`: all-28 pawn-skeleton detector,
  confidence scoring, colour reversal, file mirroring, evidence, and sibling
  disambiguation.
- `src/utils/pawnStructureTrajectory.ts`: main-line structure sampling,
  segment smoothing, primary/secondary scoring, transitions, and story
  generation.
- `src/components/panels/analysis/*`: local/cloud engine display and compact
  best-move rows.
- `src/components/common/OnlineGamePickerModal.tsx`: recent online game picker
  shared by latest-game analysis, online Opening Review, and online Mistake
  Review.
- `src/components/databases/AddDatabase.tsx`: database import modal, online
  account database import, merged database import, Lichess Study import.
- `src/utils/databaseFileExport.ts`: shared helpers for exporting PGN or `.db3`
  sources into Files folders with one game PGN plus metadata sidecar per game.
- `src/state/atoms.ts`: persisted source choices, auto-update state, review
  deck state, practice state, Plan Explorer state, compare selection state.
- `src/utils/tabs.ts`: tab types and game-origin routing for analysis, database
  games, Opening Review, and Mistake Review.
- `src/utils/openingReview*.ts`: review deck persistence, auto-update,
  position ranking, practice logic, opening names, filters, and compatibility.
- `src/utils/mistakeReview*.ts`: mistake deck creation, scanning, daily/phase
  practice, auto-update, and metadata.
- `src/utils/onlineGameImport.ts`: online database imports and update metadata.
- `src/utils/onlineLatestGame.ts`: linked provider selection and recent/latest
  game lookup.
- `src/utils/lichess/study.ts`: Lichess Study import and update metadata.
- `src/utils/practiceBot.ts` and `src/hooks/usePracticeAgainstBot.ts`: trainer
  bot setup, managed Maia/Stockfish selection, and game integration.
- `src-tauri/src/db/search.rs`: database search, occurrence lookup, repertoire
  gap search, recent sorting, and perspective-aware result data.
- `src-tauri/src/db/search_index.rs`: `.ecsi` index format and occurrence table
  serialization.
- `src-tauri/src/db/mod.rs`: database import, update, online/study metadata,
  PGN timestamp normalization, and backend commands.
- `src-tauri/src/chess.rs`: game metadata and review/mistake backend helpers.
- `src-tauri/src/engine/process.rs`: local engine process startup and
  contention fixes.
- `src-tauri/src/game.rs`: play/trainer bot engine game behavior and clock
  pacing.

## Recent Feature Inventory

This inventory covers the recent two-week session represented by git history
from 2026-04-24 through 2026-05-03.

- Analysis workspace: Compare, Database, Plan Explorer, Engine Plans, Info, and
  Practice were shaped into a board-centered workspace with responsive panels
  and docked engine output.
- Plan Explorer: database-backed plan extraction, local and online sources,
  route previews, pinned arrows, board piece hover shortcuts, auto arrows,
  caching, and large-database fallback speedups were added.
- Database search: exact position occurrence indexes, cancellable searches,
  large-index responsiveness, cache warming, recent move sorting, player
  perspective filters, and cloud-enhanced move rankings were added.
- Online data: Lichess/Chess.com imports, merged online databases, online game
  picker flows, latest-game analysis, selected-game review creation, and
  Lichess Study database import/update support were added.
- Online game clocks: imported online games now surface simple per-move think
  times in notation from clock or timestamp comments, board clocks sit with the
  player strips at the top-left and bottom-left of the board area, and older
  online databases are marked for clock-data enrichment during refresh. Direct
  Chess.com game-link imports also translate callback move timestamps into PGN
  clock comments so existing display and save paths keep the timing data. Move
  list think-time chips show tenths of a second when the source provides them.
  Move controls include live replay, which advances through timed games using
  the recorded think time for each next move from a labelled play/pause control,
  animates the active side's board clock during each replayed move, and shows a
  blue full-game progress bar with remaining replay time.
- Opening Review: Analyze Repertoire was moved into review, opening health
  scoring was added, cloud validation was layered in, review decks became
  trainable files, and daily/full/focused spaced repetition workflows were
  added.
- Mistake Review: mistake scanning, mistake decks, daily progress, phase
  training, reveal controls, engine dock support, online selected-game scans,
  auto-updates, and game metadata were added.
- Practice bot: puzzle/bot entry points, trainer settings, managed Maia,
  Stockfish fallback, FIDE-style strength selection, and clock pacing were
  added.
- Board and layout: resizable board/right-side layout, under-board annotations,
  tab tooltips, compact engine lines, annotation focus fixes, hover arrow
  previews, and responsive panel scaling were added.
- Review panel readability: Opening Review and Mistake Review right-side panels
  were tightened so primary actions, progress, sync status, and game evidence
  fit default laptop-height panels, with shorter visible tab labels, wrapping
  action text, and compact mistake-game moves access.
- Mistake Review moves panel: the expanded right-panel moves area now uses one
  larger notation rectangle with its PGN and display controls in the header,
  removing the detached eval strip and separate arrow navigation row.
- Mistake Review now opens the right-panel moves area by default so the game
  line remains visible during review; users can still collapse it when they
  need the extra vertical room.
- Persistence and compatibility: review deck file storage, old review-card
  compatibility, no-tab preview safety, stale index refresh, and PGN timestamp
  normalization were added.
- Local process guidance: Playwright/Tauri browser verification notes were
  documented.
- Performance pass: annotation changes now reuse notation/transposition derived
  data unless the move tree structure changes, review deck saves are delayed to
  idle time, large review files save more compactly, review deck summaries are
  cached by file mtime, trainer summary counts defer full-deck passes so the
  board and primary controls can paint first, and local engines stay warm
  longer with a startup watchdog.
- Engine responsiveness: board play with Stockfish enabled now keeps stale
  analysis requests from updating React, cancels superseded local searches, and
  avoids recomputing full move lines for engine arrows when the current board
  position is already known.
- Engine focus policy: when the app loses focus or becomes hidden, interactive
  board/plan/review engines are stopped and pending UI engine probes are
  cancelled, while intentional batch work such as Mistake Review scans,
  analysis reports, and opening-health engine verification keeps running.
- Review transition responsiveness: mistake/opening review now prewarms nearby
  card board states, defers SRS card writes until after the next card paints,
  and lets move-drop visuals paint before post-attempt feedback and cloud/engine
  assessment work begins.
- Opening trainer persistence: Opening Review attempts now become real board
  moves instead of temporary preview positions, so the attempted move stays on
  the board and annotations/variations created during gap training save back to
  the deck.
- Opening stats colour grouping now uses the source player's actual move side
  from the saved game position, so opponent-prep review-side inversions do not
  misclassify openings such as King's Gambit under the wrong colour.
- Opponent prep now seeds the player username field from the most common player
  counted across white/black game appearances in the selected local database,
  so single-player prep databases open ready to build without manual player
  search while still preserving manual edits and matching database-title casing
  where it refers to the same player.
- Opponent prep General mode now defaults to Lichess All when the user switches
  from player-specific prep, while still allowing another source to be chosen
  manually afterward.
- Launch reliability: the Windows fork launcher and `pnpm dev` fallback now
  serialize dev-session startup so repeated launches do not stop the Vite dev
  server while the Tauri WebView is still loading `localhost:1420`; clean
  single-instance exits are treated as an activation handoff instead of a broken
  binary. The launcher also self-heals missing `node_modules` by running
  `pnpm install --frozen-lockfile` before starting Vite or Tauri, so restored
  repo copies and moved worktrees can still launch from pinned shortcuts. The
  frontend updater package is explicitly declared so restored installs resolve
  the startup update-check import instead of opening Vite's missing-import
  overlay.
- Lichess login reliability: the OAuth callback server now binds a fresh
  localhost listener before opening the browser, then shuts it down after the
  callback, avoiding stale or racing localhost redirects.
- Files import ergonomics: the Files page now has an "Import database as files"
  action that accepts PGN, compressed PGN, or `.db3` sources, creates a named
  folder under the selected location, and writes each game as its own PGN plus
  the normal `.info` metadata sidecar.
- Analysis/database export ergonomics: analysis boards now expose a top-left
  app-bar Save game to files action near the File menu that saves a PGN copy
  from any analysis origin, and database settings can export an entire database
  into the Files root as a folder of individual game files.
- Opponent prep defaults: new Prep tabs now start with Min games set to 1 so
  even one-game opponent branches are visible by default.
- Opponent prep recency labels: Prep move rows now show relative last-played
  text such as "Last played 49 days ago" instead of only a raw game date, with
  the exact date still available on hover.
- Startup responsiveness: cached directory paths now let common route loaders
  paint immediately while the real paths refresh in the background. Major
  route and board workspace chunk loads show progress fallbacks instead of
  blank panes, and common feature chunks are warmed after first paint or
  sidebar hover so opening board, home, files, databases, engines, and settings
  feels much more immediate without blocking the app's initial open.
- Move-list game reports: the notation header now has an Analyse game action
  next to Copy PGN. It runs the selected local Stockfish on the main line,
  switches the move-list panel into a Lichess-style report with eval chart,
  phase markers, inaccuracies/mistakes/blunders, average centipawn loss, and
  Lichess-compatible accuracy, and saves the annotated PGN back to file or
  database origins so reopening an analysed game can rebuild the report without
  rerunning the engine.
- Move-list game report density was tightened so the chart and both players'
  accuracy rows fit the notation panel without routine vertical scrolling:
  smaller player markers, shorter stat rows, non-wrapping labels, and a shorter
  chart minimum keep the report readable in the board workspace.
- Review large-deck responsiveness: Opening Review and Mistake Review now use
  a prebuilt FEN index for active-position lookup, object-keyed cached board
  line states instead of recursive review-tree cache-key serialization, and
  deferred right-panel summary refreshes while practice is active so next-card
  transitions stay responsive on large decks.
- Review practice write buffering: per-card SRS updates are queued during an
  active Opening Review or Mistake Review session and flushed at stop,
  completion, lifecycle, or unmount boundaries instead of copying and saving
  the whole deck a couple seconds after every card. Nearby-card prewarming also
  stops after the first few queued indices instead of filtering the full
  remaining deck.
- Review engine quieting: the review workspace now keeps interactive engine
  analysis paused while a hidden-answer card is waiting on the Review tab, then
  re-enables it after reveal or when users open analysis-capable panels, so
  engine startup/search does not compete with next-card rendering.
- Board review attempt smoothness: the board no longer mutates the review deck
  just to mark a card seen immediately after an attempted move; durable progress
  flows through the buffered SRS update path. The active Mistake Review card is
  also retained in a ref instead of React state, removing an extra settling
  render on every card load.
- Mistake Review reveal countdowns now update at most once per displayed second
  and skip unchanged values, instead of waking the full board every 250ms during
  the common 2-3 second hidden-answer delay.

## Verification Expectations

Choose focused verification based on the touched surface.

- Frontend type/build check: `pnpm build-vite`.
- Frontend lint for touched files: `pnpm exec oxlint <files>`.
- Practice/review utility tests: `pnpm vitest run <test-file>` when available.
- Rust compile check: `cargo check` from `src-tauri` or the repo script used by
  the project.
- Database/search tests: `cargo test search_index`,
  `cargo test exact_matches`, and
  `cargo test exact_query_ignores_too_much_material_validation`.
- UI/layout verification: run the Vite app at `http://localhost:1420`, verify
  with Playwright, inspect real DOM dimensions as well as screenshots, and
  inject Tauri browser stubs if the app is opened outside the Tauri shell.
- Known historical note: an earlier full `cargo test` had unrelated existing
  failures in eval/search fixture expectations. Treat broad failures as
  suspicious, but verify whether they predate the current change before editing
  unrelated code.
