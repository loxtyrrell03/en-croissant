# Proprietary Clean-Room Rebuild Plan

## 1. Executive Summary

The goal is to build a proprietary chess workstation inspired by general chess-GUI concepts: interactive board analysis, PGN/FEN handling, UCI engine analysis, local chess databases, repertoire work, study organization, and training workflows.

The GPL base of the current application must not be reused, translated, restructured, or mechanically adapted. However, the owner has attested on 2026-04-27 that everything committed to this repository during the past week is the owner's own code and assets. That owner-authored contribution set may be copied into the proprietary rebuild after it is isolated from the GPL base. This permission applies to the owner-owned delta, new owner-created files, and owner-created assets from the listed commits; it does not grant permission to copy unmodified GPL base code or third-party material with unclear rights.

Implementation agents should work from this plan, later specifications, and an owner-prepared reusable-delta bundle. They should not browse the old GPL repository as an implementation reference except for a controlled owner/provenance extraction pass.

This plan is not legal advice. Anything uncertain should be marked "needs manual/legal review" before commercial release.

## 2. Licence Hygiene Rules

### Clean-Room Boundary

- Build in a new repository with no copied source tree, no copied history, and no imported GPL base files.
- Copying is allowed only for the owner-attested reusable contribution set listed in this plan, preferably from an isolated export bundle rather than from the old repository.
- New files created entirely by the owner during the past-week range may be copied wholesale if they do not contain GPL-derived/generated material.
- For files that modify pre-existing GPL files, copy only the owner-authored hunks or re-express them in the new architecture; do not copy the surrounding GPL file wholesale.
- Write all other production code, tests, documentation, schemas, assets, and UI copy independently.
- Use behavior-level specifications, user stories, acceptance criteria, public protocols, and independently authored designs.
- Do not ask implementation agents to compare against, port from, or inspect the GPL repository once the proprietary implementation begins, except when using a reviewed owner-authored delta bundle.
- Keep a written design log explaining why major architecture, schema, UI, and dependency choices were made independently.

### Do Not Copy

The proprietary rebuild must not copy from the GPL base or from unowned material in the existing repository. The owner-attested past-week reusable contribution set is the only planned exception.

- Source files.
- Distinctive function, class, hook, command, type, component, or module names.
- Folder structure or route structure.
- Database schema, migrations, indexes, generated bindings, serialized index formats, or storage layouts.
- UI text, menu labels, tooltip wording, onboarding copy, empty-state copy, error messages, or translation strings.
- Assets, icons, logos, images, sounds, board themes, piece sets, screenshots, or generated media.
- CSS, theme files, layout measurements, visual tokens, or component styling.
- Test fixtures, expected-output files, PGN samples, database samples, benchmark inputs, or snapshots.
- Documentation text, README text, comments, issue templates, or contribution guides.
- Generated code derived from GPL files.
- Build scripts, packaging config, capability manifests, or launcher scripts.

Owner-authored files, code hunks, tests, docs, scripts, and assets from the past-week commit range may be copied only after provenance review confirms they are part of the owner's own contribution set and are not generated from GPL files unless the generated output is independently reproducible from owner-owned inputs.

### Behavior-Only Feature Descriptions

Features should be described by what a user can do and what result they receive, not how the GPL application implements it. Acceptable references include:

- "A user can import a PGN file and browse its games."
- "The board can show arrows when the user previews a candidate move."
- "A database view can aggregate win/draw/loss statistics for legal continuations."

Avoid descriptions such as:

- Exact internal data structures.
- Exact command names or generated API bindings.
- Exact table names or index encodings from the current app.
- Exact UI strings, component names, CSS class names, or translation keys.

### Owner-Attested Reusable Delta Exception

The owner has stated that all work committed during the past week is their own code. For this plan, the reusable contribution range is the commits observed since 2026-04-20 on branch `codex/en-croissant-fork`, which in practice are dated 2026-04-24 through 2026-04-27 and run from `42732755` through `6c9de0d8`, plus the documentation commit `4c34803e`.

Allowed reuse:

- Directly copy owner-created new files from that range when they do not include GPL-derived generated output or third-party assets with unclear rights.
- Directly copy owner-authored code hunks from modified files when the hunk can be separated from the surrounding GPL base.
- Directly copy owner-authored tests and fixtures from that range when the test data was independently authored or otherwise rights-cleared.
- Directly copy owner-authored documentation and prompt templates from this plan.
- Use owner-created screenshots and session artifacts as private design references; do not ship them as product assets unless their contents and rights are reviewed.

Required controls:

- Prepare a reusable-delta bundle from the commit range before implementation starts.
- Mark each copied item as `new owner file`, `owner hunk from modified GPL file`, `owner asset`, `owner test`, `generated from owner-owned input`, or `needs manual/legal review`.
- Do not copy unchanged GPL files just because they were touched nearby.
- Do not preserve old module paths, command names, schema names, or UI text unless they are generic or independently chosen.
- When extraction is hard to reason about, reimplement the behavior from the neutral spec instead of copying code.

## 3. Feature Inventory

Inspection basis: top-level metadata, public README-level product description, route and file names, current session change log, user-facing screenshots/artifacts, and the past-week commit log. No GPL implementation logic or source snippets were copied into this plan. The custom-feature classification below now treats the owner's past-week commits as an owner-attested reusable contribution set.

| Feature name for new spec | User-facing behaviour | Why it matters | Classification |
| --- | --- | --- | --- |
| Multi-tab chess workspace | Users can keep several boards, games, or workspaces open and switch between them. | Supports analysis sessions without losing context. | Baseline chess GUI functionality |
| Interactive chessboard | Users can view positions, drag pieces, step through moves, flip orientation, and enter moves. | Core of every chess workstation. | Baseline chess GUI functionality |
| Legal move and promotion handling | The board enforces chess rules and prompts for promotion choices when needed. | Prevents invalid analysis states and improves usability. | Baseline chess GUI functionality |
| Move history with variations | Users can navigate a main line and side lines, including comments and symbolic annotations. | Required for serious analysis, study, and PGN work. | Baseline chess GUI functionality |
| FEN input and export | Users can load, inspect, and share arbitrary chess positions. | Essential interoperability format. | Baseline chess GUI functionality |
| PGN import and export | Users can open game files, save analysis, and exchange games with other tools. | Core chess data workflow. | Baseline chess GUI functionality |
| Engine analysis | Users can run UCI engine analysis on the current position, see candidate lines, scores, and depth. | Central for modern chess analysis. | Baseline chess GUI functionality |
| Multi-engine configuration | Users can add, edit, select, and configure local UCI engines. | Lets power users use preferred engines and settings. | Baseline chess GUI functionality |
| Evaluation display | Users can see an evaluation indicator, best lines, and analysis changes while navigating. | Makes engine output readable during study. | Baseline chess GUI functionality |
| Engine logs and diagnostics | Users can inspect engine communication or failures when analysis does not work. | Helps troubleshoot local engine setup. | Baseline chess GUI functionality |
| Tablebase information | Users can see exact endgame information where a configured tablebase source is available. | Improves endgame accuracy. | Baseline chess GUI functionality |
| Local game databases | Users can create or open local collections of chess games. | Enables personal and reference database workflows. | Baseline chess GUI functionality |
| Game list browsing | Users can browse, sort, and open games from a database. | Makes large collections usable. | Baseline chess GUI functionality |
| Player and event browsing | Users can inspect players, events, tournaments, ratings, dates, and game counts. | Helps filter and understand database contents. | Baseline chess GUI functionality |
| Header search | Users can search games by metadata such as player, event, date, result, source, or time control. | Basic retrieval across large databases. | Baseline chess GUI functionality |
| Position search | Users can search for games that reach the current board position or a compatible pattern. | Key feature for opening research. | Baseline chess GUI functionality |
| Opening statistics | Users can see continuation moves from a position with game counts and results. | Converts a database into an opening explorer. | Baseline chess GUI functionality |
| Online opening sources | Users can consult public online opening statistics alongside local databases. | Provides quick reference when local data is incomplete. | Baseline chess GUI functionality |
| Account connections | Users can connect online chess accounts and view imported or summarized activity. | Integrates personal game history. | Baseline chess GUI functionality |
| Online game import | Users can import games by online username or account connection with progress feedback. | Reduces friction for building a personal database. | My added product-specific functionality |
| Automatic online database refresh | User-selected online sources can be refreshed after new games appear. | Keeps study material current. | My added product-specific functionality |
| Personal performance dashboard | Users can review results, ratings, openings, time controls, and date ranges from connected accounts. | Helps users understand their playing profile. | Baseline chess GUI functionality |
| File and study organizer | Users can organize game files, repertoires, studies, and folders inside the app. | Gives the app a project workspace feel. | Baseline chess GUI functionality |
| Repertoire creation | Users can build opening repertoires for white or black and store preferred lines. | Supports structured preparation. | Baseline chess GUI functionality |
| Repertoire practice | Users can train stored lines by playing moves on the board. | Converts preparation into recall practice. | Baseline chess GUI functionality |
| Spaced repetition scheduling | Practice items can be scheduled based on previous answers. | Increases training effectiveness over time. | Baseline chess GUI functionality |
| Puzzle solving | Users can add or solve tactical positions in a focused board workflow. | Useful adjacent chess training mode. | Unclear / needs manual review |
| Rich annotations | Users can attach comments, arrows, highlights, and evaluation notes to positions or moves. | Necessary for studies and review material. | Baseline chess GUI functionality |
| Board annotation tools near the board | Annotation controls remain immediately available during analysis. | Reduces friction for marking ideas. | My added product-specific functionality |
| Resizable analysis workspace | The board and side panels can be resized, with independently scrollable areas. | Improves comfort on different displays. | My added product-specific functionality |
| Side-by-side source comparison | Users can compare move statistics from two reference sources at the same position. | Speeds up opening research and source validation. | My added product-specific functionality |
| Saved default database sources | Users can choose preferred sources for database views and comparison slots. | Reduces repeated setup. | My added product-specific functionality |
| Hover move previews | Hovering a move row can draw temporary board arrows and clicking can load that move. | Makes tables easier to understand visually. | My added product-specific functionality |
| Strategic route exploration | Users can inspect common piece routes and pawn plans from sampled continuations. | Adds strategic context beyond first-move statistics. | My added product-specific functionality |
| Automatic strategic arrows | The app can overlay likely plans for the current side and position, with user control over amount. | Offers immediate visual guidance without opening another panel. | My added product-specific functionality |
| Board shortcut for piece route preview | Users can invoke a route preview for a specific piece from the board. | Makes plan discovery direct and tactile. | My added product-specific functionality |
| Repertoire gap scanner | Users can scan reference games against their repertoire to find missing or weak coverage. | Turns databases into targeted study tasks. | My added product-specific functionality |
| Opponent preparation scanner | Users can compare an opponent's games against their preparation and identify likely lines. | Supports practical tournament or online prep. | My added product-specific functionality |
| Own repertoire review scanner | Users can find places where their own games or repertoire show weak outcomes or missing answers. | Helps prioritize study time. | My added product-specific functionality |
| Cloud-assisted move validation | Candidate review items can be checked against cloud or local engine analysis and display confidence/source. | Reduces false positives in generated study tasks. | My added product-specific functionality |
| Background validation upgrades | A scan can show initial results quickly while slower validation continues in the background. | Keeps the UI responsive. | My added product-specific functionality |
| Opening review decks | Users can save generated opening tasks into named review decks. | Bridges analysis discovery and practice. | My added product-specific functionality |
| Review card editing | Users can delete cards, edit moves, override correct answers, and preserve notes/arrows. | Lets users curate generated material. | My added product-specific functionality |
| Post-attempt evidence | After practicing, users can see why the expected move matters, including game/result/engine context. | Makes review educational rather than binary. | My added product-specific functionality |
| Full-deck and scheduled practice | Users can practice all cards or due cards. | Supports both drilling and spaced repetition. | My added product-specific functionality |
| Long-running search cancellation | Leaving a database, comparison, or plan view cancels stale work and prevents old results from overwriting new context. | Important for large databases and app responsiveness. | My added product-specific functionality |
| Large database performance mode | Very large references can be searched, sampled, cached, and indexed progressively. | Required for master databases and power users. | My added product-specific functionality |
| Settings for board, pieces, theme, sound, shortcuts, and training thresholds | Users can customize appearance, input, audio, and training behavior. | Expected desktop app polish. | Baseline chess GUI functionality |
| Cross-platform packaging | Users can install and run the application as a desktop app. | Commercial distribution requirement. | Baseline chess GUI functionality |

## 4. My Added Features Preservation Plan

The following specifications preserve the desired behavior and identify owner-added code that may be copied into the proprietary rebuild when it comes from the owner-attested past-week contribution set. The "Current reference location" column is for private owner review and provenance extraction. Implementation agents in the fresh proprietary repo should use a reviewed reusable-delta bundle rather than browsing the old GPL repository.

### Past-Week Owner-Added Feature Map

The table below summarizes the work committed in the past week and which parts appear to be owner-added. "May copy" means copy the owner-authored code/assets/tests from the relevant commits after provenance review; it does not mean copy unmodified GPL base code surrounding a modified hunk.

| Owner-added feature area | User-facing feature added | Parts the owner added in the past-week commits | Reuse guidance |
| --- | --- | --- | --- |
| Fork/session scaffolding and safe launch helpers | Local fork identity, safer development launch, backup-oriented startup helpers, and session notes. | Package/app metadata changes, local launch scripts, fork icon asset, session changelog, verification artifacts. | May copy owner-created scripts/docs/assets after asset rights review; do not copy GPL packaging files wholesale. |
| Database comparison workspace | Compare two opening/reference sources for the same position. | Compare tab, side-by-side source panels, local and online source selection, compact opening tables, sorting, saved defaults, hover previews, click-to-load moves. | May copy owner-created comparison components/utilities or hunks; redesign route/module names in the new app. |
| Online opening/reference sources | Lichess All, Lichess Masters, and master-game style reference sources in research views. | Source adapters, option panels, source metadata, normalized source-selection behavior. | May copy owner-authored adapters only after API terms review; keep service terms/licence notes. |
| Database search performance | Faster exact-position lookup and more responsive large database behavior. | Position occurrence index work, mmap/cache behavior, cancellable request ids, stale request protection, large-database sampling caps, validation tolerance for displayable positions. | May copy owner-authored algorithms/hunks after separating them from old storage code; fresh schema/index names still required unless copied as owner-authored new files. |
| Plan Explorer | Show common piece routes and pawn plans from reference continuations. | Plan extraction, route grouping, side filters, ply controls, result summaries, hover previews, pinned arrows, auto arrows, keyboard/mouse board shortcut, online plan sources. | May copy owner-authored plan-explorer code/tests; consider renaming public APIs and UI labels for the proprietary product. |
| Engine plan exploration and move ranking | Use engine output or reference data to rank plans/moves and explain candidate choices. | Engine-plan panel, route/move ranking utilities, tests, integration with board overlays. | May copy owner-authored utilities and tests after isolating them from old panel infrastructure. |
| Repertoire gaps and opening health | Find missing or weak repertoire coverage from databases and online sources. | Gaps tab, scan controls, urgency scoring, orientation-aware attribution, date filters, engine/cloud validation metadata, bulk save, export/training actions. | May copy owner-created scanner code/hunks and tests; if old database commands are intertwined, rehost logic into fresh query services. |
| Opponent preparation and own-repertoire review | Analyze opponent games or personal games against preparation needs. | Two review modes, color-aware scans, result/recency/frequency prioritization, clearer evidence fields, saved review actions. | May copy owner-authored ranking and workflow code; write new UI copy for the proprietary app unless the copy is owner-confirmed original. |
| Opening Review workspace | Turn analysis findings into reviewable opening decks. | Home entry point, full review workspace, deck creation/merge/delete, card editing, correct-move overrides, saved notes/arrows/annotations, backward compatibility for owner-created cards. | May copy owner-created review workspace and utilities; new storage schema should remain freshly designed unless copied schema elements are verified owner-authored. |
| Opening Review practice | Practice saved cards with due/full-deck modes and post-attempt evidence. | Spaced-repetition practice, full-deck practice, attempt summaries, evidence after attempts, alternative-good-move feedback, review rating prompts, board-played move overrides. | May copy owner-authored practice logic/tests; verify scheduler dependency licence. |
| Mistake trainer workflow | Train from generated or imported mistakes in a board-first practice flow. | Mistake review training workflow, reveal controls, engine dock, keyboard shortcuts, game-context placement, playback/resizing fixes, attempt summary fixes, session screenshots/artifacts. | May copy owner-created trainer code and tests; screenshots should remain private design references unless cleared for product use. |
| Cloud and local engine validation | Combine fast cloud checks with local Stockfish analysis and fallback behavior. | ChessDB/Lichess cloud validation usage, Lichess cloud eval display in analysis, local Stockfish start without cloud delay, fallback restoration, UI contention reduction. | May copy owner-authored orchestration/hunks; respect API terms and do not bundle GPL engines without review. |
| Engine dock and shortcut UX | Keep engine controls available during practice/review without overloading the main panel. | Docked engine panel, extracted engine panel content, keyboard shortcut helper, shortcut hint integration. | May copy owner-created components; create original styling and labels in the new app. |
| Board overlays and responsive layout | More usable board, panels, and annotation workflow. | Resizable board/right-panel layout, responsive scaling, hidden resize handles, persistent annotation tools, transient overlay brushes, plan arrows, board settings. | May copy owner-authored layout/overlay code where separable; avoid copying old CSS/theme material. |
| Database/review polish and perspective fixes | More accurate result perspectives and evidence display. | WDL perspective fixes for black/side-to-move, move-side review boards, opening stat name caching, summary bars, saved database move evidence. | May copy owner-authored fixes/tests; use fresh UI copy and data labels. |
| Online game import and auto-update | Import online games into local databases and keep sources current. | Lichess/Chess.com username import, progress reporting, token reuse, auto-update metadata, shared online game source helpers. | May copy owner-authored import/update code after API terms review and token-storage redesign. |
| File organizer improvements | Better root drag behavior and deselection in the file/workspace browser. | Directory tree drag/deselect behavior and related CSS/UI hunks. | May copy owner-authored hunks if useful; fresh app should design its own workspace/file model. |
| Test coverage for custom features | Regression tests for plan exploration, opening health, move health, opening review, review practice, and mistake review. | Owner-created test files and expectations for the new feature set. | May copy tests when fixtures/expected data are owner-authored; otherwise rewrite cases from behavior. |
| Proprietary rebuild planning docs | Plan for a proprietary rebuild and implementation prompts. | This Markdown file and future plan updates. | May copy directly as owner-authored documentation. |

### Past-Week Commit Inventory

Observed commits since 2026-04-20 on `codex/en-croissant-fork`; the actual feature work in this range is dated 2026-04-24 through 2026-04-27.

| Commit | Date | Message | Owner-added feature/part |
| --- | --- | --- | --- |
| `42732755` | 2026-04-24 | Add plan explorer and database workflows | Initial Compare, Plan Explorer, Gaps, hover preview, local/online source, safe launch, and fork scaffolding work. |
| `2708253f` | 2026-04-24 | Optimize database position lookups | Position occurrence indexing and exact lookup acceleration. |
| `c7a74c3a` | 2026-04-24 | Keep large database indexes responsive | Large index cache and responsiveness improvements. |
| `adfd2c5f` | 2026-04-24 | Make plan explorer arrows responsive | Plan arrow request ownership and side-filter responsiveness. |
| `2b30a53d` | 2026-04-24 | Speed up plan explorer fallback scans | Sampling and cancellation improvements for fallback plan searches. |
| `cefd3880` | 2026-04-24 | Save analysis workspace improvements | Analysis layout, compare/database/plan UI polish, online import pieces, Lichess plan source support. |
| `d31d8bea` | 2026-04-25 | Add opening health review workflows | Opening health/gaps workflows, review workspace foundation, online auto-update, validation source handling, tests. |
| `4b328f86` | 2026-04-25 | Move repertoire analysis into review workspace | Review workspace entry point and relocation of repertoire analysis flow. |
| `02fed207` | 2026-04-25 | Show review line annotations in opening review | Display saved annotations inside review lines. |
| `3b3f3337` | 2026-04-25 | Add master game tools and engine move ranking | Master/reference game tools, engine ranking, and move-health utility work. |
| `6ea276bb` | 2026-04-25 | Add responsive panel scaling | Responsive board/panel scaling, engine plan explorer, repertoire copy, plan tests. |
| `eaeb9f25` | 2026-04-26 | Add mistake review training workflow | Mistake review utilities, practice flow, opening review expansion, tests, home/workspace integration. |
| `c26e0ea3` | 2026-04-26 | Add mistake trainer session artifacts | Playwright/session artifacts and screenshots for the mistake trainer workflow. |
| `e79ad5b0` | 2026-04-26 | Fix black opening stats result mapping | Result-perspective correction for black-side review evidence. |
| `b764521f` | 2026-04-26 | Ask for review rating on good alternatives | Practice feedback flow for acceptable alternative moves. |
| `eeb21a12` | 2026-04-26 | Show saved database move in review evidence | Evidence panel display of stored database move context. |
| `32316a1d` | 2026-04-26 | Clarify feedback for good review moves | More nuanced post-attempt feedback behavior. |
| `c752f55c` | 2026-04-26 | Add opening health date filters | Date filters for opening health/review scans and persistence. |
| `9acc5cf2` | 2026-04-26 | Fix opening health engine matching and bulk save | Engine matching and bulk-save behavior in opening health workflows. |
| `b360f4b5` | 2026-04-26 | Prefer saved engine best move in opening review | Prefer stored validated move during review practice. |
| `3c00cd9b` | 2026-04-26 | Cache opening stats names and add summary bars | Cached opening names and summary visualizations in review. |
| `a345e797` | 2026-04-26 | Fix opening review board orientation | Board orientation and move-side fixes in opening review. |
| `9eb61e47` | 2026-04-26 | Integrate Lichess cloud evals into analysis | Cloud eval source integration in the analysis display. |
| `97baa0f9` | 2026-04-26 | Fix opening review deck perspective | Deck perspective and color handling corrections. |
| `d9e9d485` | 2026-04-26 | Improve files root drag and deselect | File organizer drag and deselect polish. |
| `4aa7094d` | 2026-04-26 | Use move side for opening review boards | Move-side-aware review board setup. |
| `87c59061` | 2026-04-26 | Fix opening stats WDL perspective | WDL perspective utilities and tests. |
| `61db2e73` | 2026-04-27 | Avoid localStorage for review deck data | Review deck persistence state improvements. |
| `c6e77d74` | 2026-04-27 | Add mistake trainer reveal controls and engine dock | Reveal controls, docked engine panel, extracted analysis content, shortcuts. |
| `cce28d78` | 2026-04-27 | Merge engine shortcut hint into panel | Engine shortcut hint integration. |
| `919d15c9` | 2026-04-27 | Move mistake review game info below actions | Practice layout adjustment. |
| `1b64912a` | 2026-04-27 | Improve mistake trainer playback and resizing | Board playback, resizing controls, settings, and supporting backend command. |
| `42ea1570` | 2026-04-27 | Anchor mistake review game info at bottom | Practice layout anchoring. |
| `2e5515d8` | 2026-04-27 | Hide board resize handles | Board resize-handle visibility change. |
| `2b8d21e3` | 2026-04-27 | Fix mistake review attempt summary | Attempt summary correction. |
| `df0ae69b` | 2026-04-27 | Start local Stockfish without cloud delay | Local engine startup path separated from cloud delay. |
| `d07cf42d` | 2026-04-27 | Show engine plan auto arrows | Automatic engine/plan arrows and test coverage. |
| `8dca17e2` | 2026-04-27 | Restore Lichess cloud fallback for local engines | Cloud fallback behavior when local engine path is unavailable or delayed. |
| `4c34803e` | 2026-04-27 | Add proprietary rebuild plan | Initial rebuild plan documentation. |
| `6c9de0d8` | 2026-04-27 | Reduce Stockfish UI contention | Stockfish process/UI contention reduction. |

| Neutral feature | Behavioural specification | Current reference location |
| --- | --- | --- |
| Two-source opening comparison | User story: As a player researching an opening, I want two reference sources shown side by side for the same position so I can compare practical trends. Inputs: current position, source A, source B, filters, side to move. Outputs: two continuation tables with move, count, score distribution, sample games, and loading/error states. Expected UI behaviour: both sides update when the board position changes; each side can have independent source settings; hovering a continuation previews the move; selecting a continuation advances the board. Edge cases: one source unavailable, source returns no games, stale request finishes late, different transposition coverage, online rate limits. Data requirements: source descriptors, query filters, normalized continuation stats, request timestamps, cached recent responses. Acceptance criteria: two sources remain visually and logically distinct; results never cross-populate; old requests can be cancelled or ignored; empty and error states are clear. | `src/components/panels/database/DatabaseComparePanel.tsx`; `src/components/panels/compare/ComparePanel.tsx`; `src/utils/db.ts`; `src-tauri/src/db/search.rs`; `src-tauri/src/db/search_index.rs` |
| Saved reference source preferences | User story: As a frequent researcher, I want the app to remember my preferred database source for each research view. Inputs: selected source, per-view slot, local database identity, online source identity. Outputs: restored defaults on next session. Expected UI behaviour: changes persist without interrupting current analysis; missing sources fall back gracefully. Edge cases: deleted local database, offline online source, renamed database, invalid saved value. Data requirements: user preference records keyed by view and source slot. Acceptance criteria: preferences survive restart; missing choices are repaired with a visible fallback; no GPL storage keys or names are reused. | `src/state/atoms.ts`; `src/components/panels/database/*`; `src/components/settings/SettingsPage.tsx` |
| Move-row board previews | User story: As a user scanning move tables, I want a quick board preview before committing to a move. Inputs: current position, hovered candidate move, optional continuation. Outputs: temporary arrows/highlights; optional board advance on click. Expected UI behaviour: hover preview appears quickly and disappears when hover ends or context changes; click advances or loads the chosen move intentionally. Edge cases: illegal move due to stale position, touch devices without hover, multiple preview sources competing, hidden board. Data requirements: transient visual overlay separate from saved annotations. Acceptance criteria: previews never save as annotations unless explicitly requested; stale previews are cleared; keyboard/touch fallback exists. | `src/components/panels/database/OpeningsTable.tsx`; `src/components/panels/plan/PlanExplorerPanel.tsx`; `src/components/boards/Board.tsx`; `src/state/atoms.ts` |
| Strategic route exploration | User story: As an opening student, I want to see recurring piece routes and pawn plans from reference games after the current position. Inputs: current position, source, side filter, sample depth, minimum frequency, result filters. Outputs: grouped route list, counts, result summary, representative arrow path, sample continuations. Expected UI behaviour: route rows can be previewed, pinned, filtered by side, and limited for readability. Edge cases: few games, noisy transpositions, castling, promotions, captures changing piece identity, ambiguous piece routes, online source limits. Data requirements: sampled continuations, piece identity tracking, route aggregation, result statistics, cache entries. Acceptance criteria: results are explainable from sampled games; UI indicates sample size; routes are cancellable and do not block board use; route labels and algorithms are independently designed. | `src/components/panels/plan/PlanExplorerPanel.tsx`; `src/utils/planExplorer.ts`; `src/utils/lichess/planExplorer.ts`; `src-tauri/src/db/search_index.rs` |
| Automatic strategic arrows | User story: As a player analyzing a position, I want the board to optionally show the most common strategic routes without extra clicks. Inputs: current position, selected source, side, max arrow count, enabled flag. Outputs: visual arrows/highlights derived from recurring plans. Expected UI behaviour: user can toggle the overlay and tune the number of hints; overlays update with position and source changes. Edge cases: too many candidate arrows, low-confidence routes, overlapping arrows, rapid navigation, no database source. Data requirements: cached route summaries and user display preference. Acceptance criteria: overlay is optional, visually distinguishable from saved annotations, and never blocks manual annotation. | `src/components/panels/plan/PlanExplorerPanel.tsx`; `src/components/boards/Board.tsx`; `src/components/settings/SettingsPage.tsx`; `src/state/atoms.ts` |
| Piece-specific route shortcut | User story: As a board-first user, I want to ask what a selected piece usually does from this position. Inputs: current square, piece, current position, source, side. Outputs: one or more likely route arrows for that piece. Expected UI behaviour: shortcut invocation is discoverable through controls or help, works with mouse and keyboard, and clears predictably. Edge cases: selected piece absent after navigation, no data for piece, piece captured in sampled lines, mobile input. Data requirements: route data keyed by piece identity and start square. Acceptance criteria: shortcut returns only relevant routes; no saved annotation is created unless explicitly pinned. | `src/components/boards/Board.tsx`; `src/components/panels/plan/PlanExplorerPanel.tsx` |
| Repertoire gap scanner | User story: As a player maintaining a repertoire, I want the app to find common reference continuations that my repertoire does not cover. Inputs: repertoire, side, reference source, minimum games, depth, filters, optional engine validation. Outputs: ranked gap list with position, candidate move, evidence, priority, and action buttons. Expected UI behaviour: scan shows progress; results can be sorted, trained, exported, saved, or dismissed. Edge cases: repertoire transpositions, duplicate positions, ambiguous side ownership, huge databases, incomplete source metadata. Data requirements: repertoire tree, position normalization, source statistics, priority score, scan job state. Acceptance criteria: scan is orientation-aware; duplicate gaps merge; user can inspect evidence before saving; long scans are cancellable. | `src/components/panels/gaps/RepertoireGapsPanel.tsx`; `src/utils/openingMoveHealth.ts`; `src/utils/openingHealthDateFilter.ts`; `src-tauri/src/db/search.rs` |
| Opponent preparation scanner | User story: As a competitor, I want to compare an opponent's likely openings with my prepared responses. Inputs: opponent identity or imported games, target color, date range, minimum frequency, repertoire. Outputs: prioritized prep items showing likely opponent move, current coverage, and suggested next study step. Expected UI behaviour: scan separates prep-for-white and prep-for-black contexts; results explain frequency and recency. Edge cases: opponent has few games, color mix-ups, transpositions, old games dominating, multiple usernames. Data requirements: opponent game set, normalized positions, recency weighting, repertoire coverage map. Acceptance criteria: color attribution is correct; priority remains stable under refresh; user can save actionable items into review. | `src/utils/mistakeReview.ts`; `src/components/review/OpeningReviewWorkspace.tsx`; `src/components/panels/gaps/RepertoireGapsPanel.tsx` |
| Own repertoire weakness scanner | User story: As a player reviewing my own openings, I want the app to find lines where my practical results or move choices suggest study gaps. Inputs: own games, color, date range, result filters, repertoire, optional engine validation. Outputs: ranked review opportunities with evidence and next move suggestion. Expected UI behaviour: user can filter by color and urgency, inspect supporting games, edit the proposed answer, and save to review. Edge cases: low sample size, misleading blitz results, abandoned games, duplicates, positions outside repertoire. Data requirements: personal game database, result distribution, recency weights, repertoire match status, validation metadata. Acceptance criteria: low-confidence items are marked; user can override or delete; generated items preserve provenance without copying old schema. | `src/utils/openingMoveHealth.ts`; `src/utils/mistakeReview.ts`; `src/components/review/OpeningReviewWorkspace.tsx` |
| Cloud-assisted validation | User story: As a user receiving generated study tasks, I want suggested moves validated by independent analysis sources. Inputs: position, candidate move, source priority, depth/time limits, local-engine availability. Outputs: validation status, source label, depth or confidence, best move alternatives, error or timeout state. Expected UI behaviour: quick validation appears first; deeper checks can refine results later; source and confidence are visible. Edge cases: cloud miss, rate limits, inconsistent evaluations, local engine unavailable, tactical positions with unstable scores. Data requirements: validation request cache, per-source result metadata, expiry policy, rate-limit state. Acceptance criteria: app does not block the main scan on slow validation; repeated scans reuse cache; source failures do not erase unvalidated results. | `src/utils/chessdb/api.ts`; `src/utils/lichess/api.tsx`; `src/utils/analysisSource.ts`; `src/components/review/OpeningReviewWorkspace.tsx` |
| Background validation upgrades | User story: As a user running a long scan, I want usable results quickly while slower quality checks continue. Inputs: scan results, validation queue, concurrency limits. Outputs: initial result list plus incremental updates. Expected UI behaviour: progress remains visible when navigating away and back; rows update without jarring resorting unless user requests refresh. Edge cases: app shutdown, source cancellation, row deleted while validation pending, duplicate positions. Data requirements: job registry, queue state, stable result identifiers, cancellation tokens. Acceptance criteria: UI remains responsive; pending tasks stop when no longer relevant; validation updates do not resurrect deleted rows. | `src/utils/mistakeReviewAutoUpdate.ts`; `src/utils/openingReviewAutoUpdate.ts`; `src/components/review/OpeningReviewAutoUpdateBanner.tsx` |
| Opening review decks | User story: As a player, I want to save selected opening tasks into named decks and practice them later. Inputs: selected scan rows, deck name, merge or create choice, card metadata. Outputs: persistent deck with cards, scheduling state, annotations, and evidence. Expected UI behaviour: user can create, merge, open, rename, delete, and practice decks. Edge cases: duplicate cards, deleted source games, changed correct move, old card format, empty deck. Data requirements: deck records, card records, scheduling fields, position snapshots, evidence references, user notes. Acceptance criteria: deck operations are reversible or confirmed; duplicates are handled predictably; cards remain usable when source data is unavailable. | `src/utils/openingReview.ts`; `src/utils/openingReviewPractice.ts`; `src/components/review/OpeningReviewWorkspace.tsx`; `src/components/tabs/NewTabHome.tsx` |
| Review card editing and overrides | User story: As a learner, I want to correct generated material so the deck reflects my intended repertoire. Inputs: card, edited answer move, comments, arrows, annotation marks, delete command. Outputs: updated or removed card. Expected UI behaviour: edits are explicit, saved, and visible in later practice. Edge cases: illegal override, move not in current position, variation changed, concurrent auto-update, accidental delete. Data requirements: card version, user override flag, annotation payload, audit timestamp. Acceptance criteria: user overrides take precedence over generated suggestions; invalid moves are rejected with clear feedback; deletion does not leave due-review ghosts. | `src/components/review/OpeningReviewWorkspace.tsx`; `src/utils/openingReview.ts` |
| Post-attempt evidence | User story: As a learner, I want feedback after an attempt that explains the chosen answer using games, results, and analysis. Inputs: attempted move, expected move, card evidence, engine/cloud validation, sample games. Outputs: feedback panel with correctness, explanation data, and next actions. Expected UI behaviour: after a move, the board can show expected line and evidence; user can mark remembered state or edit card. Edge cases: move transposes, multiple acceptable moves, missing evidence, engine unavailable. Data requirements: attempt log, evidence snapshot, validation metadata, accepted alternative moves. Acceptance criteria: feedback distinguishes "wrong", "alternative", and "unvalidated"; evidence remains readable without old UI text. | `src/utils/openingReviewPractice.ts`; `src/components/review/OpeningReviewWorkspace.tsx` |
| Full-deck and scheduled practice modes | User story: As a user, I want to drill every card or only cards due under spaced repetition. Inputs: deck, mode, current date, scheduling algorithm settings. Outputs: ordered practice queue and updated scheduling results. Expected UI behaviour: user can start, pause, resume, and finish a session; progress is visible. Edge cases: empty due queue, all cards deleted mid-session, time-zone changes, repeated incorrect attempts. Data requirements: card scheduling state, session state, attempt records. Acceptance criteria: due mode and full-deck mode are clearly distinct; scheduling updates are deterministic and testable. | `src/utils/openingReviewPractice.ts`; `src/components/panels/practice/PracticePanel.tsx`; `src/components/review/OpeningReviewWorkspace.tsx` |
| Online game import and refresh | User story: As a player, I want to import games from online chess usernames and keep local databases updated. Inputs: service, username or linked account, date range, time controls, destination database, token where applicable. Outputs: imported games, progress events, skipped duplicate count, errors. Expected UI behaviour: long imports show progress and can be retried; authenticated sources reuse approved credentials. Edge cases: private profile, rate limit, service outage, duplicate games, interrupted import, username changes. Data requirements: source account, import cursor, game identity hash, destination database, error log. Acceptance criteria: duplicate imports are idempotent; progress survives transient failures; user can inspect import summary. | `src/utils/onlineGameImport.ts`; `src/utils/onlineDatabaseAutoUpdate.ts`; `src/utils/onlineGameSource.ts`; `src/utils/lichess/api.tsx`; `src/utils/chess.com/api.tsx` |
| Responsive large-database jobs | User story: As a database power user, I want large searches and indexing jobs to stay responsive and cancel stale work. Inputs: database, query, active view, request id, limits. Outputs: partial or final results, progress, cancellation status. Expected UI behaviour: switching position or view cancels stale work; progress follows the active request only. Edge cases: huge files, corrupt games, memory pressure, simultaneous comparison sources, stale cache. Data requirements: job ids, progress events, cache metadata, partial result buffers. Acceptance criteria: no stale result overwrites current view; app remains usable during indexing; oversized data uses bounded memory. | `src-tauri/src/db/search.rs`; `src-tauri/src/db/search_index.rs`; `src/components/panels/database/DatabaseLoader.tsx`; `src/utils/db.ts` |
| Board-focused analysis layout | User story: As an analyst, I want a resizable board and tool area that keeps annotations and analysis close at hand. Inputs: window size, panel sizes, selected tools, saved layout preference. Outputs: stable layout with board, notation, tools, and side panels. Expected UI behaviour: resizing persists; scrollable areas do not trap the board; annotation controls remain accessible. Edge cases: small displays, high DPI, many engine lines, keyboard navigation, reset layout. Data requirements: layout preference and panel visibility state. Acceptance criteria: layout adapts to laptop and desktop; controls do not overlap; saved layout is recoverable. | `src/components/tabs/BoardTab.tsx`; `src/components/boards/BoardAnalysis.tsx`; `src/components/common/ResponsivePanel.tsx`; `src/components/panels/annotation/AnnotationPanel.tsx` |

## 5. Proposed Fresh Architecture

The new architecture should be domain-first. UI components should consume application services and domain models rather than owning chess rules, persistence logic, or engine protocol state.

### App Shell

- Cross-platform desktop shell with a web UI front end and a local service back end.
- Workspace model: windows contain workspaces; workspaces contain boards, databases, studies, and training sessions.
- Command bus for user actions such as loading a PGN, starting analysis, importing games, or running a search.
- Event bus for domain events such as position changed, engine line updated, import progressed, or review card answered.
- Clear separation between persistent user data, transient UI state, and background job state.

### Chess Domain Layer

- Owns immutable position snapshots, move application, legal move generation, game tree navigation, clocks, and draw-state metadata.
- Defines public domain types independently: position, move, game tree, node, annotation, variation, clock state, and review item.
- Uses public chess rules as the source of truth, not any existing codebase.
- Provides deterministic tests from independently authored positions and public chess rules.

### Board and Presentation Layer

- Renders board state from domain snapshots.
- Keeps temporary overlays separate from saved annotations.
- Supports arrows, highlights, selected square, legal targets, last move, premove-style previews if later needed, and orientation.
- Uses original piece assets and theme assets created for the new product or permissively licensed assets verified before use.

### Engine/UCI Layer

- Talks to UCI engines through an independently designed adapter.
- Treats engines as external processes with lifecycle, cancellation, and analysis session boundaries.
- Normalizes output into engine-agnostic analysis lines.
- Does not assume Stockfish-specific behavior except behind optional capability flags.

### PGN/FEN Parser Layer

- Parses FEN, PGN headers, SAN moves, comments, NAGs, variations, clocks, and common nonstandard tags.
- Produces domain game trees and parse diagnostics.
- Keeps import tolerance configurable: strict mode for validation, lenient mode for large public PGN files.

### Database/Indexing Layer

- Stores canonical game records, participants, events, annotations, studies, and source metadata.
- Builds derived indexes in background jobs rather than during UI interactions.
- Keeps raw imported PGN or original metadata only when useful for export/audit.
- Version all storage formats and provide migrations from day one.

### Search/Query Layer

- Offers query services for header search, full-text search, position occurrence search, opening statistics, transpositions, and review generation.
- Uses cancellation tokens and stable request ids for every long-running query.
- Returns typed result objects with provenance and confidence metadata.

### Settings/Preferences Layer

- Stores user settings separately from chess data.
- Supports board appearance, piece set, sound, keybindings, engine defaults, database defaults, layout, import preferences, and training preferences.
- Provides schema versioning and safe defaults for missing or invalid preferences.

### Import/Export Layer

- Handles PGN, FEN, database import/export, study export, review deck export, and online service import.
- Performs deduplication using independently designed game identity fingerprints.
- Emits progress and diagnostics through job events.

### Optional Cloud/Account Layer

- Isolates service-specific code behind adapters.
- Supports account linking, token storage, rate limiting, import cursors, online opening data, cloud analysis, and service health.
- Each adapter must be reviewed for terms-of-service compliance and dependency licences.

## 6. Suggested Technology Stack

Use permissively licensed dependencies where possible. Verify licences at selection time and before release. Avoid GPL/AGPL dependencies unless deliberately chosen with legal review and a distribution strategy.

| Dependency or choice | Purpose | Licence to verify | Risk level | Possible alternative |
| --- | --- | --- | --- | --- |
| Tauri 2 | Desktop shell and native bridge | MIT or Apache-2.0 family, verify exact crates/plugins | Low | Neutralinojs, Electron with Node disabled, native Rust UI |
| Rust | Back-end service, indexing, engine process control | MIT or Apache-2.0 standard library/tooling ecosystem, verify crates | Low | Go, C#, Kotlin |
| TypeScript | Front-end application language | Apache-2.0 for TypeScript compiler, verify toolchain | Low | Pure JavaScript, Rust front end |
| React | Front-end UI framework | MIT, verify current package | Low | Solid, Svelte, Vue |
| Vite | Front-end build tooling | MIT, verify plugins | Low | Rsbuild, Rspack, custom bundler |
| SQLite | Embedded database | Public domain core; verify wrapper licences | Low | DuckDB, libSQL, PostgreSQL for server edition |
| sqlx or rusqlite | SQLite access from Rust | MIT or Apache-2.0 style, verify selected crate/version | Low | SeaQuery plus driver, direct SQLite C API |
| Tantivy | Full-text search and indexing | MIT, verify version | Low | SQLite FTS5, Meilisearch for server edition |
| Tokio | Async runtime | MIT, verify current version | Low | async-std, smol, synchronous worker pool |
| Serde | Serialization | MIT or Apache-2.0, verify | Low | postcard with permissive licence, custom serializers |
| reqwest | HTTP client | MIT or Apache-2.0, verify | Low | ureq, hyper, platform HTTP |
| zod | Front-end validation | MIT, verify | Low | valibot, arktype |
| Zustand or Redux Toolkit | Client state | MIT, verify | Low | Jotai, XState, custom event store |
| date-fns or Day.js | Date handling | MIT, verify | Low | Temporal polyfill |
| TipTap or ProseMirror stack | Rich comments and study notes | Verify exact package licences and extensions | Medium | Markdown-only editor, textarea with custom annotation syntax |
| Custom board renderer | Board UI and overlays | Owned by project | Low | A permissively licensed board component after legal review |
| Custom UCI adapter | Engine protocol | Owned by project, based on public UCI protocol | Low | Permissive UCI parser crate after legal review |
| chess.js | Rule validation in front end or tests | BSD-2-Clause, verify current package | Low | In-house chess rules, permissive Rust chess crate |
| Independently implemented Rust chess core | Back-end legal moves and normalization | Owned by project | Medium | Permissive crate after legal review |
| Stockfish as user-supplied external engine | Analysis engine | GPL-3.0 for Stockfish; high distribution risk if bundled | High | Do not bundle; let users configure engines; pursue commercial/licensed engine option; cloud engine adapter |
| Lichess/Chess.com public APIs | Online import and reference data | API terms, not just code licence, must be reviewed | Medium | Manual PGN import, user-provided files, other services |

Dependencies to avoid unless deliberately reviewed: GPL/AGPL chess UI components, GPL chess rule libraries, GPL UCI parsers, copied piece sets or board themes with unclear licences, sample databases with restrictive terms, and any dependency whose transitive licence is unknown.

## 7. Data Model Proposal

This is a fresh conceptual schema. Names and fields are provisional and must not be mapped mechanically to the existing GPL database.

| Area | Proposed records | Key fields and relationships |
| --- | --- | --- |
| Games | `game_record` | Stable id, source id, original import id, result, date, time control, variant, starting FEN if nonstandard, normalized PGN export snapshot, created/updated timestamps |
| Game participants | `game_participant` | Game id, color, player id, displayed name at game time, rating, title, team if applicable |
| Players | `person_identity` | Stable id, canonical display name, normalized search name, external account links, federation/country where user-provided or imported |
| Events | `event_record` | Stable id, name, site, start/end dates, event type, source-specific external id |
| Rounds | `round_record` | Event id, round label, board number, stage metadata |
| Sources | `game_source` | Local file, online service, manual entry, imported database, trust level, import cursor, licence/terms note |
| Positions | `position_key` | Normalized placement, side to move, castling rights, en-passant legality, rule counters where needed, variant |
| Position occurrences | `position_hit` | Position key, game id, move index, node path, side to move, next move, result from side perspective, source confidence |
| Opening stats cache | `continuation_stat` | Position key, source/filter hash, move, game count, win/draw/loss counts, rating/date summaries, generated timestamp |
| Comments | `annotation_note` | Game id or study id, node id, author, rich text or markdown body, created/updated timestamps |
| Visual annotations | `board_mark` | Node id or card id, mark type, from square, to square, color token, label, scope |
| Numeric annotations | `move_annotation` | Node id, symbolic annotation, custom tag, source, user-owned flag |
| Engine evaluations | `analysis_snapshot` | Position key, engine profile id, depth/time/nodes, multipv rank, score type/value, principal variation, generated timestamp |
| Engine profiles | `engine_profile` | Name, executable path or cloud adapter id, options, default limits, health status |
| Studies | `study_project` | Name, description, folder id, owner profile, created/updated timestamps |
| Study chapters | `study_chapter` | Study id, title, root game tree id, order, starting position |
| Repertoires | `repertoire_book` | Name, target color, training settings, folder id, created/updated timestamps |
| Repertoire lines | `repertoire_node` | Book id, parent id, position key, move, priority, user note, training flags |
| Review decks | `training_deck` | Name, source type, scheduling settings, created/updated timestamps |
| Review cards | `training_card` | Deck id, position key, expected move set, prompt side, evidence references, notes, visual annotations, schedule state |
| Attempts | `practice_attempt` | Card id, attempted move, result category, timestamp, response time, next due date, scheduler details |
| Tags | `tag_label` | Name, color, description, user-owned flag |
| Tag assignments | `tag_link` | Tag id, target type, target id |
| Folders | `workspace_folder` | Parent id, name, order, target type constraints |
| Import jobs | `import_job` | Source, destination, status, progress, errors, started/finished timestamps |
| Background jobs | `job_record` | Job type, request id, status, cancellation state, progress, user-visible summary |

Design notes:

- Store canonical game data separately from derived search indexes.
- Use independent migration files with new naming and versioning.
- Keep review/training data user-owned, even if generated from imported games.
- Preserve enough provenance to explain recommendations, but do not require source databases to remain mounted forever.
- Include privacy controls for online account identifiers and tokens.

## 8. Engine Integration Plan

### UCI Abstraction

- Define an `EngineAdapter` concept with implementations for local UCI processes, future cloud engines, and test doubles.
- Expose engine capabilities as data: supports MultiPV, supports Syzygy path option, supports threads/hash, supports managed skill/limit options, supports ponder, supports Chess960.
- Represent analysis as independent session objects tied to a position and cancellation token.

### Engine Lifecycle

- Register engine profiles with executable path, display name, option defaults, and health status.
- Validate an engine by launching it, completing UCI initialization, reading declared options, and shutting it down.
- Start engines lazily when analysis begins.
- Reuse a process only while compatible session settings remain active.
- Stop processes when leaving analysis views, changing incompatible settings, or closing the app.

### Position Updates

- Convert the domain game state to a UCI position command from either start position plus moves or a FEN plus continuation.
- Debounce rapid board navigation.
- Track a monotonically increasing session revision so stale engine lines are ignored.

### Analysis Sessions

- Support fixed depth, fixed time, infinite analysis, node limit, and mate search where engines support them.
- Represent each session with position key, engine profile, requested limits, multipv count, active status, and latest lines.
- Allow several engines only when the UI explicitly starts several sessions.

### MultiPV Handling

- Normalize each principal variation into rank, score, depth, seldepth, nodes, nps, time, hashfull, tablebase hits, and move list.
- Preserve score type: centipawn, mate, tablebase win/draw/loss, or unknown.
- Keep the previous line visible until superseded by a newer line from the same session revision.

### Cancellation

- Every analysis session has a cancellation token.
- Position changes cancel or supersede old analysis unless the user pinned the line.
- Engine stop commands and process termination are separate: try graceful stop first, then kill on timeout.

### Error Handling

- Detect missing executable, permission failure, unsupported binary, initialization timeout, malformed output, crash, and stuck process.
- Show user-level remediation without exposing raw protocol unless diagnostics are opened.
- Store recent diagnostics locally for support, with privacy controls.

### Engine Settings

- Separate profile-level defaults from per-session overrides.
- Validate numeric option ranges before sending to engine.
- Provide safe presets for CPU threads, hash, MultiPV, tablebase path, and analysis limits.

### Future Engines

- Keep cloud engines behind the same analysis result model.
- Allow non-Stockfish UCI engines by avoiding Stockfish-only assumptions in core session code.
- Treat GPL engines as external tools unless legal review approves bundling or distribution.

## 9. Board and Game Model Plan

### Board State

- Represent a board snapshot as: variant, piece placement, side to move, castling rights, en-passant status, halfmove clock, fullmove number, and derived check/checkmate/stalemate status.
- Use immutable snapshots for navigation and editing operations.
- Normalize positions into stable keys for caching and database search.

### Move History

- Store a game as a tree of nodes.
- Each node contains the move that reached it, resulting board snapshot key, parent id, child ids, metadata, and user annotations.
- The root node stores starting position and game-level metadata.

### Legal Moves

- Legal move generation belongs in the domain layer.
- UI may ask for legal targets, but cannot decide legality itself.
- Include special cases: castling, en passant, promotion, checks, insufficient material indicators, repetition tracking, and Chess960 only if supported.

### Variations

- Main line is an ordering choice, not a separate data structure.
- Sibling nodes are alternative continuations.
- Users can promote a variation, delete a branch, reorder continuations, or mark a branch as repertoire-only.

### Comments

- Comments attach to nodes, not raw move text.
- Support plain text first; rich text can be layered later with a separate storage representation.
- Keep generated explanations separate from user-authored notes.

### NAGs

- Store symbolic annotations as structured tags attached to nodes.
- Display mapping should be configurable and localized independently.
- Imported unknown NAGs should be preserved where possible.

### Clocks

- Clock data is optional per node.
- Preserve imported elapsed/remaining time when available.
- Training sessions can record response time separately from game clock data.

### Arrows and Highlights

- Use separate visual layers: saved annotation, temporary preview, engine line, strategic hint, last move, legal target.
- Every visual mark should include source, color token, and lifetime.
- Temporary overlays must be cleared automatically on context changes.

### Current Node Selection

- Current selection is UI state pointing to a game id and node id.
- Navigation commands move selection through the tree.
- Analysis, database queries, and training prompts subscribe to selected position changes through domain events.

## 10. Database/Search Plan

### Stage 1: MVP SQLite Game Storage

- Store imported and manually created games in SQLite.
- Persist game headers, participants, source information, and a normalized game tree blob or chapter record.
- Add schema versioning and migrations immediately.

### Stage 2: PGN Import

- Build an import job pipeline with progress events.
- Parse headers, moves, comments, NAGs, variations, clocks, and malformed-game diagnostics.
- Deduplicate games using an independently designed fingerprint based on normalized headers and moves.

### Stage 3: Header Search

- Index player names, event names, dates, results, ratings, time controls, and source fields.
- Provide paginated results and sorting.
- Keep filters composable and serializable for saved searches.

### Stage 4: Full-Text Search

- Add full-text search for comments, study notes, event names, and player names.
- Prefer SQLite FTS5 for MVP, with Tantivy as an option if advanced ranking is needed.

### Stage 5: Position Indexing

- Background job walks imported games and records normalized position occurrences.
- Store next move, ply, side perspective, result, rating/date summaries, and transposition-aware keys.
- Index updates should be incremental when new games are imported.

### Stage 6: Opening Explorer Statistics

- Query position occurrences for the current board position.
- Aggregate legal continuations with game counts, score distribution, average rating/date, and sample games.
- Support exact and transposition-aware modes as separate options.

### Stage 7: Large Database Performance

- Use batched imports, bounded memory, prepared statements, and background workers.
- Add partial results and cancellation for long queries.
- Add cache entries keyed by database, query, filters, and position key.
- Consider compressed sidecar indexes only after the SQLite model is profiled.

### Stage 8: Background Indexing Jobs

- Maintain a job table and in-memory scheduler.
- Allow pause/resume/cancel.
- Show progress for import, position indexing, statistics generation, and review scans.
- Ensure stale jobs cannot update inactive UI contexts incorrectly.

## 11. MVP Roadmap

### Phase 0: Repo Setup and Licence Hygiene

- Create a fresh repository with no copied GPL files or history.
- Add original README, licence, contribution policy, and clean-room notes.
- Add dependency licence tracking.
- Create original branding, icons, board theme, and placeholder assets.
- Document that implementation must not reference the old repository.

### Phase 1: Board + Game Model + FEN/PGN Basics

- Implement domain model for positions, legal moves, move tree, comments, NAGs, and visual annotations.
- Build an interactive board and notation panel.
- Add FEN load/export.
- Add basic PGN import/export with independent tests.

### Phase 2: Stockfish Analysis

- Implement a fresh UCI adapter.
- Add engine profile management for user-supplied engines.
- Show analysis lines, depth, score, and MultiPV.
- Add cancellation and process diagnostics.

### Phase 3: Local Database Import/Search

- Add SQLite storage, migrations, import jobs, and game list browsing.
- Add header search and pagination.
- Add position indexing and opening statistics.
- Add progress UI and cancellation for large imports.

### Phase 4: Annotations, Studies, and Repertoires

- Add study projects and chapters.
- Add repertoire books and line editing.
- Add basic repertoire practice with scheduling.
- Add export/import for studies and repertoires.

### Phase 5: Custom Product Features

- Add two-source opening comparison.
- Add strategic route exploration and board previews.
- Add repertoire gap and opponent preparation scanners.
- Add generated review decks with editing, evidence, and practice modes.
- Add online game import and refresh adapters after terms/licence review.

### Phase 6: Polish, Packaging, and Testing

- Add settings, shortcuts, themes, sounds, accessibility, and responsive layouts.
- Add crash recovery and backup/restore.
- Add packaging/signing for target platforms.
- Add performance benchmarks for large databases.
- Complete licence audit and manual/legal review.

## 12. Acceptance Criteria

### Product Acceptance Criteria

- Users can create and navigate chess games with legal move handling, variations, comments, NAGs, and visual annotations.
- Users can import/export FEN and PGN with useful diagnostics.
- Users can configure a user-supplied UCI engine and analyze positions with MultiPV, cancellation, and error handling.
- Users can import a local PGN database, search headers, open games, and view opening statistics for the current position.
- Users can create studies and repertoires, then practice stored lines.
- Custom features are available as independently implemented workflows: source comparison, strategic route exploration, gap scanning, review decks, online game import/refresh, and background validation.
- The app remains responsive during imports, indexing, engine analysis, and large database queries.
- The app can be packaged and installed on target platforms with original branding and assets.

### Licence Hygiene Acceptance Criteria

- The new repository has no copied GPL base source, file structure, generated code, schemas, migrations, fixtures, UI copy, comments, documentation, assets, or build scripts.
- Any copied material comes only from the owner-attested past-week reusable contribution set, from an audited delta bundle, with provenance notes.
- New owner-created files from the past-week range are identified separately from owner-authored hunks inside modified GPL files.
- Modified GPL files are not copied wholesale unless manual/legal review confirms the entire file is owner-owned or otherwise reusable.
- Implementation agents used only this plan, clean-room specs, public protocols/docs, and the approved owner-authored reusable-delta bundle, not the old GPL repository as an open-ended reference.
- All dependency licences are recorded, reviewed, and compatible with the intended proprietary distribution, or explicitly marked for legal review.
- GPL/AGPL dependencies and assets are absent unless deliberately approved with documented legal advice.
- Stockfish or other GPL engines are not bundled unless legally approved; user-supplied external engine configuration is preferred.
- UI text, icons, themes, sounds, and screenshots are original or permissively licensed with attribution where required.
- Database schema and index formats are newly designed and documented.
- Manual/legal review is complete before commercial release.

## 13. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Accidental GPL contamination | Proprietary release may be compromised. | Start fresh repo; remove old repo from active workspace; forbid source-level reference; keep clean-room design log; review diffs before release. |
| Over-reliance on old architecture | New app may be argued to be structurally derivative or inherit old limitations. | Use domain-first architecture in this plan; rename concepts where not generic; document independent alternatives considered. |
| Hidden copied UI text or assets | Licence and branding risk. | Create original copy deck, icons, themes, sounds, piece assets, and screenshots; audit translations and resource folders. |
| Distinctive names copied into APIs | Internal structure may reveal old implementation influence. | Use new names for modules, commands, types, state keys, generated bindings, and database tables. |
| GPL/AGPL dependency accidentally introduced | Distribution obligations may conflict with proprietary goal. | Use licence scanner; require dependency approval; avoid GPL/AGPL unless manually/legal reviewed. |
| Stockfish distribution complexity | Bundling GPL engine may trigger obligations. | Prefer user-supplied engine path; document optional external integration; obtain legal advice before bundling any engine. |
| Online service terms violation | Imports or cloud lookups may breach provider terms. | Review API terms; implement rate limits; provide user authentication where required; add service health and backoff. |
| Database performance issues | Large reference databases may be slow or memory-heavy. | Stage indexes; profile early; use background jobs, pagination, partial results, cancellation, and bounded caches. |
| PGN parser edge cases | Import failures or incorrect games. | Build strict and lenient modes; test with independently sourced public PGN edge cases; preserve diagnostics. |
| Chess rules bugs | Illegal positions or wrong analysis context. | Use independent perft tests and public chess-rule references; consider a permissive library after legal review. |
| Engine lifecycle bugs | Zombie processes, stale analysis, wrong evaluations shown. | Design sessions with revisions and cancellation; test crash/timeout cases; isolate process control. |
| Review recommendation false positives | Users may train wrong moves. | Show evidence and confidence; allow user overrides; validate with multiple sources; mark uncertainty. |
| Position indexing correctness | Opening statistics may be wrong around transpositions or variants. | Define position keys carefully; test with independent examples; keep exact and transposition modes separate. |
| Packaging complexity | Commercial release delayed by signing, updates, or platform quirks. | Prototype packaging by Phase 2; add CI for target platforms; document release steps. |
| Privacy and token storage | Account integrations may expose user data. | Use OS credential storage where possible; encrypt local tokens; minimize stored personal data; provide disconnect/delete options. |
| Manual/legal review gaps | Unresolved uncertainty reaches release. | Maintain "needs manual/legal review" list; schedule review before beta and before commercial release. |

## 14. Manual Review Checklist

Before implementation starts:

- [ ] Record the owner's attestation that the past-week commits are owner-owned and reusable.
- [ ] Create a reusable-delta bundle from commits `42732755` through `6c9de0d8`, plus documentation commit `4c34803e` if needed.
- [ ] Classify bundled items as new owner file, owner hunk from modified GPL file, owner asset, owner test, generated from owner-owned input, or needs manual/legal review.
- [ ] For modified GPL files, extract only owner-authored hunks or rewrite from the behavioral spec.
- [ ] Remove the old GPL repository from the active implementation workspace after the controlled delta extraction is complete.
- [ ] Create a fresh repository with no copied files and no copied git history.
- [ ] Use only this plan, later clean-room specifications, public documentation, and the reviewed owner-delta bundle as implementation references.
- [ ] Confirm implementation agents are instructed not to open, inspect, or copy the old GPL repository directly.
- [ ] Choose a proprietary-compatible licence for the new application.
- [ ] Verify every direct and transitive dependency licence.
- [ ] Avoid GPL/AGPL dependencies unless deliberately chosen after legal review.
- [ ] Decide whether engines are user-supplied, separately downloaded, or bundled; get legal review before bundling GPL engines.
- [ ] Replace all branding, names, logos, icons, screenshots, sounds, board themes, and piece sets.
- [ ] Write original UI copy and original documentation.
- [ ] Avoid copying UI text, empty states, tooltips, error messages, translation strings, or settings labels.
- [ ] Design a fresh folder structure and module naming system.
- [ ] Design a fresh database schema and migration strategy.
- [ ] Design fresh generated API bindings if needed.
- [ ] Create independent test fixtures from public rules, original examples, or permissively licensed datasets.
- [ ] Document independent design decisions in a clean-room design log.
- [ ] Mark uncertain items as "needs manual/legal review."
- [ ] Get legal review before commercial release.

## 15. Implementation Prompt Templates

Use these prompts later in the fresh repository. Each prompt forbids open-ended reference to the old GPL repository. If a task should reuse your past-week work, provide Codex with a reviewed owner-authored reusable-delta bundle and explicitly say which files or hunks are approved to copy.

### Import owner-owned reusable delta

```text
Import the approved owner-authored reusable code bundle into this fresh proprietary repository. Do not open, inspect, or copy from the old GPL repository. Only use the files/hunks/assets/tests included in the approved bundle, which are owner-attested as created in the past-week commits. Preserve useful logic where it fits the new architecture, rename APIs and modules as needed for this new codebase, and do not import GPL base files, old folder structure, old UI text, old schemas, or generated files that were derived from GPL sources unless separately approved.
```

### Create the initial app skeleton

```text
Create the initial desktop app skeleton for a proprietary chess workstation in this fresh repository. Do not reference, inspect, or copy any old GPL repository, source files, folder structure, UI text, assets, schemas, generated code, tests, or implementation details. If an approved owner-authored reusable-delta bundle is provided, use only the approved items from that bundle. Use this repository's plan and public documentation for selected dependencies. Set up the app shell, front-end build, back-end service boundary, original placeholder branding, licence notes, and dependency licence tracking. Do not implement chess features yet.
```

### Implement the chess domain model

```text
Implement an independently designed chess domain model from public chess rules, this specification, and any approved owner-authored reusable-delta bundle only. Do not reference or copy any old GPL chess code, names, tests, or data structures. Include board snapshots, legal move generation, move application, game tree nodes, variations, comments, NAGs, clocks, and visual annotation records. Add independently authored tests based on public chess rules and original examples, or approved owner-authored tests from the reusable bundle.
```

### Implement the Stockfish UCI wrapper

```text
Implement a UCI engine adapter for user-supplied local engines using the public UCI protocol and any approved owner-authored reusable-delta bundle. Do not reference or copy any old GPL UCI wrapper, command names, process lifecycle code, logs, or tests. Support engine profile validation, initialization, position updates, MultiPV, analysis sessions, cancellation, graceful shutdown, crash handling, and diagnostics. Treat Stockfish as an external user-configured engine unless legal review approves bundling.
```

### Implement the SQLite game database

```text
Implement a newly designed SQLite persistence layer for games, players, events, sources, annotations, studies, repertoires, and background jobs. Do not reference or copy any old GPL database schema, migrations, indexes, model names, generated bindings, SQL, fixtures, or storage formats. You may use approved owner-authored reusable-delta code where it is clearly separated from GPL base code. Use the data model proposal as the starting point, create original migration names, and add tests with original or approved owner-authored sample data.
```

### Implement PGN import

```text
Implement PGN import from public PGN format documentation, this plan, and any approved owner-authored reusable-delta bundle only. Do not reference or copy any old GPL parser, lexer, import code, test fixtures, comments, diagnostics, or sample PGNs. Support headers, SAN moves, comments, NAGs, variations, clocks where present, strict and lenient modes, deduplication fingerprints, progress events, and import diagnostics. Use original test cases or approved owner-authored tests.
```

### Implement the analysis panel

```text
Implement an original analysis panel for the fresh app. Do not reference or copy any old GPL UI code, component names, layout, CSS, UI text, icons, or engine display logic. You may use approved owner-authored reusable-delta logic/components where provided, but adapt them to the new architecture and original design system. The panel should subscribe to the engine session model, show current evaluation, MultiPV lines, depth/time/nodes, start/stop controls, engine selection, and clear error states. Write new UI copy and original styles.
```

### Implement local database search

```text
Implement local database search using the fresh SQLite schema and query service. Do not reference or copy any old GPL search code, index format, query names, SQL, data models, tests, or performance shortcuts. You may use approved owner-authored reusable-delta algorithms/hunks where provenance is clear. Support paginated header search, full-text search if available, current-position search, opening continuation statistics, progress events, cancellation, and stale-result protection.
```

### Implement source comparison

```text
Implement a two-source opening comparison workflow. Do not reference or copy any old GPL comparison UI, source-selection labels, state keys, schemas, or query implementation. You may use approved owner-authored reusable-delta code for the comparison feature. Use the behavior spec: two independently configured sources, synchronized current position, separate loading/error states, hover previews through the board overlay service, and stale request cancellation.
```

### Implement strategic route exploration

```text
Implement strategic route exploration from the behavior spec and any approved owner-authored reusable-delta bundle. Do not reference or copy any old GPL plan-extraction code, algorithms, table labels, file names, state names, tests, or UI layout. Use or adapt approved owner-owned plan-explorer code where provided; otherwise design a new algorithm that samples continuations from a reference source, tracks piece and pawn route patterns, reports sample size and confidence, and renders optional temporary board overlays.
```

### Implement repertoire gap scanning

```text
Implement a repertoire gap scanner. Do not reference or copy any old GPL scanning code, priority formula, UI text, data structures, generated bindings, or tests. You may use approved owner-authored reusable-delta code for the scanner and ranking workflow. Use designed inputs, outputs, and ranking logic based on repertoire coverage, reference frequency, recency, results, and optional validation. Include progress, cancellation, duplicate handling, user overrides, and save-to-review behavior.
```

### Implement review decks and practice

```text
Implement opening review decks and practice from the training specification and any approved owner-authored reusable-delta bundle. Do not reference or copy any old GPL review code, scheduler integration, UI wording, card schema, tests, or assets. Support deck creation, card editing, expected-move overrides, saved notes and board marks, due-card and full-deck practice modes, attempt logging, spaced-repetition scheduling, and post-attempt evidence.
```
