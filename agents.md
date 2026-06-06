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
  `docs/opponent-prep-agent-guide.md`. Whenever the user asks for chess prep
  for a player, opponent, event, congress, tournament, entrant list, or rating
  threshold, read and follow that guide as the workflow source of truth before
  gathering games or creating prep databases. It records the required
  per-player folder/database workflow, mandatory online-source checks for every
  player, default subagent team coordination for hard web searches and
  comprehensive Chess.com account-link research, including club-member and
  rating-plausibility checks, Lichess broadcast PGN extraction pattern,
  mandatory full public Lichess broadcast database filtering, Chess-Results PGN
  search by FIDE ID, Chess.com account-confidence method, low-count second-pass
  checks, final-response count and most-recent-game reporting expectations,
  dedupe rules, and En Croissant verification steps. The Oxford U2300 prep
  showed why agents must finish the full exhaustive source checklist for one
  player before moving to the next instead of doing a shallow global pass.
- Before declaring opponent prep finished, run a canonical player-name audit on
  every prep target in both the per-player PGNs and the matching En Croissant
  `.db3` databases. Check for split identities caused by the same player being
  tagged in both `Surname, Firstname` and `Firstname Surname` order, including
  combined PGNs, archived/source PGNs, app-side source PGNs, and `Players` rows
  referenced by `Games.WhiteID`/`Games.BlackID`. If a split is found, normalize
  the PGN `White`/`Black` tags and generated game titles to the folder/database
  canonical form, merge duplicate database player rows into the canonical row,
  clear any stale search indexes for the changed database, and re-run the audit
  until there are zero remaining target-name splits. The Oxford U2300 cleanup
  examples were `Josh Sharma` -> `Sharma, Josh`, `Peter G Large` ->
  `Large, Peter G`, `Arya Cont` -> `Cont, Arya`, `Adam Sieczkowski` ->
  `Sieczkowski, Adam`, and `Anum Sheikh` -> `Sheikh, Anum`.
- On 2026-05-31, a quick single-player prep refresh was completed for
  `Mesropyan, Hayk` (FIDE 499455). The existing Oxford prep folder was reused,
  TWIC and ChessArchive second-pass games were merged where they added unique
  movetext, malformed ChessArchive scrape rows were pruned, and the app-side
  database was rebuilt from the Files-side PGN. Final verification showed 241
  source PGN games, 240 converted `.db3` games, latest known game date
  `2026.05.09`, and a clean canonical target-name audit with only
  `Mesropyan, Hayk` in both PGN tags and database player rows.

## Local Browser Verification

- Do not run Playwright or other browser automation for local UI checks unless
  the user explicitly asks for Playwright/browser verification in the prompt.
  Default verification should be typecheck, lint, unit tests, focused Rust
  tests, and code inspection.
- The Vite dev server for this Tauri app normally serves at
  `http://localhost:1420`; `vite.config.ts` has `strictPort: true`, so check
  whether that port is already owned before starting a new server, but do not
  start it just for browser testing unless the user asked for that verification.
- Do not open the Vite app directly in the Codex in-app browser and try to patch
  in minimal Tauri globals. That path is brittle and previously failed because
  browser-loaded Tauri modules read `window.__TAURI_INTERNALS__.metadata` before
  the app had a real Tauri WebView environment, producing errors such as
  `Cannot read properties of undefined (reading 'metadata')`.
- If the user explicitly asks for Playwright/browser UI verification, document
  the exact harness used. Prefer testing against the real Tauri shell when
  possible; if using the Vite page outside Tauri, treat any stubbed Tauri API as
  a limited smoke-test harness, not product-equivalent verification.
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

### Web Companion

- On 2026-06-03, a first browser/PWA MVP was added for phone access without
  Tauri. `src/index.tsx` now runtime-splits startup: real Tauri WebViews load
  the existing desktop app, while plain browsers load `src/web/WebApp.tsx`.
  The web companion is intentionally prep-first and excludes Opening/Mistake
  Review decks for now. It imports PGN files through the browser file picker,
  stores indexed data in IndexedDB, treats those PGNs as browser-side
  databases, provides Files and Databases views for browsing games/player
  summaries/exporting PGNs, and creates saved opponent-prep workspaces with a
  mobile Chessground board, notes, line navigation, practical move stats, and
  prepared/open row state. It does not read desktop `.db3` files directly yet;
  future phone sync should bridge desktop databases or linked Files PGNs into
  this browser-side model rather than reintroducing Tauri-only imports.
- The web MVP also adds `public/manifest.webmanifest` and `public/web-sw.js`
  so static hosting builds can be installed as a lightweight PWA. Keep the
  browser entry free of eager `@tauri-apps/*` imports; browser deployment
  depends on the desktop app remaining behind the dynamic Tauri-runtime import.
- Also on 2026-06-03, the phone web MVP was reshaped around a board-first
  workspace. The primary phone screen is now a Chessground board with a compact
  under-board `Moves / Database / Prep` segmented panel, matching the desktop
  analysis under-board model rather than separate deck-style pages. Moves
  navigates the active line, Database shows browser-indexed PGN move stats from
  the current FEN, and Prep creates/selects opponent workspaces with notes,
  prepared/open move state, and the same compact move table.
- Anywhere phone file access should use a hosted static library rather than a
  laptop-dependent bridge. `scripts/build-web-library.mjs` mirrors PGN/PDF files
  from `Documents/EnCroissant` or `EN_CROISSANT_WEB_FILES_DIR` into ignored
  `public/web-library` assets and writes a manifest consumed by
  `src/web/hostedFiles.ts`. Running `npm run web:library` before a static
  deployment lets the phone browse Hosted files and load PGNs/PDFs from the
  published site while the laptop is off. Do not reintroduce a local
  filesystem bridge as the phone product path; it makes phone access depend on
  the laptop being awake and can expose local files on a development network.
- On 2026-06-03, local auto-sync was added for the phone site. `npm run
  web:publish` runs `scripts/publish-web-site.ps1`, regenerating the hosted
  library, building Vite, mirroring `dist` into the `loxtyrrell03.github.io`
  Pages checkout under `%LOCALAPPDATA%/EnCroissantWebSync`, committing, and
  pushing only when there are real staged changes. `npm run web:install-sync`
  registers the per-user Windows task `\EnCroissant\EnCroissantWebAutoSync`,
  which runs `scripts/watch-web-sync.ps1` at logon, watches
  `Documents/EnCroissant` plus the app/fork database directories, debounces
  PGN/PDF/DB changes, and performs periodic safety syncs. Logs live in
  `%LOCALAPPDATA%/EnCroissantWebSync`. Raw `.db3` changes can trigger a sync,
  but phone-usable database content still needs to be represented as linked or
  exported PGN files in the hosted Files library. The hosted library manifest
  preserves its previous `generatedAt` value when file paths, sizes, mtimes, and
  URLs are unchanged, so periodic safety syncs remain no-op publishes instead of
  creating timestamp-only Pages commits.
- Also on 2026-06-03, auto-sync began publishing eligible local `.db3`
  databases as generated PGN chunk folders under Hosted files `Databases/...`.
  `src-tauri/src/bin/export_db_to_pgn.rs` is a headless Rust exporter that
  reuses the fork's move-blob decoder, while `scripts/build-web-library.mjs`
  caches exports under `%LOCALAPPDATA%/EnCroissantWebSync/db-exports` and
  includes cached chunks in the static web library. On 2026-06-04, the default
  database export root was narrowed to the desktop app-data database directory
  resolved from `src-tauri/tauri.conf.json`; this keeps the phone picker from
  showing extra databases from multiple local app roots. Use
  `EN_CROISSANT_WEB_DATABASE_DIR` for one custom root or
  `EN_CROISSANT_WEB_DATABASE_DIRS` for an intentional multi-root publish. The
  Rust package must keep `default-run = "en-croissant-fork"` because the
  additional `export_db_to_pgn` binary otherwise makes `tauri dev` fail at
  startup when Cargo cannot infer which binary to run. The
  Database and Prep source pickers also filter previously indexed hosted
  databases once the current hosted manifest is loaded, so stale phone IndexedDB
  imports from an older multi-root publish do not remain selectable after the
  site is narrowed back to the desktop source. The
  publish/watch/install scripts expose `-MaxDatabaseMB` (default 200 MB) plus
  `-SkipDatabaseExports`; this keeps normal prep/account/repertoire databases
  available on the phone while deliberately skipping huge reference databases
  such as 2.7 GB Mega Database copies that are not practical for free static
  hosting. Phone users can import a generated database by opening Hosted files,
  browsing to `Databases/Desktop/...` for the default desktop app-data root,
  and importing the database folder.
- The web Prep panel now owns its database/import workflow instead of forcing a
  detour to Files. Its compact under-board Prep area has Databases, Hosted
  files, and Import games drawers: database source selection attaches indexed
  PGNs to the active prep, Hosted files can load PGNs/PDFs from the published
  web library, and Import games fetches public Lichess or Chess.com games by
  username with most-recent and date-range modes. Imports created from Prep are
  immediately used as prep sources when the prep has an explicit source list.
- The web Database panel now mirrors the fork's source model more closely:
  Local, Lichess All, and Lichess Masters are explicit under-board sources.
  Local uses browser-indexed databases and can import any hosted PGN folder as
  a single local database from the published laptop library. Prep uses the same
  hosted-folder import path, so exported local database folders can be selected
  and attached without leaving Prep. Lichess All/Masters use a browser PKCE
  Lichess sign-in flow and store the access token in phone localStorage; direct
  anonymous explorer requests return 401, so do not remove authentication.
  Desktop `.db3` move blobs are not decoded in the browser; publish linked
  Files/PGN exports for phone-accessible local database functionality.
- On 2026-06-04, the phone Database under-board header gained the desktop-style
  Stats sort menu plus a `Matches` count for Stats and Games views. The sort
  choice persists in browser storage and orders browser-indexed local stats and
  Lichess explorer stats by most/fewest played, recent/oldest, score, or move,
  making it easier to tell which source actually loaded on the phone.
- A follow-up on 2026-06-03 made synced database folders first-class, single
  choices in the phone Database and Prep source pickers. Generated hosted
  database folders under `Databases/...` now appear beside already indexed
  browser databases, import on selection without loading their first game onto
  the board, and are de-duplicated by hosted path/update timestamp. These
  pickers intentionally use one active database at a time, matching the fork's
  database comparison model; do not turn them back into multi-select controls.
  Hosted Files folder import is limited to folders with direct PGNs so broad
  parents such as `Databases` are browsed instead of accidentally imported. The
  Lichess token state is hoisted to the web app shell so OAuth completion and
  the token field share one persisted localStorage value.
- On 2026-06-04, phone Prep was tightened to match the desktop under-board Prep
  root workflow. Starting prep from setup now records the current board line as
  `rootPly`, the training header renders `Start: <line>` instead of always
  `game start`, and Common move / Done + next cycle the same opponent branch
  start that the fork uses rather than querying a simplified current-position
  or game-start-only flow. The phone Prep source picker still remains a single
  database/explorer choice and includes local synced folders plus Online /
  Lichess All / Lichess Masters with saved-token reuse.
- Also on 2026-06-04, phone Prep branch detection became cursor-aware, matching
  the desktop under-board panel when the user is preparing as White from the
  game start. After the user plays their first move, Common move now roots at
  the opponent-to-move position, Done + next marks the actual opponent branch,
  and the training header says `Away from prep start` when the board cursor is
  before the saved prep root instead of silently treating that position as the
  active prep branch.
- The phone Prep move table now uses desktop-style branch coverage in the
  `Prep` column. For browser-indexed local or temporary prep sources it scores
  the saved continuation below an opponent move, counts common replies from the
  same prep database, and labels the branch as `No line`, `Thin`, `Needs work`,
  `Solid`, or `Good`; online explorer sources still show saved-line depth but
  cannot yet fan out async multi-position explorer coverage in the browser.
- Also on 2026-06-04, phone synced-database loading was hardened so hosted
  database folders behave more like desktop database files. Re-importing a
  hosted database now replaces the older phone IndexedDB copy with the same
  hosted path, rewires Prep source IDs and board game origins to the fresh
  database, and removes stale duplicate loaded entries. Database and Prep
  selected local sources auto-refresh when the published folder is newer than
  the indexed copy, or when metadata exists but the games are missing; picker
  rows label newer hosted folders as `Update available` instead of implying the
  stale copy is current.
- A later 2026-06-03 Prep parity pass replaced the phone Prep setup with the
  fork's visible setup model: header badges, Player/General target mode,
  folder-aware `Prep source` picker with an Online group for Lichess All and
  Lichess Masters, player/opponent colour controls, general `I'm white`/`I'm
  black`, Min games, Show top, and the online import drawer's Save database,
  Check range, range/count, and Import + use controls. Local prep stats now
  respect Player versus General filtering plus Min games/Show top. Lichess
  All/Masters prep sources use the persisted web Lichess token and the web
  explorer helper.
- On 2026-06-04, the phone Prep online import flow gained a prep-only
  temporary source path for Save database off. Public Lichess/Chess.com games
  imported from the Prep drawer can now be attached to the draft or active prep
  as an unsaved `Current prep` source, remain a single selected source in the
  same folder-aware picker, feed the normal prep move table, and stay out of
  the browser database list. Save database on still creates a normal
  browser-side database and attaches that one source to Prep.
- The same pass added phone active-prep workflow buttons matching the desktop
  under-board training stage: `Common move` plays the first open common row
  from the current prep table, while `Done + next` marks that row prepared and
  advances to the next open shown move. These controls intentionally operate on
  the currently selected single prep source and reuse the phone move table's
  Min games/Show top filtering.
- A 2026-06-04 follow-up made phone database source selection less confusing:
  the under-board Database panel now persists its selected source and local
  database in localStorage, and both Database and Prep show explicit loading
  text while a generated hosted database folder is being imported from synced
  files. This keeps the phone UI closer to the fork's remembered source model
  and avoids the appearance that selecting a large hosted database did nothing.
- A later 2026-06-04 phone Prep parity pass made the web Prep tab use the
  desktop under-board Prep shape more directly. Prep now has a setup stage with
  `Start prep`, then a training stage with `Common move`, `Done + next`, and a
  settings icon back to setup. Existing active prep workspaces reopen in the
  training stage after reload. Candidate-reply rows use the fork-style
  `Move / Strength / Games / WDL` table, while opponent-move rows use
  `Move / Strength / Games / Results / Prep / State`, sortable headers, Done
  and Skip actions, and local/temporary source `Go to game` evidence jumps.
  Browser-side prep workspaces now persist skipped move keys separately from
  prepared move keys.
- Another 2026-06-04 phone parity pass made the shared database picker more
  phone-friendly without changing the one-database source model. Database and
  Prep source pickers now include a search box when folders or many choices are
  present, show folder rows as drill-down entries, and show source row details
  such as `Loaded - 1,588 games - 1.1 MB`, `Not loaded - 1 PGN - 1.1 MB`, or
  `Explorer - saved token reused`. Selecting a generated hosted database still
  imports exactly one synced database folder, then replaces the active local or
  prep source with that one database.
- A subsequent 2026-06-04 phone Prep parity pass added the desktop under-board
  `Strength settings` control to the phone setup row. Web prep workspaces now
  persist a `builder` strength-settings slice, and browser-side prep move
  strength uses that mode/engine-blend/max-CP-drop configuration while keeping
  cloud engine disabled on the phone path until a browser-safe cloud-eval flow
  is added.
- A further 2026-06-04 phone Prep parity pass aligned the source/target state
  machine with the desktop fork. Choosing Lichess All or Lichess Masters from
  the phone `Prep source` picker now forces General/Opening prep, clears the
  player-only target fields, and keeps the saved-token Lichess controls in
  view. Switching back to Player mode from an online explorer source now
  returns to one local synced database source, mirroring the desktop
  under-board Prep panel instead of allowing a confusing `Player + Lichess`
  combination.
- A follow-up 2026-06-04 phone Prep cleanup made prep titles derive from the
  actual mode/opponent state instead of trusting stale saved workspace names.
  Old browser-side prep workspaces that were previously named `General prep`
  but are now in Player/local mode render as `Opponent prep` or
  `<player> prep` in the board title and setup picker, keeping the phone header,
  active prep selector, Player/General segment, and one selected source in sync.
- A later 2026-06-04 phone Database parity pass added the desktop-style local
  perspective controls to the under-board Database panel. Local browser
  databases now have a persisted Username field with White/Black, relabeled to
  `As white`/`As black` when a player is entered, and move stats filter to that
  single player's color instead of treating the selected database as an
  unscoped all-games source. Empty states name the exact filtered source, such
  as `lachlan1415 as black in lachlan1415_lichess.pgn`, so the phone UI stays
  aligned with the fork's one-database, one-perspective model.
- The next 2026-06-04 phone Prep parity pass split active-prep setup actions
  the way the fork does. Reopening setup for an existing phone prep now shows
  `Start prep`, explicit `Start here`, reset-to-prep-start, and clear
  done/skipped controls. `Start prep` no longer silently moves the prep root to
  the current board position or clears marks; changing the root is only done by
  `Start here`, preserving the fork's explicit root workflow on mobile.
- A later 2026-06-04 phone explorer parity pass added saved Lichess All and
  Lichess Masters filter controls shared by the phone Database and Prep panels.
  Lichess All now exposes time controls, average rating buckets, since/until
  months, player username plus color, and move count; player filters query the
  Lichess `/player` explorer endpoint just like the desktop fork instead of
  the generic all-games endpoint. Lichess Masters exposes since/until years and
  move count. These options persist in phone localStorage and are passed to
  both Database and Prep explorer requests, so the same online source behaves
  consistently across the phone app.
- A follow-up 2026-06-04 phone source-picker parity pass made hosted synced
  databases behave like normal one-at-a-time database sources in the Database
  and Prep tabs. Selecting a hosted database first checks the web manifest
  against the already indexed phone IndexedDB copy and immediately reuses it
  when current, instead of downloading PGN chunks again. Only new, stale, or
  missing indexed databases run the hosted PGN import path, and those real
  imports now show `loaded / total PGNs` progress so large synced prep
  databases are visibly loading rather than appearing stuck.
- A later 2026-06-04 hosted-database performance pass added static
  per-position indexes for generated `.db3` web exports. The Rust
  `export_db_to_pgn` helper now writes a `position-index` folder beside each
  exported database, sharded by normalized FEN and capped by
  `EN_CROISSANT_WEB_DB_INDEX_MAX_PLY` (default 80). The phone Database and Prep
  panels create lightweight hosted database records from that manifest and
  lazy-load only the current board position, including blended-strength cloud
  enhancement, instead of downloading and parsing every PGN chunk into
  IndexedDB. Lazy hosted sources intentionally do not expose full source-game
  samples or whole-database player/date filters until a separate lazy sample
  endpoint exists.
- The next 2026-06-04 source-picker cleanup removed the extra under-board
  `Browse`/`Hosted files` database route from the phone Database and Prep
  panels. Those panels now mirror the desktop fork more closely: database
  selection happens through the single `Local database` or `Prep source`
  picker, while hosted PGN/PDF browsing remains in the Files surface. The
  shared picker still drills into synced folders and can load not-yet-indexed
  hosted databases, so no database access was lost.
- A follow-up 2026-06-04 picker-state fix made `DatabaseFolderSelect` reset its
  active folder and search query whenever the popover opens or closes. This
  prevents the phone Database/Prep selector from reopening inside a stale
  folder after the user previously drilled into another database group, which
  had made the selected source label and visible database list feel mismatched
  or improperly loaded.
- The selected database's containing folder row in `DatabaseFolderSelect` now
  reads `Open current folder` instead of `Selected folder`. This keeps the
  shortcut to drill into the current database folder while avoiding the
  misleading impression that a folder, rather than exactly one database, is the
  active Database or Prep source.
- Phone Prep setup now mirrors the fork's under-board source/player controls
  more closely. The Prep and Database phone panels share a web-native
  Username plus player-color selector, local prep database labels such as
  `_lichess` seed the obvious player name, Start prep is blocked until the
  source and target are ready, and Prep setup choices persist in browser
  storage alongside the saved Lichess token and explorer filters.
- Phone Database and Prep local source choices now persist by stable hosted
  database path when a database comes from synced fork files, with old raw
  browser database ids still accepted for compatibility. This prevents a
  refreshed/reloaded hosted database from losing the selected source and
  falling through to an unrelated first database. Local Prep also treats an
  empty source list as no source instead of silently querying every indexed
  browser database.
- On 2026-06-04, a phone-only saved-prep workspace selector was removed from
  the Prep setup row because it did not exist in the fork's under-board Prep UI
  and made source selection look like a second, useless database/prep picker.
  Phone Prep setup should lead with the fork-style Player/General target,
  single Prep source picker, import drawer, and strength/builder controls.
- The 2026-06-04 phone Database/Prep parity pass added the fork's local
  date/result filters to both under-board panels. Database and Prep now search
  the selected local source through the same player/color, From, To, and Result
  scope shown in the UI, active preps with an empty local source no longer fall
  back to the first database, changing local prep databases clears stale
  opponent names so the new database can seed its own player, and saved Lichess
  access renders as `Lichess saved` with Relink/Forget controls instead of
  asking for sign-in on every Lichess All/Masters use.
- A follow-up 2026-06-04 phone Database parity pass added the fork-style
  `Stats / Games / Options` subview inside the under-board Database panel.
  Local databases now expose source-game samples for the current FEN through
  the same selected database, username/color, date, and result filters used by
  move stats, while local filters live in Options and online explorer options
  remain under the same subview.
- A later 2026-06-04 phone Prep parity pass added the remaining desktop
  under-board active-branch controls to the phone training header. When the
  current line has an active local or temporary source branch, phone Prep now
  shows the same header-level `Go to game` evidence jump plus the return arrow
  to the last opponent choice, and `Done + next` uses that shared active-branch
  selection including roots where the opponent is to move.
- The same pass made the phone Prep import drawer follow the desktop
  under-board layout: opening `Import games` collapses the normal prep
  source/player/min-games controls so the online source, username, range, save,
  preview, and import controls are the focused setup surface.
- A subsequent 2026-06-04 phone Prep parity pass added the fork's compact
  builder/sort settings row to the web Prep setup. Phone Prep now persists
  desktop-style move-sort defaults with saved setup and active prep workspaces,
  exposes Smart/Engine/Practical, Source/Their move sort, Your move sort,
  Engine blend, and Max CP drop controls in setup, and resets the visible
  opponent/candidate prep tables from those defaults when the workspace or
  defaults change.
- A 2026-06-04 phone layout fix made the under-board `Moves / Database / Prep`
  switch responsive. On narrow phone widths the header now puts the switch on
  its own full-width row with equal segments, so the `Prep` segment stays
  visible and tappable instead of being clipped by the FEN/title text.
- A later 2026-06-04 phone Database/Prep strength parity pass wired the web
  move tables into the fork's blended strength model. Local Database stats and
  Lichess All/Masters explorer rows now compute practical/blended strength,
  Database has saved Smart/Engine/Practical strength settings plus strength,
  engine, and WDL sort choices, and the phone Database table exposes
  `Blend / Engine / Games / WDL / Last` while Prep strength cells show the same
  engine and practical WDL details inline.
- A follow-up fixed the phone blended-strength engine signal. The web companion
  now uses a browser-safe Lichess cloud-eval helper instead of the desktop
  Tauri API, keeps cloud scoring enabled for legacy phone workspaces that had
  saved the old disabled value, and refreshes local Database/Prep rows plus
  Lichess All/Masters explorer rows with cloud engine moves. The helper first
  uses root MultiPV and then queries child positions for shown candidate moves
  not present in the root cloud lines, so common non-top moves no longer
  collapse to `Engine unavailable` when Lichess has cached analysis.
- The practical/blended strength benchmark now ignores one- and two-game WDL
  spikes unless they have meaningful position share. Tiny perfect-score rows
  can still display their own result, but they no longer define the `best WDL`
  baseline and crush common engine-good moves such as `c4`/`Nf3` to `0%`.

### App Shell

- `/home` is now the task launcher. It opens recent files, imports games,
  starts puzzles, opens the latest online game, launches the online game picker,
  manages Opening Review decks, and manages Mistake Review decks.
- `/files` remains the file and repertoire library. Recent work improved root
  drag behavior, deselection, file-preview safety when no board tab exists,
  right-click rename actions for files and folders in the tree, and a folder
  import/export flow that splits a PGN or `.db3` database into one game file per
  game.
- On 2026-06-06, a source-derived White repertoire file was added under the
  app Files root's `Documents/EnCroissant/General repertoire/White  rep`
  folder as `Keymer Variation - Mendonca video.pgn`, with the matching `.info`
  sidecar marking it as a repertoire. It extracts the key 1.Nf3 d5 2.e3 Keymer
  Variation lessons from the ChessBase India video with GM Leon Mendonca:
  c6/Semi-Slav move orders, e6/Tarrasch and Queen's Indian structures, early c5
  systems, recurring cxd5/d4 decisions, Rg1-g4 kingside plans, and Ne2-g3
  manoeuvres.
- On 2026-06-06, the first weak-openings GM-video lesson file was added beside
  the existing weak deck at `Documents/EnCroissant/Weak openings training/black`
  as `Catalan - GM Neiksans Boot Camp.pgn`, with a repertoire `.info` sidecar.
  It is transcript-derived from GM Arturs Neiksans' long Catalan boot camp and
  focuses on Black's Catalan perspective: the value of `...Bb4+`, why `...c6`
  should usually precede `...b6`, when not to overvalue the c4 pawn, and the
  sharper `...Bd6` setup. Continue the remaining weak-opening video-derived
  lesson files one opening at a time in the same folder as each source weak
  PGN, without overwriting the original weak-opening decks.
- On 2026-06-06, the next weak-openings GM-video lesson file was added in the
  same Black weak folder as `Italian Game - GM Giri and Perunovic Lessons.pgn`,
  with a repertoire `.info` sidecar. It uses transcript-derived notes from GM
  Anish Giri's long Italian class for the quiet Italian `d3/c3/h3` structures,
  `...h6/...g5`, `...a6/...Ba7`, and central-break timing, plus GM Miodrag
  Perunovic's Scotch Gambit lesson for the `...Nf6`, tempo `...d5`, and
  Max-Lange-adjacent defensive themes that appear repeatedly in the weak deck.
  The user asked not to spend much time on the Center Game because it rarely
  appears; keep that file lightweight. When the weak-openings workflow reaches
  `Documents/EnCroissant/Weak openings training/whites/Grunfeld Defense.pgn`,
  prioritize the White line with `h3` after Black plays `...c5` instead of only
  covering the more common `Be3` mainline.
- Also on 2026-06-06, a Black Queen's Gambit weak-openings lesson file was
  added as `Queens Gambit - GM Finegold and Neiksans Lessons.pgn`, with a
  repertoire `.info` sidecar. It is built from GM Ben Finegold's Black-side
  Queen's Gambit Declined lecture and GM Arturs Neiksans' 2026 QGD Exchange
  boot camp, covering the weak deck's Exchange structures with `...c6`,
  `...h6`, `...Be7`, `...Re8`, and `...Nbd7`, the `Bf4`/`...Nbd7` branch,
  when `...Bf5` solves Black's light-square bishop problem, the g3 Orthodox
  setup, and the Tartakower `...b6/...dxc4` reminder.
- Also on 2026-06-06, a Black Ruy Lopez weak-openings lesson file was added as
  `Ruy Lopez - GM Seirawan Berlin Lesson.pgn`, with a repertoire `.info`
  sidecar. It is transcript-derived from GM Yasser Seirawan's Saint Louis
  Chess Club Berlin Defence lecture and maps the weak deck's Berlin focus:
  the queen-trade endgame after `4.O-O Nxe4 5.d4`, the `8.Qe2 Nd4` branch,
  `...Kxd8/...Ke8/...Kc8` king routes, `...h6/...h5` restraint of White's
  kingside majority, Rio-style `5.Re1 Nd6` lines, and anti-Berlin systems such
  as early `Bxc6`, `d3`, `d4`, and `Qe2`.
- Also on 2026-06-06, the Center Game weak-opening gap was intentionally kept
  lightweight because the user rarely sees it. `Center Game - GM Naroditsky
  Lightweight Lesson.pgn` was added beside the Black weak deck with a
  repertoire `.info` sidecar. It uses GM Daniel Naroditsky's Center Game
  masterclass transcript mainly to capture the tactical warning about White's
  `Bc4`/f7 activity in related Center/Danish positions, then maps the exact
  weak-deck branch `1.e4 e5 2.d4 exd4 3.Qxd4 Nc6 4.Qd1 Nf6` to practical Black
  development: `...Bb4+` or `...Bb4`, fast castling, and timely `...d5`.
- Also on 2026-06-06, the Black Scotch weak-opening lesson file was added as
  `Scotch Game - GM Finegold and Perunovic Lessons.pgn`, with a repertoire
  `.info` sidecar. It combines GM Ben Finegold's exact Black-side Scotch Mieses
  lecture with the already downloaded GM Miodrag Perunovic Scotch Gambit
  transcript. The file covers the weak deck's Mieses branch through
  `4...Nf6 5.Nxc6 bxc6 6.e5 Qe7 7.Qe2 Nd5 8.c4 Nb6`, including `...Ba6`
  pins, `...O-O-O`, `...Re8`, and `...d5`, and the Scotch Gambit
  `4.Bc4 Nf6 5.Ng5 d5 6.exd5 Na5` branch, including Perunovic's warning about
  premature `...Nxd5`, the useful `...Qe7+` precision, `...c6`, `...h6`, and
  completing development.
- Also on 2026-06-06, the White Grunfeld weak-opening lesson file was added as
  `Grunfeld Defense - GM Svidler Naroditsky h3 Lesson.pgn`, with a repertoire
  `.info` sidecar. This deliberately follows the user's later request to cover
  the Exchange/Kramnik `8.h3` line after Black's `...c5`, rather than making
  the common `Be3/Qd2/Rc1` branch the main lesson. It uses GM Peter Svidler and
  GM Daniel Naroditsky Grunfeld video transcripts for the dynamic `...c5`
  center-attack themes, plus GM Neil McDonald's ChessPublishing h3 notes for
  the exact tabiya. The file teaches White to use `h3` to stop the easy
  `...Bg4` pin, continue with `Be2`, watch for Black's critical `...Bf5`
  equalizer, and treat the old `Be3` weak-deck line only as a secondary bridge.
- Also on 2026-06-06, the White Queen's Gambit weak-opening lesson file was
  added as `Queens Gambit - GM Naroditsky Colovic Lessons.pgn`, with a
  repertoire `.info` sidecar. It combines GM Daniel Naroditsky's Queen's Gambit
  and Queen's Gambit Accepted masterclass transcripts with GM Alex Colovic's QGD
  lecture. The file covers the weak deck's Harrwitz `Bf4/Bd3` development,
  `...c5` exchange structures, Baltic/Pseudo-Slav `Qb3/c5/Bf4/Nh4`, the
  `Bg5 h6 Bh4` branch, and QGA recovery plans including the IQP after
  `...cxd4/exd4` plus `a4` against `...a6`.
- Also on 2026-06-06, the White Sicilian weak-opening lesson file was added as
  `Sicilian Defense - GM Naroditsky Open Sicilian Lessons.pgn`, with a
  repertoire `.info` sidecar. It uses GM Daniel Naroditsky Open Sicilian,
  Accelerated Dragon, Najdorf, and Dragon transcripts, grouping the 25 weak
  Sicilian positions into e6/Kan/Taimanov `Bd3` structures, `Nc3/Bc4` Open
  Sicilians, Four Knights/Sveshnikov `Nxc6/e5/Bg5` reminders, Maroczy Bind
  `c4/Be3/Qd2` setups, Najdorf English Attack `Be3/f3/Qd2/O-O-O`, calmer
  Dragon `Be2` lines, and the Marshall Counterattack reminder.
- Also on 2026-06-06, the White Slav weak-opening lesson file was added as
  `Slav Defense - GM Naroditsky Finegold Lessons.pgn`, with a repertoire
  `.info` sidecar. It uses GM Daniel Naroditsky's Slav speedrun transcript plus
  GM Ben Finegold's Chebanenko clip, covering the weak deck's Schlechter
  `...g6/Bg5` branch, quiet `e3/Nc3/Nh4` against `...Bf5`, classical
  `dxc4/a4/Bxc4` and `Ne5/Nxc4` recovery plans, the Geller `e4 b5 a4`
  undermining idea, and Chebanenko `...a6` Advance `c5/Bf4` with the `a4`
  reminder.
- Also on 2026-06-06, the White Zukertort weak-opening lesson file was added
  as `Zukertort Opening - GM Finegold Reti Lesson.pgn`, with a repertoire
  `.info` sidecar. It uses GM Ben Finegold's long Reti lecture transcript as
  the main source and treats the deck as a 1.Nf3 transposition map rather than
  one narrow opening: pure Reti `2.c4` ideas, Catalan/QGD and Slav move-orders
  from `2.d4`, KID/Pirc/Old Indian structures after `...d6/...g6`, compact
  Dutch fixes with `Bf4/e3/c4` or `g3`, queenside fianchetto `...b6` setups,
  and odd `...c6`, `...Nc6`, `...Bf5`, and `...c5` leftovers.
- Files also treats `.pdf` prep reports as first-class folder entries: selecting
  a PDF shows an in-app document preview with a system-viewer fallback, while
  PGN-only metadata, sidecar `.info`, and game-opening actions stay scoped to
  chess files.
- Files directory scans load PGN metadata first and defer exact game counts
  until a file is selected or opened, so large linked database folders do not
  hold the whole file tree on "Loading files...".
- The Files tree now lazy-loads folder children: `/files` renders the root
  first, each folder reads its children when expanded, and global search/filter
  triggers a full background load only when that all-folder view is needed.
- Files tree rows sort newest-first by PGN modified time, with name as a stable
  fallback when timestamps match, so newly added game files appear at the top.
- Files and folders can be pinned from the Files tree context menu. Pinned
  entries persist, show a pin marker, stay above normal newest-first rows, and
  follow rename or move operations by path.
- Files and folders can be archived from the Files tree context menu. Archiving
  is stored as persisted path state rather than a filesystem move. Archived
  entries are hidden from the normal file-type pills, the toolbar has an
  Archived pill for reviewing them, and archived paths follow rename, delete,
  and drag/move repairs like pinned entries.
- The Files toolbar includes a persistent sort menu for newest first, oldest
  first, name A-Z/Z-A, and type; pinned entries remain grouped above the chosen
  sort order.
- The Files toolbar also includes Manual order. Dragging a row near the top or
  bottom edge of a sibling row saves a custom order for that folder, while
  dragging onto the middle of a folder keeps the existing move-into-folder
  behavior.
- Files directory scans hide generated `report-render`, `report-render-pdf`,
  `report-print-pages`, and `source-pgns` artifact folders so report workspaces
  and archived source PGNs do not clutter the library while the actual PDF
  report and combined game PGNs stay visible.
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
- The under-board move-list top row has a compact focus toggle that hides or
  restores the board eval bar together with move-quality annotations such as
  good moves, mistakes, blunders, eval scores, and short verdict comments like
  "Bxf4 is a mistake" while preserving normal written comments. The existing
  comments button remains the separate control for hiding or showing ordinary
  notes.
- Board move-quality bubbles are aligned using the actual eval-rail width plus
  board gap in pixels, not a rem-based approximation, so their square-relative
  placement stays stable when board or font sizing changes.
- Prep move tables support clickable, keyboard-accessible column headers for
  local sorting, matching the Database tab expectation: Move, Games, Results,
  Prep, and State in opponent-move mode, and Move, Games, and WDL in candidate
  reply mode.
- Under-board Prep stays more compact than the right-side Prep panel: it forces
  dense controls/tables and replaces the large off-start blue alert with a
  one-line status so the move table remains the primary content.
- Engine output is docked into the active panel where possible and hidden when
  disabled.
- Board tab labels use icon-first compact tabs with hover tooltips.
- Arrow keys move through notation unless a modifier is held.

### Analysis And Engine Surfaces

- Analysis uses local engines, ChessDB, and Lichess Cloud where available.
- Lichess Cloud evals are integrated into analysis and local-engine fallback.
- Local Stockfish starts promptly while cloud checks run in parallel.
- On 2026-06-06, `scripts/generate-stockfish-opening-games.py` was added as a
  local utility for producing En Croissant Files-library PGNs from fixed
  opening positions using Stockfish 18 against Stockfish 11. It writes one
  multi-game PGN per opening under `Documents/EnCroissant/Stockfish 18 games`,
  tags the fixed line and learning side in PGN headers, supports `--only` for
  adding one opening without rerunning the whole suite, and expects the local
  engine cache under `%LOCALAPPDATA%/EnCroissantEngineMatches`. The Vincent
  Keymer System entry currently starts from
  `1. Nf3 d5 2. c4 e6 3. e3 Nf6 4. Nc3 Be7 5. b3 O-O 6. Bb2`.
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
- Database panels now default to Lichess All when no explicit local reference
  database default exists. Online stats searches avoid hydrating sample-game
  PGNs, and Lichess explorer/game/cloud requests have explicit timeouts so the
  Database tab exits loading with an error instead of spinning forever when the
  remote service stalls.
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
- Databases can be linked to a Files folder that stores one PGN per game.
  Creating the link is available from the database export flow, and linked
  folders are incrementally synced after manual imports plus online and Lichess
  Study auto-updates by adding only games whose PGN content is not already in
  the folder.
- PGN conversion now initializes the En Croissant schema based on actual tables
  rather than only file existence, so zero-byte placeholder `.db3` files created
  during interrupted folder organization or external prep workflows are repaired
  on the next import instead of becoming permanent `no such table: Info`
  database cards.

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
- Prep move choice now uses a strength model based on raw cloud-engine
  centipawn loss and raw practical WDL loss instead of ordinal rankings. Prep
  tables can sort by Strength, and Prep settings expose Engine, Practical, and
  Smart modes plus a Smart engine/database blend and maximum safe CP drop, so a
  practical database move can beat a slightly better engine move while large
  engine drops are filtered out.
- Database opening tables now distinguish engine-only CP strength from the
  blended practical strength model. The shared table shows a separate blended
  strength column and sort, with a settings button in Database and Compare
  panels for Smart/Engine/Practical mode, engine blend, and maximum CP drop.
- The Prep panel also has a directly visible Strength settings button, separate
  from Builder settings, so max CP drop and engine/database blend can be tuned
  without opening the larger builder settings section.
- Player-mode Prep has a Straight Line finder for venom prep. From the current
  prep start it searches engine-approved user replies, requires each opponent
  move to meet a high forced-play-rate threshold, and surfaces lines where the
  final engine eval is objectively bad for the opponent; the result can be
  played onto the board for immediate analysis.
- Straight Line search falls back to candidate user moves from the selected
  opponent database when cloud/ChessDB does not return user replies, so prep
  against an opponent as Black can still reach their first forced reply from
  the starting position. Final "bad for them" scoring still depends on an
  engine eval for the target position.
- Smart strength now treats one- and two-game WDL spikes as evidence-poor:
  tiny samples are blended back toward the current position's practical baseline
  based on usage share before the engine/database blend is scored.
- Smart strength also detects clustered engine evaluations: when the top cloud
  engine candidates are within roughly 30cp, the effective engine weight is
  reduced so practical WDL evidence acts as the tie-breaker; clear engine
  separation restores the configured blend.
- Prep settings now save through a persisted app setting record, including
  source/player filters, min games/show top, move-sort defaults, and strength
  builder settings, so changed controls survive leaving and reopening the app.
- In Prep player mode, the color filter labels use the selected player name
  directly, such as "IfanRJ as white" and "IfanRJ as black", so the side filter
  reads as that player's game color instead of a generic board color.
- Prep player-mode color labels stack the player name above "as white" or
  "as black" and the surrounding filter row can wrap from the bottom edge, so
  long names remain readable beside Min games and Show top.
- In Prep general mode, the user-side selector says "I'm white" and "I'm black"
  so the control reads as the user's prep side rather than abstract colors; the
  segmented control is kept wide enough for both labels to render in full.
- Player-mode Prep can jump from an opponent move back to source evidence:
  opponent move rows and the active branch controls expose Go to game, sampling
  the local prep database, finding the exact FEN plus opponent move occurrence,
  and opening an analysis tab with that move selected.
- Player-mode Prep roots its branch search at the game start by default.
  "Start here" is the explicit action for changing the prep root to the
  currently selected board node; source/player/filter changes should not
  silently move that root to the current board path.
- Straight-line Prep now defaults to a stronger-player-friendly Venom mode:
  it treats repeated opponent choices as habits, scores the reach probability,
  and counts the engine concession of the habitual move versus the opponent's
  best engine alternative, while keeping a Strict mode for high-threshold
  railroad lines.
- Lichess Study links can be imported as local databases.
- Lichess Study databases support auto-update metadata and refresh tracking.
- Lichess Study databases expose a database-manager reload control that
  re-fetches the latest PGN, rebuilding games, comments, variations, and clock
  annotations; the same panel includes an update-automatically checkbox.
- Lichess Study update state now carries source/activity metadata, uses a
  study-specific banner label, times out stalled PGN downloads, and clears stale
  conversion banners left behind by interrupted sessions.
- Lichess Study imports preserve `StudyName`/`ChapterName` as the database
  event, and linked Files folder sync prefixes per-game PGNs with the study
  title so study chapters do not appear as only date plus player names.
- Lichess Study databases can opt into automatic two-way sync. When enabled,
  local En Croissant PGN annotations, variations, tags, and new chapters are
  pushed back to the linked Lichess study before remote changes are pulled into
  the database and linked Files folder; users need to relink Lichess with
  `study:write` scope for pushes. Push permission failures are explained as
  stale/missing study-write account access or missing edit permission instead
  of surfacing Lichess's raw 401/403 response, and the database settings prompt
  users to sign in to Lichess directly instead of relying on a removed Accounts
  page.
- Manual Lichess Study reloads now resolve a two-way-sync conflict in favor of
  the remote study PGN, rebuilding the local database and then syncing the
  linked Files folder. Automatic background sync remains conservative: if both
  the local database and remote study changed, it stops and asks the user to
  reload or resolve one side before pushing local annotations.
- Lichess Study database ordering is treated as source order rather than normal
  recent-game order. Opening a study database from Databases defaults the Games
  tab to ascending database id order, database PGN export explicitly writes
  games by id, and linked study folder sync uses numbered filenames while
  renaming existing matching PGNs into that numbered order so the Files folder
  can mirror the Lichess chapter sequence.
- Linked Lichess Study folder sync dedupes by source mainline as well as exact
  PGN text. This avoids creating a second file when the same game already
  exists locally with different headers or richer comments/variations; the
  local annotated PGN is kept and renamed into the ordered study slot. The
  2026-06-03 cleanup of `My classical games` moved 40 duplicate PGN copies
  into `Documents/EnCroissantDataBackups/my-classical-games-dedupe-*`, leaving
  45 active unique mainline PGNs and preserving all moved copies.
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
- Review action count badges on the idle Review panel have stable non-shrinking
  widths, so two- and three-digit daily/time-management counts remain fully
  readable beside long split-button labels.
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
- Normal analysis boards now use an inert empty review-deck key unless a
  review/practice session actually needs deck data. This keeps stale default
  review storage and large FEN indexes from waking on every board move, so the
  move list can update promptly while review tabs keep their indexed lookups.
- Hidden-answer mistake cards use only already-stored mistake-type metadata in
  board and game-info panels; fresh tactical/positional classification is
  deferred until answer feedback is visible.
- Due, full-deck, and scoped review trainers keep their large
  remaining-position queues stable while advancing by cursor offset, avoiding
  per-card array copies through React state on large Opening Review and Mistake
  Review decks.
- Full-deck Opening Review and Mistake Review practice now use an explicit
  lazy all-positions queue instead of materializing every card index up front.
  Daily opening batches and mistake phase/type/time-management batches return
  position indices directly, so focused trainer startup avoids extra
  position-array construction and reference remapping while preserving the
  existing whole-deck JSON storage format.
- Engine enable/disable-all updates are idempotent, so Mistake Review's
  optional engine-off-on-navigation behavior does not rewrite engine settings
  or wake engine subscribers when engines are already in the requested state.
- Review summary snapshots stay frozen while a practice session is active and
  refresh when practice returns idle, avoiding the old delayed 2.5-second
  whole-deck stats refresh during card transitions on large decks.
- Time-management trainer batches now treat repeated long-think evidence for
  the same FEN as one SRS item: a reviewed or scheduled copy suppresses fresh
  duplicates until it is due, attempted-today duplicates are skipped, and the
  ready count reflects the deduped board-position queue.

### Puzzle Training

Puzzle training is being upgraded from session-only random puzzle practice into
a durable guided trainer. The downloaded Lichess puzzle `.db3` remains
read-only; user progress is stored separately in an app-data SQLite database
keyed by a stable puzzle database fingerprint. Backend commands now initialize
and read puzzle progress, select Coach/SRS/theme/rating/random training
puzzles, record rated attempts, update SRS cards and per-theme skill estimates,
serve dashboard data, and reset/export progress. The Coach selector clears
urgent due cards first, then ordinary due reviews, then weak-theme or
  rating-calibration puzzles. Puzzle progress is intentionally scoped per
  installed puzzle database snapshot so future database updates do not silently
  mix stats from different source data.
- The Puzzle tab UI now has Train, Stats, Themes, and SRS panels. Train shows
  Puzzle Elo, database accuracy, due/mastered counts, selection reason, SRS
  state, current puzzle themes, and the Elo delta after an attempt. Stats shows
  Elo and volume/accuracy trends, Themes ranks per-theme skill and weakness,
  and SRS exposes counts, the next review queue, reset, refresh, and progress
  export controls. Completed puzzle attempts now increment existing puzzle
  daily goals automatically instead of requiring the Home goal's manual
  progress button.
- Puzzle selection now broadens empty filter combinations before surfacing an
  error: if a theme/rating search has no match, it falls back through rating
  only, broad theme, then any available puzzle. Switching puzzle databases
  also clears the active session puzzle so stale puzzle IDs are not recorded
  into the newly selected database.
- Puzzle training now auto-selects an available saved puzzle database when the
  previous selection is missing, auto-loads the first trainer card for the
  selected database, and uses a visible Start/Next puzzle button instead of a
  tiny plus icon. Completed puzzles now stay selected long enough to show
  feedback, freeze the solve timer, display the Elo/SRS result, and let the
  user explicitly request the next trainer card. Completion feedback is
  optimistic and local-first: the timer stops and the result panel appears
  before the backend persists Elo/SRS progress, then the backend result is
  merged in when available. Selection-reason banners such as "Rating
  calibration" are hidden once a card is completed so they cannot mask the
  solve feedback.
- Puzzle Elo display preserves one decimal place and ignores stale progress
  refresh responses, so small review deltas remain visible and an older
  dashboard request cannot overwrite the fresher summary returned by a just
  recorded attempt.

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
- Castling is treated as a first-class plan text case: local/online Plan
  Explorer rows and Engine Plans should show kingside or queenside castling
  rather than a king route through the rook square.
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
- Board workspaces now have a small board-style settings button in a slim rail
  beside the board, outside the chessground interaction surface.
  The persisted style can stay on the user's default board/piece setup or
  switch to a chess.com-inspired package with green squares, the real Chess.com
  Neo pieces vendored locally from the public theme PNGs, yellow
  selected/last-move squares, tuned arrow brushes, and the current Chess.com
  move/capture/check sounds vendored locally from the live web bundle. Volume
  still follows the normal sound setting. During Tauri dev runs, sound playback
  should prefer the Vite-served `/sound/...` files so newly vendored collections
  work before the Tauri resource directory is rebuilt. The mode is an override,
  so default appearance settings remain intact when users switch back. Keep the
  chess.com arrow/highlight SVG layers on `pointer-events: none`; otherwise they
  sit above the board and block piece selection.

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
  sources into Files folders with one game PGN plus metadata sidecar per game,
  plus additive linked-folder sync for updating databases.
- `src/state/atoms.ts`: persisted source choices, auto-update state, review
  deck state, practice state, Plan Explorer state, compare selection state, and
  database-to-Files-folder link records.
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
- Local process guidance: browser verification is opt-in only when the user
  explicitly asks for Playwright/browser checks, and agents should not rely on
  the old direct-browser minimal Tauri-global stub method.
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
- Database engine columns are eval-first: move tables should show cloud
  centipawn/mate scores such as `+0.59` directly instead of presenting
  engine-order ranks as the useful value. Strength sorting can still use the
  same cloud score data, with CP-loss details in hover text.
- Database blended strength weighting keeps engine-strong moves readable when
  cloud evals are clustered: practical WDL still breaks close-eval ties, but it
  should not collapse good engine moves to `0` in the Blend column.
- Opponent prep move tables keep the user's clicked sort category while moving
  through a prep line. Initial defaults are side-specific: opponent/source moves
  sort by Usage, while user candidate moves sort by Smart strength; both
  defaults are tuneable from the prep settings controls.
- Opponent prep recency wording is perspective-aware in player prep: when it is
  the opponent's turn, rows say when that player last played the move; when it
  is the user's turn, candidate replies say when the opponent last played
  against that move.
- The chess.com-inspired board style uses checkerboard parity that matches
  normal chess coordinates in the White orientation: a1 is dark and a8 is
  light. Keep this invariant when adjusting the CSS gradient or square colors.
- Empty move-list annotation: right-clicking blank notation space now exposes
  an Annotate action that opens the starting-position comment editor, allowing
  pre-move PGN comments without first making a move.

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
- UI/layout verification: only perform Playwright/browser checks when the user
  explicitly asks for them. Do not use the old direct-browser minimal Tauri
  global-stub method; prefer non-browser verification by default, or a clearly
  documented dedicated harness when browser verification is requested.
- Known historical note: an earlier full `cargo test` had unrelated existing
  failures in eval/search fixture expectations. Treat broad failures as
  suspicious, but verify whether they predate the current change before editing
  unrelated code.
