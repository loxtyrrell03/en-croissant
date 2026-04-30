# Session Change Log

This file records the work saved during the Codex session on the `codex/en-croissant-fork` branch.

## Ongoing Workflow

- Automatically create git commits as work progresses whenever an important, coherent milestone has been completed.
- Keep each commit focused on the meaningful progress just made, with a concise message describing that milestone.
- Do not wait until the end of a long session to save progress unless the user explicitly asks for a single final commit.
- Avoid committing broken, half-finished, or unverified work unless the user explicitly asks for a checkpoint commit.

## Local Browser Verification

- Prefer the Browser Use plugin for localhost UI checks. If its Node REPL bootstrap fails because the system Node is too old, use the Playwright browser tools as a fallback and note the reason.
- The Vite dev server for this Tauri app normally serves at `http://localhost:1420`; `vite.config.ts` has `strictPort: true`, so check whether that port is already owned before starting a new server.
- Opening the app directly in a regular browser is outside the Tauri shell, so the page needs minimal Tauri globals injected before navigation. Stub `window.__TAURI_OS_PLUGIN_INTERNALS__` and `window.__TAURI_INTERNALS__` with no-op `invoke`, event listener, metadata, and `convertFileSrc` handlers before loading `http://localhost:1420`.
- For layout checks, inspect real DOM dimensions instead of relying only on screenshots. Useful measurements are `#left`, `.cg-wrap`, the eval bar element, and any nearby panel that may be limiting the board.
- Temporary screenshots and `.playwright-mcp/page-*.yml` snapshots are local verification artifacts. Do not delete them unless the user explicitly confirms deletion.

## Base

- The branch started from upstream commit `14ae9478` (`Updated French translation`).
- The app was renamed locally as an En Croissant fork in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Safe local launch helpers were added under `scripts/`, including a data-backup dev launcher and fork icon asset.

## Database And Analysis Workspace

- Added a `Compare` tab to the analysis board.
- Added side-by-side database comparison UI for local reference databases.
- Added opening-table sorting, compact table rendering, and shared sorting helpers.
- Added online Lichess All and Lichess Masters sources to database comparison.
- Added saved default source controls for the Database tab and each Database Compare slot.
- Added board arrow previews when hovering opening moves in the Database, Compare, and Analyze Repertoire tables, with click-to-load move behavior.
- Added a `Gaps` tab for repertoire gap scanning, training, export, and engine verification workflows.
- Added backend repertoire-gap search support and generated TypeScript bindings for it.
- Added online game import into local databases from Lichess and Chess.com usernames, with progress reporting and account token reuse for Lichess when available.
- Added online database auto-update support metadata and shared online game source helpers.

## Analyze Repertoire And Review

- Reworked Analyze Repertoire into two user-oriented modes: prep against an opponent's repertoire and find gaps in the user's own repertoire.
- Made the scan orientation-aware so positions are attributed to the side being prepared or reviewed rather than mixing games from the opposite color.
- Replaced technical table copy with clearer priority, opening line, played move, next step, evidence, and result columns, plus hover info bubbles.
- Added color filtering, frequency sorting, recency weighting, and an urgency score that emphasizes practical result gaps, frequency, recency, and only large engine drops.
- Added cloud validation during the initial scan, preserving validation progress when leaving and returning to the Analyze Repertoire tab.
- Changed validation to use ChessDB first for the bulk scan, Lichess Cloud only for the most urgent deep-validation rows, and local Stockfish fallback when enabled.
- Cached Lichess Cloud hits and misses so repeated Analyze Repertoire scans do not re-query the same FEN.
- Batched Analyze Repertoire validation updates and let the main scan finish after the bulk ChessDB pass, while slower Lichess and Stockfish upgrades continue without freezing the UI.
- Added validation source and depth display in Analyze Repertoire rows, priority messages, saved review cards, and post-attempt review evidence.
- Added parallel cloud validation queues so Lichess Cloud and ChessDB checks do not run one position at a time.
- Added delete and edit controls for Analyze Repertoire rows, including direct correct-move overrides.
- Added saved Opening Review decks from Analyze Repertoire positions, with merge support for existing decks.
- Added a home-page Opening Review entry point and a full review workspace with Review, Analysis, Database, Plan Explorer, Compare, Analyze Repertoire, Info, notation, engine, and annotation tools.
- Moved Analyze Repertoire out of the standard board tab strip and made it launch from the Opening Review area, including an empty-deck entry point when no review decks exist.
- Added spaced-repetition opening review practice, full-deck practice, post-attempt evidence, saved comments/arrows/annotations, card deletion, card move editing, board-played move overrides, and whole-deck deletion.
- Added backward compatibility for older saved review cards that used the previous generic cloud validation source.

## Plan Explorer

- Added a ChessBase-style `Plan Explorer` tab next to the database tools.
- Added backend plan extraction from the reference search index, tracking piece routes through sampled continuations.
- Added generated TypeScript bindings and `getPlanExplorer` frontend utilities.
- Added a Plan Explorer table grouped by piece, with route counts, result bars, side filters, ply-depth controls, and database selection.
- Added hover previews so moving over a route shows its arrows on the board.
- Hovering a Plan Explorer piece row now previews the piece's most common maneuver.
- Added click-to-pin route arrows from the Plan Explorer table.
- Added board support for plan arrows and a `Ctrl+right-click` piece shortcut to draw that piece's normal route.
- When the Plan Explorer tab is selected, hovering over a piece on the chessboard previews that piece's most common maneuver.
- Added automatic plan arrows with an on-panel `Auto arrows` switch and configurable arrow limit.
- Plan Explorer now defaults to `8 ply` and `10` automatic arrows.
- Automatic plan selection favors significant queen, rook, bishop, and knight maneuvers plus key pawn breaks or advanced pawn moves.
- Added Lichess All and Lichess Masters as Plan Explorer sources alongside local reference databases.

## Performance And Cancellation

- Plan Explorer searches are owned by the Plan Explorer tab instead of the always-mounted board.
- Local database searches now have cancellable request IDs.
- Leaving or changing the Plan Explorer, Database, or Compare views cancels the relevant in-flight local database search.
- The database progress listener now cleans itself up when the visible request changes or unmounts.
- Engine analysis now runs only while the `Analysis` or `Compare` workspace is active, and local engines are stopped when leaving those views.
- Added a serialized position-occurrence index to `.ecsi` search indexes so exact Database, Compare, and Plan Explorer lookups can jump directly to matching positions instead of replaying every game.
- Updated reference-side repertoire gap scanning to use the occurrence index for candidate positions.
- The mmap search-index cache now keeps several recent database indexes, so Compare can keep both selected databases warm instead of constantly replacing the cache entry.
- Database search, Plan Explorer, replay, and index generation now tolerate Shakmaty's harmless "too much material" validation case, matching the import path and avoiding false errors for displayable positions.
- Existing v4 `.ecsi` indexes now remain readable, and very large databases skip the synchronous occurrence table so Mega Database loads do not get trapped in a huge rebuild.
- Plan Explorer now pushes its side filter into the board arrow data, caches repeated plan lookups, and stops the Mega Database fallback scan once it has enough sampled continuations for the displayed plans.
- The Mega Database Plan Explorer fallback now uses a depth-aware sample cap and cancels the parallel scan as soon as enough continuations have been collected, avoiding the slowdown that returned after the first few opening moves.

## Board And Settings

- Added stored atoms for Plan Explorer data, hover preview, automatic-arrow visibility, automatic-arrow limit, and compare database selection.
- Added a global board setting for Plan Explorer automatic arrows.
- Added plan-arrow drawing brush support on the board.
- Replaced the old board workspace split shell with a resizable board/right-side layout, including an independently scrollable right column and draggable right-side pane heights.
- Moved the Annotate tools out of the right-side tab strip and made them permanently visible under the chessboard.
- Added a transient board preview arrow brush for table and Plan Explorer hover interactions.

## Generated And Supporting Files

- Updated `src/bindings/generated.ts` for new backend commands and data types.
- Updated route/generated state files as produced by the local app tooling.
- Included local session artifacts and helper files that were untracked at save time because the user asked to commit everything currently uncommitted.

## Verification

- `cargo check` passed.
- `pnpm build-vite` passed.
- `pnpm exec oxlint` passed on the touched frontend files.
- `cargo test search_index` passed.
- `cargo test exact_matches` passed.
- `cargo test exact_query_ignores_too_much_material_validation` passed.
- Earlier full `cargo test` had unrelated existing failures in eval/search fixture expectations; those were not part of this save.
- Latest frontend verification after Analyze Repertoire and Opening Review changes: `pnpm exec oxlint` passed on the touched frontend files and `pnpm build-vite` passed.
