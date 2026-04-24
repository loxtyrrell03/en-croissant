# Session Change Log

This file records the work saved during the Codex session on the `codex/en-croissant-fork` branch.

## Base

- The branch started from upstream commit `14ae9478` (`Updated French translation`).
- The app was renamed locally as an En Croissant fork in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Safe local launch helpers were added under `scripts/`, including a data-backup dev launcher and fork icon asset.

## Database And Analysis Workspace

- Added a `Compare` tab to the analysis board.
- Added side-by-side database comparison UI for local reference databases.
- Added opening-table sorting, compact table rendering, and shared sorting helpers.
- Added a `Gaps` tab for repertoire gap scanning, training, export, and engine verification workflows.
- Added backend repertoire-gap search support and generated TypeScript bindings for it.

## Plan Explorer

- Added a ChessBase-style `Plan Explorer` tab next to the database tools.
- Added backend plan extraction from the reference search index, tracking piece routes through sampled continuations.
- Added generated TypeScript bindings and `getPlanExplorer` frontend utilities.
- Added a Plan Explorer table grouped by piece, with route counts, result bars, side filters, ply-depth controls, and database selection.
- Added hover previews so moving over a route shows its arrows on the board.
- Added click-to-pin route arrows from the Plan Explorer table.
- Added board support for plan arrows and a `Ctrl+right-click` piece shortcut to draw that piece's normal route.
- Added automatic plan arrows with an on-panel `Auto arrows` switch and configurable arrow limit.
- Plan Explorer now defaults to `8 ply` and `10` automatic arrows.
- Automatic plan selection favors significant queen, rook, bishop, and knight maneuvers plus key pawn breaks or advanced pawn moves.

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

## Board And Settings

- Added stored atoms for Plan Explorer data, hover preview, automatic-arrow visibility, automatic-arrow limit, and compare database selection.
- Added a global board setting for Plan Explorer automatic arrows.
- Added plan-arrow drawing brush support on the board.

## Generated And Supporting Files

- Updated `src/bindings/generated.ts` for new backend commands and data types.
- Updated route/generated state files as produced by the local app tooling.
- Included local session artifacts and helper files that were untracked at save time because the user asked to commit everything currently uncommitted.

## Verification

- `cargo check` passed.
- `pnpm build-vite` passed.
- `cargo test search_index` passed.
- `cargo test exact_matches` passed.
- `cargo test exact_query_ignores_too_much_material_validation` passed.
- Earlier full `cargo test` had unrelated existing failures in eval/search fixture expectations; those were not part of this save.
