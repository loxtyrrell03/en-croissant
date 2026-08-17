# Proprietary Rebuild Parity Checklist (Behavior Only)

**Source basis:** the fork product map (`agents.md` as of 2026-07-02) and the
"Current Full-Parity Scope Addendum (2026-07-02)" of the proprietary rebuild
plan.

**How to use:** before release, every item below must be marked as one of:
**implemented**, **intentionally redesigned**, **deferred with reason**, or
**legally blocked**. Items describe user-visible behavior and expected
outcomes only.

**Copy safety:** this document intentionally contains no source file paths,
component/function/command names, schema or table names, state identifiers,
CSS classes, or exact fork UI strings. It describes what the user can do and
what result they get. It is safe to copy into the proprietary repository.
Generic chess terms (PGN, FEN, UCI, MultiPV, WDL, SRS, Elo) and public
service names (Lichess, Chess.com, World Chess, FIDE Online Arena, Stockfish,
Maia) are used freely.

---

## 1. App shell, home and workspace

- [ ] A task-led home screen offers: open recent files, import games, start puzzle training, analyze the latest linked online game, pick from recent online games, manage opening-review decks, manage mistake-review decks, and view daily training goals.
- [ ] A one-click "analyze my newest online game" action pulls the most recent game from a linked Lichess or Chess.com account directly into an analysis board.
- [ ] Home empty states always offer a concrete next action (link an account, add an engine, add a reference database, scan a repertoire, choose online games) instead of blank panels.
- [ ] Workspaces are tabbed: analysis, play, puzzle training, opening review, and mistake review each open as their own board tab, and tab labels use compact icon-first styling with hover tooltips/accessible labels.
- [ ] The analysis workspace is board-first: a large resizable board on the left with annotation tools always visible beneath it, independently scrollable right-side panels, and detached eval/notation/board-control areas in the lower right.
- [ ] Right-side research tabs cover practice, analysis, database, plan exploration, engine plans, source comparison, structures, coach, and game info without losing board context.
- [ ] The under-board area has a compact switch between moves, database, prep, and coach modes; move navigation controls appear only in moves mode so other panels get the full lower workspace, and the notation header stays stable across mode switches.
- [ ] Under-board database/prep surfaces hold their own state independent of the right-side database/prep panels, so a user can compare one source below the board with a different source on the right.
- [ ] Board and panel sizes are user-resizable with resize handles hidden unless needed; layout choices persist.
- [ ] Heavy route/panel loads show progress placeholders instead of blank panes, and frequently used areas warm in the background after first paint so navigation feels immediate.
- [ ] Cached path/directory lookups let common screens paint immediately while real values refresh in the background.
- [ ] Launching a second app instance hands off cleanly to the running instance instead of failing; startup is robust on Windows, including serialized startup for repeated local launches so the UI shell is not killed mid-load.
- [ ] The local development launcher self-heals missing dependencies before starting, so restored or moved working copies still launch from pinned shortcuts.
- [ ] Analysis workspaces expose a top-bar save-current-game-to-files action that always saves a PGN copy of the loaded game, regardless of origin (online import, database row, or file).
- [ ] Report entry points (game report, prep/style reports, rating and time-management reports) are reachable from the task-led workspace, and their outputs are treated as user artifacts rather than hidden diagnostics.
- [ ] Account linking remains reachable from online-game flows even without a dedicated accounts page in the sidebar.
- [ ] A files/library page, a database manager page, an engine manager page, and a global settings page all exist as first-class navigation targets.
- [ ] Small-viewport behavior stays usable: board size, right-panel scrolling, tab labels, engine dock height, and table overflow are all verified on laptop-scale windows.

## 2. Board, notation, annotations, clocks and playback

- [ ] Legal move entry with promotion handling; illegal moves are rejected.
- [ ] Games load and save via FEN and PGN, including variations, comments, and NAGs.
- [ ] Full game-tree navigation: mainline plus nested variations, branch jumping, and variation editing.
- [ ] Arrow keys step through notation unless a modifier key is held (modifier combinations remain free for other actions).
- [ ] Imported PGN annotations and variation trees stay intact during playback and when saving back to files, review decks, or databases.
- [ ] Visual annotations (user arrows, square highlights, evaluation glyphs) attach to positions/moves and persist with the game.
- [ ] Annotation tools sit directly under the board rather than behind a tab, and the comment editor never steals focus from board or practice input.
- [ ] Right-clicking empty notation space lets the user add a comment to the starting position before any move exists.
- [ ] A single focus toggle hides/restores the eval bar together with move-quality markers (good/mistake/blunder icons, eval scores, short verdict comments) while leaving ordinary written comments visible; a separate control hides ordinary notes.
- [ ] Move-quality bubbles stay pinned to their board squares across board and font size changes.
- [ ] Board clocks display at the player strips when imported games carry clock or timestamp data; per-move think-time chips appear in notation, with sub-second precision when the source provides it.
- [ ] Live replay animates a timed game: each move plays after its recorded think time, the active side's clock counts down during the move, and a whole-game progress bar with remaining replay time is shown under a labeled play/pause control.
- [ ] Hovering database/plan/review move rows previews arrows on the board; clicking plays or loads that move.
- [ ] Result/WDL bars everywhere render from the viewing player's perspective.
- [ ] Board style can stay on the user's default or switch to an alternative preset package (distinct square colors, piece set, selection/last-move highlights, arrow styling, and move/capture/check sounds); switching back restores the default settings untouched. Proprietary releases must use original or rights-cleared board, piece, and sound assets.
- [ ] Dark/light square parity matches standard coordinates (a1 dark, a8 light in the default orientation) in every board style.
- [ ] Sound volume follows one global sound setting across all sound packages.
- [ ] A small board-settings control sits in a slim rail beside the board, outside the piece-interaction surface, and decorative overlay layers never block piece selection.
- [ ] Compact under-board notation shows more moves before scrolling: dense move rendering, slightly smaller comment text, and minimal header chrome.
- [ ] Attempted training moves become real board moves (not transient previews), so the attempt stays on the board and annotations/variations made afterwards can be saved.
- [ ] The board supports a fully hidden mode behind a completely opaque cover (no pieces visible through blur or tint) with explicit reveal/hide controls (details in section 9).
- [ ] A modifier-click on a board piece previews that piece's most common route from database evidence (details in section 10).
- [ ] Clock comments and annotations survive database round-trips (import, storage, and export preserve them).

## 3. Analysis, engines and cloud evals

- [ ] Users can add and configure their own UCI engines: options, MultiPV, profiles, diagnostics, and reliable start/stop/cancellation of local engine processes.
- [ ] MultiPV analysis renders compact single-row lines; the engine dock sizes to its content and hides when analysis is disabled.
- [ ] Engine move information is eval-first: centipawn/mate scores are the displayed value with CP-loss detail on hover; ordinal engine ranks are never presented as the primary value.
- [ ] Local engine analysis starts immediately when the position changes; cloud checks run in parallel and never gate the local engine start.
- [ ] When a cloud eval arrives for the current position it becomes authoritative, replacing interim local lines, and any speculative local search for that position is stopped.
- [ ] Cloud lookup status is explicit per position — checking, available, missing, or a typed error (rate-limited, timeout, network, invalid response) — with the exact reason visible in an expanded view, while the main engine rows stay quiet about cloud noise.
- [ ] Stale engine results can never update a position the user has already left.
- [ ] A local compact cloud-eval store can be built from the public Lichess eval dump: a streaming build with no giant temporary decompressed file, position-hash-keyed shards storing depth/node counts and the top root moves per position (a newer format also stores PV tails), plus status and single-position lookup tooling for verification.
- [ ] The local eval store is consulted first; the remote cloud API is used only where explicitly designed as a fallback; prep, database, and opening-health scoring paths never call external eval APIs and never substitute a third-party eval service as an engine source.
- [ ] Compact one-move local cloud rows are extended at runtime: matching PV tails are grafted from the local engine's root MultiPV, and any remaining one-move rows get a hidden child-position engine search — while the stored cloud score, depth, and first move remain authoritative.
- [ ] Local eval-store misses are cached, so sparse-position features (such as after-prep projection) never repeat expensive lookups for the same position.
- [ ] Visible board analysis stops consulting the local eval store beyond a configured game depth (around move 15) and simply keeps the live engine running, since store coverage thins after the opening; this cutoff does not blindly apply to paths without a live engine fallback.
- [ ] Empty engine output is never cached as a permanent "no analysis" state: starting a search clears stale empties, a bounded first-output watchdog retries one fresh engine process, and a timeout leaves the UI recoverable rather than stuck.
- [ ] When the app loses focus or is hidden, interactive engines pause and pending UI probes cancel, while intentional batch work (mistake scans, game reports, validation passes) keeps running.
- [ ] Cloud API usage is rate-friendly: MultiPV capped to the useful cloud range, identical in-flight lookups shared, requests serialized with spacing, and a cooldown applied after rate-limit responses.
- [ ] Analysis, annotation, and review UI stay responsive while engines run (contention managed; engine arrow computation avoids recomputing full lines when the position is already known).
- [ ] Engine enable/disable operations are idempotent: requesting an already-current state does not rewrite settings or wake subscribers.
- [ ] New local eval-store format versions remain readable alongside the previous version while a rebuild is in progress.

## 4. Databases, files, sources and export

- [ ] Games import into local databases from PGN, compressed PGN, and supported database file formats.
- [ ] Interrupted or zero-byte placeholder database files are repaired on the next import instead of becoming permanently broken entries.
- [ ] Databases can be organized into nested folders from the database manager: create/rename folders, move databases into them, and an auto-organize action groups common source types (repertoires, online accounts, reference databases, personal games, opponent prep). Search indexes move together with their databases.
- [ ] Every database selector (analysis, comparison, plan exploration, repertoire scans, prep, review setup) uses a two-step picker: root databases directly selectable, foldered databases reached via folder-then-database.
- [ ] Whole databases export into the files library as a named folder containing one PGN per game plus a per-game metadata sidecar.
- [ ] A database can be linked to a files folder mirroring one PGN per game; the folder syncs additively after manual imports and auto-updates, adding only games whose content is not already present (dedupe by exact text and by game mainline).
- [ ] Search supports headers (player, event, dates, ratings, results, time controls), exact position, and transposition-aware modes where designed, plus current-position opening statistics.
- [ ] Exact-position lookups use precomputed occurrence indexes where available, and older index format versions remain readable.
- [ ] Very large databases skip the blocking index-build path so multi-gigabyte references still load responsively.
- [ ] A warm cache keeps several recent search indexes mapped so source comparison can keep both selected databases active.
- [ ] All long searches carry cancellable request identities; leaving a view or changing sources cancels stale work, and stale results never overwrite the newer context.
- [ ] Games with harmless nonstandard material configurations remain displayable and searchable rather than being rejected by strict validation.
- [ ] An indexed search returning only empty/zero rows is not trusted for an empty-state message until the slower scan path has had a chance to recover the real answer.
- [ ] Existence-only position checks never write negative results into shared move-result caches, so novelty probes cannot poison move tables.
- [ ] Imported databases that carry placeholder per-game reachability metadata for every game are still searched by decoding moves, not pruned by metadata prefilters.
- [ ] Opening move tables support sortable columns, compact rendering, recent-move sorting, player-perspective filters, cloud-enhanced move ranking, perspective-styled WDL bars, and hover arrow previews.
- [ ] Move tables show a separate engine-only strength column and a blended (engine plus practical) strength column, with per-panel settings for mode, engine/practical blend, and maximum CP drop.
- [ ] Blended strength keeps engine-strong moves readable when evals cluster: practical results break near-ties without collapsing good engine moves to zero.
- [ ] Side-by-side comparison shows move statistics from two sources at the same position, covering local databases and the public Lichess pools (all games and masters).
- [ ] Default sources for database views and comparison slots are saved preferences, and the database panel falls back to a sensible broad public source when no local default exists.
- [ ] Online statistics searches avoid eagerly downloading sample game PGNs, and remote requests carry explicit timeouts so panels exit loading with an error instead of spinning forever.
- [ ] The source list covers local databases, hosted database folders, public Lichess pools, study imports, generated web exports, and online account databases, with stable persisted identities and graceful fallback when a source moves or is renamed.
- [ ] The files library shows PGNs and repertoires; games open onto boards; per-file metadata sidecars mark repertoire files.
- [ ] PDF documents are first-class library entries with an in-app preview and a system-viewer fallback; chess-specific actions stay scoped to chess files.
- [ ] Directory scans read light metadata first and defer exact game counts until a file is selected or opened, so large folders never hold the tree on a loading state.
- [ ] Folder children lazy-load on expansion; global search/filter triggers the full background load only when that all-folder view is actually needed.
- [ ] File rows sort newest-first by modification time with name as a stable fallback; a persistent sort menu offers newest/oldest/name/type; manual drag ordering per folder is also available, and pinned entries stay grouped above the chosen order.
- [ ] Files and folders can be pinned (persisted, visibly marked, sorted first) and archived (persisted state — not a filesystem move — hidden behind a dedicated archived filter); both pin and archive state follow renames, moves, and deletions.
- [ ] The file tree supports right-click rename for files and folders, safe drag-and-drop (including drop-into-folder vs. reorder-near-edge distinctions), clean deselection, and error-free preview when no board tab exists.
- [ ] An import-database-as-files action accepts PGN, compressed PGN, or database sources and writes a named folder of per-game PGNs with metadata sidecars.
- [ ] Generated intermediate artifact folders (report render workspaces, archived source PGNs) are hidden from the library while final PDFs/reports and combined game PGNs stay visible.
- [ ] From database and file views, users can jump to source games, export a game or a whole database directly, and browse generated reports.

## 5. Online games, studies and account data

- [ ] A Lichess or Chess.com username's public games import into a local database, with progress reporting that keeps visibly moving during long fetches.
- [ ] Import options include most-recent-count and date-range modes; imports deduplicate, produce summaries, and reuse saved account tokens where appropriate.
- [ ] Provider-specific failures translate into actionable user messages rather than raw HTTP responses.
- [ ] A merged online database can combine games from linked accounts across providers.
- [ ] The online game picker offers provider tabs, account selection, recent-game previews showing date, result, and formatted time control, single-select for analysis, multi-select for review-deck creation, and paging in both directions beyond the first recent slice.
- [ ] Online databases carry auto-update metadata; refreshes append new games with normalized timestamps so ordering stays reliable.
- [ ] Review decks linked to online databases auto-update when the database updates; if the database file has moved, the deck re-resolves it by its online identity and writes the corrected location back after a successful scan.
- [ ] A database content-update signal cannot be consumed before dependent scans run: a newer update timestamp triggers a deck scan even when stored game counts already match.
- [ ] Imported online games preserve clock/timestamp comments; direct game-link imports convert provider move timestamps into standard clock comments; older databases are flagged for clock-data enrichment during refresh.
- [ ] Lichess studies import as local databases preserving chapter order, with study and chapter names carried into game metadata so chapters do not display as bare date/player pairs.
- [ ] Study databases expose a reload control that re-fetches the latest study PGN and rebuilds games, comments, variations, and clock annotations, alongside an automatic-update option.
- [ ] Study update state shows source/activity labels, times out stalled downloads, and clears stale progress banners left behind by interrupted sessions.
- [ ] Optional two-way study sync pushes local annotations, variations, tags, and new chapters back to the linked study before pulling remote changes; it requires re-linking the account with write permission, and permission failures are explained in plain language with a direct sign-in prompt instead of raw 401/403 output.
- [ ] Manual study reloads resolve two-way-sync conflicts in favor of the remote study; automatic background sync stays conservative and asks the user when both sides changed.
- [ ] Study database ordering is treated as source order: game lists default to ascending source order, exports write games in that order, and linked folders use numbered filenames, renaming existing matching files into the numbered sequence.
- [ ] Linked study folder sync dedupes by game mainline as well as exact text, keeps the highest-annotation copy of a duplicated game, and removes stale same-game siblings during ordered sync.
- [ ] Online account imports refuse to append into a study database, so account refreshes can never pollute study content.
- [ ] OAuth sign-in binds a fresh local callback listener before opening the browser and shuts it down after the callback, avoiding stale or racing redirects.
- [ ] World Chess / FIDE Online Arena profiles work as an online game source for prep: public profile and game endpoints, per-board PGN downloads, and exact FIDE-ID identity verification — all behind reviewed adapters with terms-of-service notes, rate limits, source labels, and user-visible provenance.
- [ ] Every imported online account carries an explicit user-visible confidence label (for example: high, high-but-stale, rejected, none) established before its games are imported.

## 6. Prep, opponent research and strength models

- [ ] Prep supports a player-specific mode (against a named opponent) and a general mode (against a source pool), with target-color controls and clear labeling of whose games are shown.
- [ ] Player-mode color filters read as the opponent's game color using the player's actual name; general mode reads as the user's own side; long player names remain readable beside the other filters.
- [ ] Prep source selection uses the shared database picker including foldered databases and the public Lichess pools; choosing an online pool forces general mode and clears player-only fields, and returning to player mode restores a local source.
- [ ] The player field auto-seeds from the most common player in the selected database (matching the database title's casing when it refers to the same player) while preserving manual edits; provider/source-label suffixes are stripped when resolving the actual player so seeded names still match real player records.
- [ ] Minimum-games and show-top filters bound the move table; minimum games defaults low enough that even single-game opponent branches are visible.
- [ ] The prep root defaults to the game start; only an explicit start-here action moves the root to the current board position, and source/player/filter changes never silently move it.
- [ ] Prep is two-stage: a setup surface for source/target/settings, then a training surface focused on the move table; compact placements replace large off-start alerts with a one-line status.
- [ ] The training surface offers a play-the-most-common-open-branch action and a mark-done-and-advance action that cycle opponent branches from the prep root, aware of the current board cursor (including opponent-to-move roots and an away-from-prep-start state).
- [ ] The setup-vs-training page state persists per tab/workspace so leaving prep and returning restores where the user was.
- [ ] All prep settings — source/player filters, min games, show top, sort defaults, strength settings, and builder settings — persist across app restarts.
- [ ] Opponent move rows and the active-branch controls can jump to source-game evidence: the exact game opens in an analysis tab with the relevant move selected; a return control goes back to the last opponent choice.
- [ ] Rows show relative last-played recency with the exact date on hover, and the wording is perspective-aware (when the opponent last played the move vs. when the opponent last faced the user's move).
- [ ] Move tables have clickable, keyboard-accessible sortable headers; manual sorts are temporary to the current position and reset to saved defaults on navigation; defaults are side-specific (usage for opponent/source moves, strength for the user's replies) and tunable.
- [ ] Each opponent move's branch coverage is scored from the saved continuation and common replies, with graded labels from missing coverage to well-covered.
- [ ] An import drawer inside prep fetches a player's public online games (recent count with a preview of the oldest included game, or an uncapped date range), optionally saves them as a normal database, and otherwise attaches them as an unsaved current-prep source; opening the drawer collapses the other prep controls into a focused import surface.
- [ ] Move strength is computed from raw engine centipawn loss and raw practical WDL loss, not ordinal rankings.
- [ ] Three strength modes exist — Engine (eval-led), Practical (result-led), and Smart (configurable blend) — plus a maximum-safe-CP-drop setting, so a practical database move can beat a slightly better engine move while large engine drops are filtered out.
- [ ] A dedicated strength-settings control is directly visible in prep (separate from builder settings), and equivalent strength settings exist in the database and comparison panels.
- [ ] Low-sample hardening: one/two-game WDL spikes are blended toward the position's practical baseline by usage share, cannot define the best-result benchmark, and a final low-share cap applies in Smart/Practical modes.
- [ ] When top engine candidates cluster within a narrow eval band, the effective engine weight drops so practical evidence breaks ties; clear engine separation restores the configured blend.
- [ ] Covered engine-good moves receive a score floor so an engine-best or near-best move cannot display as zero purely on poor practical results — but that floor applies only in Engine mode (Smart/Practical blends may pull an engine-best move down on bad opponent-specific WDL), and low-sample caps still override the floor for tiny samples.
- [ ] Missing-engine fallback scores are capped so an absent or unrelated cloud move list cannot turn tiny WDL samples into confident top choices.
- [ ] Strength is scored from the full candidate pool, not just the visible top-N slice, and engine lookups are shared across panels by position, side, and line count.
- [ ] When local eval evidence shows a candidate's CP loss beyond the configured maximum drop, its strength is hard-capped so a practical spike cannot outrank a sound move.
- [ ] Cloud eval data is the authoritative engine list for strength when available; a public fallback eval service is used only when the primary has no usable result, and database tables prefer complete all-move fallback data when the primary list misses shown rows.
- [ ] Opponent-move rows detect when a strong-looking opponent move is defused by the user's saved reply (or by the opponent's usual next reply after it), showing a compact before/after score signal with a tooltip explaining the surface score, the saved-reply score, and the usual continuation; the signal stays deliberately thresholded and tied to saved prep lines.
- [ ] Candidate reply rows detect when the opponent's most common next reply is frequent enough and materially worse for them than the surface result, surfacing only meaningful reversals so ordinary rows stay compact.
- [ ] After-prep projection appears as its own sortable column beside the normal strength column, produced by the same strength scorer with the continuation's evidence substituted for the surface evidence so the two values stay comparable; the projected continuation is labeled compactly in the cell.
- [ ] Candidate-row after-prep means exactly: the source/opponent's most common reply to the displayed candidate, followed by the best prep-side answer scored with the active strength settings — never a "current value" fallback — and it is shown even when weaker than the candidate's surface strength, because the projected line value is the point of the column.
- [ ] Opponent-branch after-prep does not require a saved line: it projects the best available prep-side reply after each opponent move; saved-line impact takes precedence when present, but rows without a saved line still get a projection.
- [ ] The displayed projection is a line value from the prep side's perspective: a locally-best move in a bad future position is capped by the absolute future eval/WDL blend and cannot show a perfect score at the root.
- [ ] Projection engine evidence comes only from the local eval store; when local evals exist but the source database has no reply rows, engine-only candidates are synthesized with neutral WDL and low-confidence scoring; with no local coverage at all, a practical/database projection is shown instead of blanks or a repeated placeholder value.
- [ ] After-prep projection also works for general prep sources (broad and masters pools), on both common source-move rows and candidate rows, with tooltips describing the source side rather than a named opponent, under the same local-eval-only rule.
- [ ] Projections resolve progressively: a cheap immediate reply projection publishes per row as it resolves, a first pass scans only the next likely reply plus response for every visible row, and the deeper refinement runs only for a small strongest/most-common subset — so one slow row never freezes the table and missing values are never caused by a single blocked lookup.
- [ ] The prep builder first produces a compact game-plan brief: one principal route chosen from blended strength plus after-prep evidence, then the highest-alert opponent/source replies with the recommended answer, usage, surface danger, and projected after-prep score.
- [ ] Builder depth settings behave distinctly: short and normal runs expand only a focused reply set at opponent turns, deep mode keeps broad reply coverage, and the build queue is priority-led before depth-led so high-value continuations deepen sooner in quick pre-game runs.
- [ ] The maximum-CP-drop safety gate is hard-enforced in builder root move choice and in future prep-side reply selection; if every practical candidate violates the limit, the builder stops that branch instead of falling back to the least-bad unsafe move.
- [ ] Builder user-move selection prefers the projected after-prep score over static strength, with static strength used only when no projection is available.
- [ ] A coach-report action is visible beside the build action in the main prep controls; it runs its own bounded database/eval evidence pass from the prep root (it never requires a built tree or the builder's route selector), opens the game-plan panel, and auto-runs the report.
- [ ] The coach-report evidence packet includes candidate lines with normal strength, WDL/game-share evidence, local-eval CP loss and its source, after-prep projection, and explicit safe/unsafe/no-answer status; engine-unsafe candidates may appear as evidence but the report is forbidden from recommending them.
- [ ] The visible report output is the natural-language coach answer first, with the candidate evidence grid collapsed as supporting material; the report always uses the stronger reasoning model tier, never the fast planner tier.
- [ ] When the report starts from an opponent-to-move position, ranking is two-stage: the opponent's first move is chosen by reach/share (rare first moves below the important-reply threshold stay evidence-only regardless of projection), and only then is the reply chosen by projected after-prep before static strength — so a rare first move cannot displace an overwhelmingly common one, and the main branch reply follows the better projection.
- [ ] A straight-line finder searches engine-approved user replies where each opponent move meets a high forced-play-rate threshold and the final position is objectively bad for the opponent; found lines can be played onto the board for immediate analysis.
- [ ] The default venom mode treats repeated opponent choices as habits, scores reach probability, and evaluates the actual position reached after the habitual opponent move for the user's side; a strict high-threshold mode remains available; when engine sources return no user replies, candidate moves fall back to the selected opponent database so prep as Black can still reach a first forced reply.
- [ ] Opponent research supports per-player folders and databases, OTB vs. online source separation, event-level database organization by player, and combined source PGNs kept beside converted databases.
- [ ] Canonical player-name audits detect split identities across name orderings, normalize game tags and titles to the canonical form, merge duplicate player records into one, refresh stale search indexes, and repeat until zero splits remain for every prep target.
- [ ] Duplicate game detection and dedupe run across source folders, combined PGNs, and databases, with removed copies preserved in timestamped backups and independent duplicate verification possible after cleanup.
- [ ] Converter-skipped malformed, empty, or incomplete source games are counted and reported (source count vs. converted count) rather than hidden, and the latest imported game date is reported per prep target.
- [ ] Online account research spans Chess.com, Lichess, World Chess / FIDE Online Arena, public broadcast and event archives, club-membership clues, rating plausibility, and federation identity pages, with each candidate account assigned an explicit confidence label before import.
- [ ] Imported account openings are compared against the OTB/broadcast prep set before final confidence; clear repertoire mismatches are rejected and their imports deleted; stale or terms-flagged accounts are labeled honestly without asserting unverified reasons.

## 7. AI Coach

- [ ] Coach runs through a local AI CLI/model bridge for personal use: no credentials are stored in the app, and the bridge is never exposed from a public or server deployment.
- [ ] Coach lives as a right-side tab with an under-board shortcut that selects it; the UI is a small chat transcript with a persistent input at the bottom.
- [ ] The input starts blank; Enter sends, Shift+Enter inserts a newline, and empty submissions are blocked.
- [ ] Requests show staged progress with elapsed time per real backend phase (validation, planning, engine evidence, answering, repair), labeled as pipeline progress rather than model reasoning, and each phase is traceable for debugging hangs.
- [ ] A two-stage model pipeline runs each question: a fast planner selects context scope and requests targeted engine lines up front, and a stronger model produces the final answer from all gathered evidence in one prompt; the final model cannot request further engine work (such requests are rejected).
- [ ] Planner failures (timeout or malformed output) fall back to deterministic scope and evidence heuristics instead of aborting the answer.
- [ ] Evidence packets include legal moves, deterministic position facts, the current-line PGN up to the selected position, prior targeted engine results for the same position, and a broad public opening table (move counts, WDL, blended strength) labeled as practical/popularity evidence only — the engine remains the source of tactical and evaluation truth.
- [ ] PGN sent to models is plain mainline movetext only: no comments, NAGs, arrows, or variations, so private notes cannot seed unsupported claims.
- [ ] A deterministic board-fact phase (position facts, legal moves, square/move/line facts) is the source of truth for legality, attackers, defenders, hanging pieces, checks, and threats; the models may never infer current-board facts from visual memory, PGN context, or general knowledge.
- [ ] The baseline fact payload stays low-noise (status, legal moves/captures, checks); global attacked/hanging inventories are not exposed in the final prompt, and any loose-piece claim must be grounded through targeted facts plus an engine line that actually exploits it.
- [ ] Facts are invisible scaffolding: final answers never mention tools, supplied facts, private checks, or verification machinery.
- [ ] Interactive engine-line citations are validated: each must be legal from the live position and prefix-match supplied engine data; invalid wrappers get a repair pass, then an audit pass, and are finally demoted to plain text or replaced with an explicit removed-line placeholder — a bad line can never surface a raw error or break the answer UI.
- [ ] Equivalent castling encodings (standard vs. king-takes-rook style) are accepted during line validation so correct lines are not rejected on notation differences.
- [ ] Clickable lines and inline move mentions anchor to the response's intended base position, not the live board cursor: full-game prefixes are trimmed, numbered moves anchor alternatives at the correct ply, adjacent move sequences chain from their prefix, a repeated anchor move reuses the existing click target, and unresolvable mentions stay plain text instead of guessing.
- [ ] Clicking an interactive line creates or navigates to a variation in the game tree from the position where the question was asked.
- [ ] Scope selection works from natural language: whole-game requests ("review this game") select whole-game scope; in that scope, root-position engine lines and opening statistics are excluded from the evidence, and answers must not drift into move-one opening advice.
- [ ] Whole-game reviews gather both the refutation of each played mistake and the better line from the same pre-move position, so answers explain what should have been played and why it was better.
- [ ] Targeted engine requests are validated against an anchor allowlist: the live position, critical pre-move positions from stored game analysis, and supplied reference positions — including when the board cursor sits elsewhere (for example at the game start while the question references a mid-game move).
- [ ] Questions naming a specific move stay anchored to that move: evidence filters to that move and nearby plies, and unrelated later mistakes stay out unless they are direct alternatives, continuations, or necessary causal context.
- [ ] Phase-scoped questions (opening/middlegame/endgame review) filter stored analysis and prior targeted evidence to that phase and inject deterministic checks for the focused positions; when no annotated critical moments exist, representative game positions are used instead of leaving an evidence vacuum.
- [ ] Conversational follow-ups ("that line", "explain that better") reuse the most recent targeted evidence and discussed references instead of falling back to generic whole-game analysis.
- [ ] Question intent is classified (verdict, defensive-recovery, comparison, explanation, best-move, plan) and shapes the answer; recovery questions lead with the best practical try, a concrete continuation, and what to aim for next, mentioning the eval only briefly.
- [ ] Verdicts must be line-backed: calling a move a mistake, blunder, winning, or refuted requires a concrete supplied engine line with eval/depth, and the explanation must name the human mechanism (loose piece, overloaded defender, tempo, king exposure, weak square, pawn break, simplification, etc.) rather than only quoting numbers.
- [ ] For fixed-prefix targeted engine results, the first line is the verdict under best play for the requested prefix; alternative reply lines are never cited as the candidate move's own evaluation.
- [ ] Cloud evals are preferred as root evidence when available (they are usually deeper in openings); the local engine covers targeted checks at a raised default depth and remains the fallback.
- [ ] The coaching voice is concept-first teaching grounded in game-state explanation (candidates, threats, counterplay, structure, conversion technique); psychological attributions (fear, tilt, ego, time pressure, bias) are excluded unless the user explicitly asks.
- [ ] Answers render app-formatted: heading markers become bold section labels, emphasis and bullets normalize cleanly (including mismatched emphasis marks), and engine lines render as individually clickable move buttons.
- [ ] Local AI CLI authentication failures (login timeouts, empty output with an auth error only in logs) surface as clear unauthenticated-CLI errors, never as misleading empty-response failures.
- [ ] Illegal model requests or lines receive one correction/repair round; repeated unsupported output is rejected rather than validation being weakened, and the fail-closed final gate is never loosened.
- [ ] The coach interprets rather than recites: an engine PV plus eval is treated as evidence for an explanation, and any material-swing claim ("wins a piece", "wins the exchange") must match the supplied line's material summary.

## 8. Opening Review, Mistake Review and daily training

- [ ] Opening-review decks are saved as files (not browser-storage-only state) with create, merge-into-existing, delete, and open flows.
- [ ] Repertoire analysis lives inside the review area with two user-oriented modes: prepare against an opponent's repertoire, or find gaps in the user's own repertoire and games.
- [ ] Scans are orientation-aware, attributing positions to the side being prepared or reviewed; opening color grouping uses the source player's actual move side so inverted-perspective scans cannot misclassify an opening's color.
- [ ] Opening health prioritizes cards by frequency, recency, practical result gaps, and only large engine drops; date filters can restrict health scans to recent games.
- [ ] Candidate cards are validated against engine/cloud evidence with visible confidence and source: a fast bulk source for volume checks, a deeper source for urgent checks, and the local engine as an opt-in fallback.
- [ ] Validation hits and misses are cached across scans; validation progress survives leaving and returning to the tab; updates apply in batches; and the scan can complete after the bulk pass while slower validation continues in the background.
- [ ] Card rows show source, depth, evidence, priority messaging, and post-attempt review evidence explaining why the expected move matters (game, result, and engine context).
- [ ] Cards can be edited, deleted, or given a direct correct-move override; whole decks and individual cards are deletable with clear confirmation; older cards with generic validation-source labels remain compatible.
- [ ] Daily review builds a due queue with visible daily progress; full-deck and focused practice (by opening, color, or date range) remain available.
- [ ] The opening stats view shows cached opening names, summary bars respecting result perspective, an explicit active filter scope, compact hover-detail rows for plan gaps and best/worst openings, and a per-opening practice launch.
- [ ] Review cards preserve comments, arrows, annotations, board-played move overrides, trainer attempts, and post-attempt exploration as saved review-tree data.
- [ ] Mistake scans analyze games for errors and save them as SRS cards; local database/PGN scans and selected-online-game scans both create standard review decks.
- [ ] Mistake scan settings include a single engine pass or layered fast/deep confirmation, severity filters, win-probability drop thresholds, and time-control filters.
- [ ] Mistake decks record source-game metadata, player-database information, last-seen text, and latest additions.
- [ ] Phase training focuses mistake categories with per-session progress.
- [ ] Reveal controls, optional auto-reveal arrows, post-attempt summaries, and game context make training transparent after the attempt — but the saved answer is never shown before the attempt in hidden-answer mode (no pre-attempt answer panel, and summaries hide best-move text until attempt or explicit reveal).
- [ ] Post-attempt board play stays enabled in the review surface so users can explore continuations while feedback remains visible; starting a new card clears stale reveal/free-play state so the answer move is scored and the SRS panel appears.
- [ ] Cards preserve and hydrate the source-game move line up to the mistake position, show it in the moves panel, and support normal back/forward navigation once the answer is visible.
- [ ] Long-think (time-management) training has a per-deck threshold setting; trainer counts, position filters, and future auto-updates use the current threshold with clock-data safety, and repeated long-think evidence for the same position dedupes into one SRS item (scheduled copies suppress fresh duplicates; attempted-today duplicates are skipped; the ready count reflects the deduped queue).
- [ ] Focused batches (long-think, phase, type) respect SRS readiness: unseen or due cards come first, and cards just reviewed and scheduled for a future day are not resurfaced in the same session.
- [ ] Board attempts are keyed to the active practice session rather than the currently selected panel, so checking analysis or moves mid-card does not break attempt scoring.
- [ ] Daily goals count completed opening-review and mistake-review cards from any trainer entry point (including focused and long-think sessions), sync after auto-updates, and stay stable across session transitions.
- [ ] Trainers hydrate saved practice trees and persist attempted moves and annotations back to the deck, with saves deferred and coalesced to idle time and session boundaries so card transitions stay fast and nothing is lost at stop, completion, or exit.
- [ ] Hidden-answer card transitions load the target position first; heavy hydration, fresh classification, and summary refreshes wait until feedback is visible, and idle prewarming never parses full saved move sequences while the user is actively solving.
- [ ] Large decks stay responsive: position lookup via a prebuilt index, lazy practice queues advanced by cursor without per-card array copies, bounded prewarming, reveal countdowns updating at most once per second, and summary snapshots frozen during practice then refreshed at idle.
- [ ] The interactive engine stays paused while a hidden-answer card is waiting and re-enables at reveal or when analysis-capable panels open; engine listeners stay alive on panels that render engine controls so reveal-time enabling works without switching tabs.
- [ ] Review action count badges keep stable non-shrinking widths so multi-digit daily and time-management counts stay readable beside long labels.
- [ ] Deck auto-updates from linked online databases run outside active practice and re-resolve moved databases by online identity (see section 5).

## 9. Puzzle, practice bot, and blindfold modes

- [ ] Puzzle source databases open read-only; user progress lives in a separate store keyed by a stable fingerprint of the puzzle database, so different source snapshots never mix statistics.
- [ ] The training surface shows puzzle Elo, database accuracy, due/mastered counts, the selection reason, SRS state, current puzzle themes, and the Elo delta after each attempt.
- [ ] A stats surface shows Elo plus volume/accuracy trends and per-theme skill/weakness rankings; theme rows update immediately from a recorded attempt and are then reconciled by the full refresh.
- [ ] An SRS surface exposes due counts, the next review queue, reset, refresh, and progress export controls.
- [ ] Two user-facing training modes: a smart mode (due reviews first, then weak-theme balancing, then rating fit — ignoring manual filters) and a manual mode (theme plus rating range); both record every solve, miss, hint, and solution view as rated attempts through the same Elo model.
- [ ] Empty filter combinations broaden progressively (rating-only, broad theme, then any puzzle) before surfacing an error; switching puzzle databases clears the active session puzzle so stale ids are never recorded into the new database.
- [ ] When the previously selected puzzle database is missing, an available one is auto-selected and the first trainer card auto-loads; explicit, clearly visible start/next controls exist (no tiny icon-only affordance).
- [ ] Completion feedback is optimistic and local-first: the solve timer freezes and the result panel appears before persistence completes, the backend result merges in afterwards, and selection-reason banners hide once a card is complete so they cannot mask feedback.
- [ ] Elo displays with one decimal place plus a signed whole-number last change, and stale progress-refresh responses are ignored so an older dashboard fetch can never overwrite a fresher attempt result.
- [ ] Attempts record for any valid numeric puzzle id including zero; failed or skipped writes clear the transient saving state and surface an error instead of pretending the update is in flight; stuck unrecorded attempts retry after a reload.
- [ ] Explicit start-training and stop-training controls own the solve timer (stop clears timing, start resumes for the current incomplete puzzle or loads the first one).
- [ ] Next-puzzle is latency-tolerant: one matching candidate stays prefetched per active configuration and is consumed instantly, with the following card warmed in the background; due-card modes avoid prefetching a duplicate of the incomplete due card; random selection avoids full-database shuffles so large databases respond in constant time.
- [ ] Invalid or stale puzzle database selections produce a clear user-facing message; read-only opening prevents silently creating empty database files.
- [ ] SRS scheduling is attempt-quality aware: failed cards return in minutes, assisted cards next day, hard solves use a short ladder, solid solves a normal ladder, and fluent first-time solves graduate straight to mastered; the last quality grade is visible in feedback and the review queue.
- [ ] Completed puzzle attempts automatically increment the puzzle daily goal without a manual progress action.
- [ ] A blindfold tactics mode uses the same puzzle data and solution mechanics with an entirely separate progress namespace and Elo; it shows the board non-draggable for a configurable preview time, then covers it with an opaque overlay; solving happens via legal-move buttons or manual SAN entry, and correct moves auto-play the puzzle reply with its SAN shown prominently.
- [ ] Puzzles offer a bot-practice entry point, and the play setup can use a trainer profile instead of a manually configured engine.
- [ ] Managed human-like opponent support installs and configures a neural opponent stack (such as LC0 with Maia weights) automatically where supported, when the setup opens or a game starts.
- [ ] Trainer strength is chosen as a FIDE-style rating and mapped to the appropriate backend; a standard engine covers strengths above the human-model range.
- [ ] Bot clock pacing and per-move delay feel like a real opponent; trainer settings cover bot kind, rating, time usage, and time control.
- [ ] A blindfold play trainer launches from home or the board rail, reuses the normal game backend, hides/reveals the board with per-tab settings, and plays untimed games end to end.
- [ ] Blindfold setup is phased into settings, saved-game library, and position stages; it accepts pasted FENs for arbitrary starting positions; the opponent is a human-like-model-only profile with level selection and no silent fallback to another engine; the mode name stays generic with the opponent named separately.
- [ ] Move entry uses right-pane legal-SAN buttons or a manual SAN keypad whose action footer never clips off-panel; the under-board area remains the normal notation list plus navigation controls.
- [ ] The latest opponent move stays visible in a persistent prominent status panel until a newer move replaces it, sized so the move-entry controls below remain usable without scrolling.
- [ ] Live blindfold games auto-save into a dedicated library separate from normal files, can be exported explicitly as PGN, and reopen in hidden-board review; in-progress games are resumable, recreating the opponent from the saved position and moves while preserving the game's identity and marks.
- [ ] Players can mark lost-track positions; marks persist as trainer metadata and PGN comments and are jumpable revisit targets later.
- [ ] Library rows expand to inline previews (read-only board plus clickable mainline) before opening; opening a completed game jumps to the mainline end in blindfold review rather than a generic analysis tab.
- [ ] Board reveal is an explicit session state: once revealed, the board stays revealed through move navigation, mark jumps, and played moves until the user hides it again, with hide controls both in the panel and on the board, and the hidden cover fully opaque.
- [ ] The standard compact engine dock is available beneath the blindfold move-entry panel, following the same dock settings and evaluation lifecycle as other board workspaces, and the empty extra workspace pane is collapsed so the move-entry column uses the full height.

## 10. Plan Explorer, engine plans and pawn structures

- [ ] A plan exploration tab shows common piece routes and plans from the current position, sourced from local databases or the public Lichess pools.
- [ ] Rows group by piece with route counts, result bars, side filters, a ply-depth control, and the selected source; defaults are a modest ply depth and a capped automatic arrow count.
- [ ] Hovering a route previews its arrows; hovering a piece row previews that piece's most common maneuver; clicking a route pins its arrows; a modifier-click on a board piece draws that piece's normal route.
- [ ] Automatic plan arrows can be enabled per panel and globally, favoring significant piece maneuvers plus key pawn breaks and advanced pushes; castling always renders as castling, never as a king route through the rook's square.
- [ ] Fallback scans use depth-aware sample caps and cancel as soon as enough continuations are collected; repeated lookups are cached; side filters carry into the drawn arrows.
- [ ] A plans/setups view toggle exists; plan rows gain a blended score combining plan evidence with comparable practical results using the shared strength settings.
- [ ] Setups are mined as same-side multi-plan combinations observed in sampled games (branch-derived for online sources), representing real coordinated structures (for example a fianchetto system with its pawns, bishop, and castling) rather than tiny fragments; hovering a setup row previews the whole arrow family.
- [ ] Setup mining is generic co-occurrence with no hardcoded opening catalog: recurring seed routes become family keys, compatible supporting routes merge across multiple games, final rows must include at least one development or castling anchor plus a structural pawn, and support pawns alone can never define a row.
- [ ] Setup clustering groups by same-side pawn skeleton and merges compatible piece placements; conflicting destinations for the same piece slot or conflicting castling sides remain separate rows; merged rows keep per-route counts while the row count describes the whole compatible cluster.
- [ ] Setup rows describe plans from the current position forward only — never moves already played to reach it — and variants per family are capped so broad samples cannot wedge the panel in loading.
- [ ] Multiple seeds from the same game merge into one setup-family row before counting, so rows and game counts are not inflated.
- [ ] Setup rows carry evidence-grade verdict labels (observed, loose match, engine risk, verified); only the fully verified grade implies a recommendation, and coach explanations receive the same verdict context.
- [ ] Setup result bars match the database table design, with the scored side explicitly colored and labeled so black-side exploration never looks inverted.
- [ ] Interaction safety: hover previews suppress the automatic arrow set and temporarily hide pinned arrows (restored on leave); streaming refreshes never clear an active hover preview; empty final engine payloads clear the analyzing state; a watchdog stops stale strength requests; side and view changes participate in request identity, stop stale requests, and clear stale previews; and switching sides updates the filter immediately with visible per-side row counts.
- [ ] An engine-plans tab derives plan-like continuations from live engine analysis, with automatic board arrows.
- [ ] Engine setups are engine-only: mined from same-side signals co-occurring in engine PVs and scored from PV support, top-line presence, confidence, and supporting evals — with no database/practical input; quiet setup pawns and fianchetto bishop destinations count as plan signals.
- [ ] Root-position anchors (existing pawn structures, developed minor pieces, completed castling) participate in setup recognition and naming so structures partly established before the current position are still recognized; anchors never draw as fake plan arrows in the plans table.
- [ ] Named setup archetypes require template-specific PV evidence; generic shared components (an already-developed knight, routine castling) can never create or inflate a named-template score, and template-completed setups are labeled as candidates with lower confidence than fully PV-backed setups.
- [ ] An optional practical overlay blends engine setup support with broad public-pool results for matching setup families, preserving the pool's saved filters but clearing any player-specific filter; unmatched rows explicitly say no match rather than inventing stats, and the overlay runs only with a saved account token.
- [ ] Engine plan/setup rows show one combined engine-strength value (approval, PV support count, and CP-loss context versus the strongest root line) rather than competing strength columns.
- [ ] Plan and engine-plan rows offer inline coach explanations through the local AI bridge on the fast model tier; requests carry all available evidence (route/setup summaries, practical stats where present, engine support/eval/PV evidence, and an explicit note when database stats are absent), and named structures are used only when the supplied evidence justifies the label.
- [ ] A curated catalog of roughly 28 named pawn structures are first-class detection targets, detected from the pawn skeleton alone.
- [ ] Detection supports color reversal for every template and file mirroring only where the structure allows it; required features act as weighted confidence signals while anchor pawns and forbidden conflicts keep matches conservative.
- [ ] Every detection returns confidence, side roles, evidence, and typical pawn-break plans where known.
- [ ] Overlapping sibling structures are disambiguated by calibrated rules (exchange-defined subtypes, bind vs. sibling shells, family-signal weighting, strict file requirements for majority endgames); when a key signal is missing, confidence drops and the gap shows as evidence rather than the label overclaiming.
- [ ] Whole-game trajectory analysis groups consecutive structures, suppresses one-ply flicker, identifies transitions, selects primary and secondary structures, and writes a compact structural story.
- [ ] A structures tab shows the current-position label, confidence, role text, evidence, the game's primary/secondary structures, a segment timeline, and transition moves; clicking a segment jumps to the first move of that structural phase.

## 11. Phone/web companion and hosted library

- [ ] The companion runs in plain browsers as a PWA with no desktop-runtime imports on the browser path; desktop builds still load the full app; the site is installable with offline-capable shell behavior.
- [ ] The phone workspace is board-first: a mobile board with a compact under-board panel switching between moves, database, prep, and engine; a single row of board action buttons is the only mode selector, and panel content starts directly beneath them to preserve board space.
- [ ] PGNs import through the browser file picker into browser-side storage and behave as local databases; files and database views browse games and player summaries and export PGNs.
- [ ] Board interaction: tap-to-move is the primary reliable input; compact previous/next controls sit under the board; horizontal empty-board swipes navigate one move (gestures starting on pieces are protected for dragging); vertical swipes scroll the page even when starting on the board.
- [ ] The board initializes once and updates in place (no rebuild per move), and engine scores normalize to a fixed perspective at parse time so the sign does not flip every ply.
- [ ] Layout clamps to phone viewports with no sideways scroll anywhere (shell, files, tables); long names truncate inside rows; the header compresses to a single sticky row on narrow screens; controls use short visible labels with full accessible labels.
- [ ] A hosted static library mirrors selected PGN/PDF files and generated database exports to a published site with a manifest and per-position indexes, so the phone works while the desktop is off; a live desktop filesystem bridge is explicitly not the phone product path.
- [ ] Publishing is a single command/step that regenerates the library, builds the site, and commits/pushes only when content actually changed; the manifest preserves its generation timestamp when files are unchanged so periodic safety syncs stay no-ops.
- [ ] A background desktop watcher observes the relevant document and database folders, debounces changes, performs periodic safety syncs, and tolerates transient filesystem errors during cleanup with retries.
- [ ] Local databases publish as chunked PGN export folders with caching, a default size cap that skips huge reference databases, an option to skip database exports entirely, and an export root that defaults to the desktop app's database directory with explicit overrides for custom or multi-root publishes; stale imports from older multi-root publishes disappear from the pickers once the current manifest loads.
- [ ] Generated database exports include static per-position indexes so the phone can lazy-load only the current position's stats (with blended-strength cloud enhancement) without importing entire chunk sets; lazy sources intentionally omit full game samples and whole-database filters until a dedicated mechanism exists.
- [ ] Desktop file pins mirror into the hosted manifest so pinned entries float first in the phone's hosted file lists with a compact pin marker.
- [ ] The phone files surface browses hosted files and indexed PGNs with dense file-browser-style rows and can load PGNs and PDFs from the published library.
- [ ] Phone database sources are explicit — local browser databases, hosted database folders, and the public Lichess pools (all games and masters) — with one active database at a time (no multi-select), matching the desktop comparison model.
- [ ] Public pool access uses a browser OAuth sign-in with the token persisted; saved access renders as linked with relink/forget controls instead of prompting on every use, and anonymous explorer access is never assumed to work.
- [ ] Explorer filters persist and are shared across the database and prep panels: time controls, rating buckets, since/until ranges, player-plus-color (using the player-scoped endpoint), and move count, with year ranges for the masters pool.
- [ ] A stats sort menu (most/fewest played, recent/oldest, score, move) plus a visible match count persists in browser storage and orders both local and online stats.
- [ ] Local perspective controls: a persisted username field with a color selector relabeled as that player's side; move stats and game samples filter to that single player and color, and empty states name the exact filtered scope so it is clear which source loaded.
- [ ] Local date and result filters apply to both move stats and sample games, and the panel organizes into stats, games, and options subviews.
- [ ] The database panel has a setup/started split: setup keeps source/view/sort controls behind a start action, started mode shows only move rows with a small exit back to settings, and compact sort dropdowns stay available after starting.
- [ ] The shared source picker drills into folders, supports search, shows loaded/not-loaded state with counts and sizes, and imports a hosted database folder on selection without loading its first game onto the board; folder import is limited to folders that directly contain games so broad parents are browsed, not imported.
- [ ] Selecting a hosted database reuses the already-indexed local copy when current instead of re-downloading; only new, stale, or missing copies import, with visible loaded/total progress so large imports look alive.
- [ ] Re-importing a hosted database replaces the older copy at the same hosted path, rewires prep sources and board game origins to the fresh copy, and removes stale duplicates; newer published folders are labeled as having an update and auto-refresh when selected.
- [ ] Local source choices persist by stable hosted path (older raw identifiers still accepted) so a refreshed database does not fall through to an unrelated first database, and an empty prep source list means no source, never all databases.
- [ ] Database and folder pinning plus manual row ordering persist in the picker and appear as quick-access rows (shared behavior with desktop); the picker resets its folder and search state on open/close, offers an open-current-folder shortcut worded so a folder is not mistaken for the selected source, and large lists scroll inside the dropdown.
- [ ] Loose files opened from the files surface are not selectable as databases — only explicit source databases, hosted folders, online sources, or the current unsaved prep source appear in the picker.
- [ ] Phone prep mirrors the desktop setup model: player/general target modes, a single prep-source picker with an online group, opponent color controls, a my-side selector in general mode, min-games and show-top settings, and an online import drawer with save-database, range-check, range/count, and import-and-use controls.
- [ ] Selecting an online pool as the prep source forces general mode and clears player-only fields; returning to player mode restores a local source; prep titles derive from the current mode and state rather than stale saved names.
- [ ] Phone prep has the same setup/training split with explicit start vs. start-here root actions, reset-to-root and clear-marks controls, a header showing the starting line, an away-from-prep-start status when the cursor is before the root, and cursor-aware branch detection matching desktop.
- [ ] Training actions (play-most-common-branch and done-and-advance) operate on the shared active-branch selection including opponent-to-move roots; header-level source-game jump and return-to-last-choice controls appear for active branches; prepared and skipped marks persist separately; started mode hides setup chrome so move rows sit directly under the board with a small exit control.
- [ ] Phone prep and database rows use a phone-native stacked layout (move/date/actions first, then compact strength, games, coverage, and result blocks) with inline WDL bars at the SAN level, and branch coverage uses the same graded labels as desktop for local and temporary sources.
- [ ] Strength parity on the phone: persisted mode/blend/max-CP-drop per workspace; blended strength for local and online rows via a browser-safe cloud-eval helper that reads root lines then child positions for missing candidates; opponent-turn strength is scored from the side making the move while the result perspective stays the user's; partial cloud coverage is not treated as a total engine loss; and low-sample WDL spikes cannot define baselines.
- [ ] Manual sorts in started mode are temporary to the current board position and reset to saved automatic defaults on navigation.
- [ ] Prep-drawer imports with saving off attach as an unsaved current-prep source that feeds the move table but stays out of the database list; with saving on, a normal browser database is created and attached as the single prep source.
- [ ] An under-board engine tab runs a browser WASM engine with persisted on/off, cloud, MultiPV, and depth settings using button steppers (never focus-stealing text inputs), tappable PV rows, and desktop-style panel anatomy: play/pause header, compact source/eval/depth summary, collapsed settings, progress strip, and inactive/error states.
- [ ] The phone engine surface is engine-first: no cloud-status chips or cloud API controls, and an enabled engine shows as running immediately rather than in a warm-up state; cloud evals may still appear while the local engine warms.
- [ ] Phone engine arrows mirror desktop behavior: a strong best-line arrow, pale close alternatives, win-chance filtering, and line-width thresholds.
- [ ] Phone moves preserve full PGN variation trees with comments and NAGs rendered inline; tapping a variation switches the board line while the panel keeps showing the original source tree; the board title stays source-oriented (file or database name, not the player pair).

## 12. Settings and preferences

- [ ] Appearance settings — board colors/design, piece sets, app theme, and sounds — are configurable and persist.
- [ ] Keyboard shortcuts are configurable.
- [ ] Training behavior settings (trainer thresholds, long-think threshold per deck, blindfold preview time) are exposed where the behavior lives and persist.
- [ ] Engine behavior and display settings — dock behavior, line count, depth, arrows, and per-engine options — are configurable.
- [ ] Default sources for database, comparison, prep, and plan panels save as preferences.
- [ ] Prep strength settings (mode, engine/practical blend, max CP drop) and builder settings persist as app settings, and per-workspace where designed.
- [ ] Switching to and from the alternative board style preserves the user's default appearance settings intact (the style is an override, not a rewrite).
- [ ] Layout preferences (panel sizes, docked panels, active under-board mode, setup/training page state) persist per tab or workspace.
- [ ] Phone/web preferences persist in browser storage independently of desktop settings.
- [ ] All persisted settings survive app restarts and version updates.
- [ ] The automatic plan-arrow amount is controllable per panel and globally.
- [ ] Sound volume is one global control honored by every sound package.
- [ ] Blindfold board-visibility settings apply per tab.
- [ ] Engine management and global app options remain first-class settings surfaces reachable from navigation.

## 13. Performance, safety and background jobs

- [ ] Every long-running search or scan carries a cancellable identity; navigating away or changing inputs cancels stale work, and stale results never overwrite fresher state — across database, comparison, plan, prep, engine, and cloud paths.
- [ ] Very large reference databases load and search progressively with sampling, caching, partial results, and bounded memory.
- [ ] Repeated identical remote or engine lookups are deduplicated in flight and cached afterwards (cloud evals, explorer stats, plan samples, validation checks).
- [ ] Scans return quick initial results while slower validation continues in the background and upgrades rows without blocking the UI.
- [ ] Auto-update work (online databases, review decks, hosted publishing) runs in the background with visible progress and never interrupts active practice or analysis.
- [ ] All import paths deduplicate; dedupe cleanups preserve removed copies in timestamped backups; independent duplicate verification is possible after every cleanup.
- [ ] Any conversion or import step that skips malformed, empty, or duplicate games reports the counts to the user rather than silently absorbing them.
- [ ] Engine-safety gates (maximum CP drop) are hard limits in builders and recommendations and are never silently bypassed in favor of a practical-looking line.
- [ ] Low-sample evidence is always handled explicitly: tiny samples are blended, capped, or labeled — never presented as confident conclusions.
- [ ] Source-confidence labels accompany all fallible evidence: account identity confidence, validation source, setup verdict grades, and partial cloud coverage.
- [ ] Watchdogs bound every external wait (engine first output, cloud requests, remote downloads, streaming strength requests), resolving to retry or a clear error rather than a hang.
- [ ] Persisted writes during interactive flows are deferred and coalesced (deck saves, SRS updates, progress writes) and flushed at safe boundaries so nothing is lost at stop, completion, or exit.
- [ ] Failed writes clear optimistic UI states and surface an error instead of pretending success.
- [ ] Caches are keyed by every input that changes results (source, side, view, filters) so toggling views can never serve wrong cached data.
- [ ] Rebuilds of long-lived stores (local eval store, search indexes, hosted exports) keep the previous version usable until the new one completes.
- [ ] Heavy background jobs pace themselves so the interactive app stays responsive on modest hardware.
- [ ] Read-only inputs (puzzle sources, imported public dumps) are never mutated; progress and derived data write to separate stores.
- [ ] Interrupted background jobs (conversions, syncs, updates) leave recoverable state, and stale banners or markers are cleaned on the next run.
- [ ] All network consumers respect provider rate limits with throttling, spacing, and cooldowns.
- [ ] Long fetches keep progress visibly advancing so users can distinguish slow from stuck.

## 14. Reports and artifacts

- [ ] A one-click game report runs the local engine over the mainline and renders an in-panel report: eval chart, phase markers, inaccuracy/mistake/blunder counts per player, average centipawn loss, and an accuracy figure comparable to the popular public standard.
- [ ] The report's annotated PGN saves back to the game's origin (file or database), so reopening an analyzed game rebuilds the report without rerunning the engine.
- [ ] The report layout fits a laptop-height notation panel without routine scrolling (compact chart, short non-wrapping stat rows, both players' accuracy visible).
- [ ] Per-player style reports can be generated for prep targets — opening and result summaries, strengths, weaknesses, strategy notes, and engine-sampled evidence — output as PDFs stored beside the player's prep materials.
- [ ] Prep imports produce human-readable summary documents plus machine-readable sidecars recording sources, counts, date ranges, exclusions, and confidence decisions.
- [ ] Opening-comparison reports contrast an imported online account's repertoire with the OTB/broadcast prep set and record the resulting confidence decision, including notes such as faster online games being more experimental.
- [ ] Event-level layout/manifest documents describe how prep databases are organized per player and are updated whenever files move so they never point at removed locations.
- [ ] Rating trajectory and time-management reports are available where they fit the user's analysis workflow.
- [ ] Generated reports are browsable from the files library (with PDF preview), while intermediate render workspaces stay hidden.
- [ ] All generated artifacts are user data, clearly separated from shippable product assets.
- [ ] Report actions live beside the workflows they serve (notation header, prep controls), not in hidden diagnostic menus.
- [ ] Reports state their evidence sources (engine depth, database, sample sizes, filters) so conclusions are auditable.

## 15. Verification and migration

- [ ] Every rebuilt feature ships with behavior-level acceptance tests or written manual verification notes that prove parity without comparing source code.
- [ ] Import/export parity is verified with independently authored or permissively licensed PGN/FEN/database fixtures — never fixtures copied from the GPL fork.
- [ ] Database, review-deck, puzzle-progress, and hosted-library migrations are newly designed but cover the same user-data survival cases, including merging progress from a legacy storage location without duplicating attempts and ignoring legacy files left behind.
- [ ] A pre-release parity audit walks this full behavior inventory, marking each item implemented, intentionally redesigned, deferred with reason, or legally blocked.
- [ ] Local prompt/evaluation tooling, hidden test prompts, style-evaluation harnesses, and lesson artifacts are copied only after separate owner-authorship attestation.
- [ ] All shipped board, piece, and sound assets, branding, visual tokens, and product copy are original or rights-cleared.
- [ ] If a local cloud-eval store is kept, it uses fresh formats and naming, and format-version transitions keep older data readable while rebuilds run.
- [ ] External-service adapters (game providers, eval sources, arena platforms) pass a terms-of-service and rate-limit review before release.
- [ ] User data (decks, progress, prep databases, settings) survives app updates and reinstalls per documented migration cases.
- [ ] Independent verification of prep outputs is supported: duplicate checks, canonical-name audits, and source-vs-converted count reconciliation can be run against the produced databases.
- [ ] The safety and quality behaviors in this checklist (stale-request cancellation, dedupe, skipped-game reporting, engine-safety gates, low-sample handling, confidence labels) are explicitly test-covered, not incidental side effects.
- [ ] The rebuild targets behavioral parity, not pixel or code parity; every intentional redesign is documented with its rationale.
- [ ] Phone-facing changes are verified against the published-site flow (the publish pipeline succeeds end to end) before being reported as complete.
