# Proprietary Clean-Room Behavioral Clone Plan

## 1. Executive Summary

The goal is to build a proprietary chess workstation that is a feature-complete behavioral replacement for the current En Croissant fork as of 2026-07-02. The new product should support the same user workflows, data outcomes, import/export paths, training loops, preparation flows, web companion behavior, and verification expectations, while using the owner's reusable feature code heavily and presenting an original product identity.

This is a 1:1 behavioral clone target with maximum owner-code reuse, not a GPL-base source-code port. "1:1" means that a user can accomplish the same practical tasks with equivalent evidence, controls, saved state, and output quality. Owner-authored feature code, tests, docs, scripts, and assets may be copied through an audited reusable-delta bundle. GPL base code, original En Croissant implementation code, third-party material with unclear rights, and old assets/build metadata must not be copied unless separately cleared.

The GPL base of the original application must not be reused, translated, restructured, or mechanically adapted. However, the owner attests that all functionality in this fork that is not native to the original En Croissant app was added by the owner. Those owner-authored features should be extracted from the fork history and reused heavily in the proprietary rebuild when provenance review confirms the copied files, hunks, tests, docs, scripts, or assets are owner-authored and not unmodified GPL base or uncleared third-party material. The 2026-04-27 past-week attestation remains valid, but it is no longer the only intended reusable range.

The proprietary rebuild should intentionally use the same broad language and platform choices as the current app to make transfer easier: a TypeScript/React front end, a Rust native back end, Tauri as the desktop shell, SQLite for local storage, UCI engine integration, and a similar board/database/engine/review product-layer split. This is architecture compatibility, not permission to copy GPL base structure or implementation.

The rebuild must happen in a separate repository, not in this repository and not on top of this repository's git history. Implementation agents should work from the separate proprietary repository, this plan, later clean-room specifications, the current product map distilled into behavior-only requirements, and owner-prepared reusable-delta bundles. Extraction agents may inspect this fork's full git history, diffs, and blame output, and may compare against the original En Croissant baseline, to identify exactly what the owner added. Implementation agents should not browse the old GPL repository as an open-ended implementation reference except for controlled owner/provenance extraction passes.

This plan is not legal advice. Anything uncertain should be marked "needs manual/legal review" before commercial release.

## 2. Licence Hygiene Rules

### Clean-Room Boundary

- Build in a separate new repository with no copied source tree, no copied git history, no shared remote, and no imported GPL base files.
- Do not fork, clone-and-delete, rename, or continue development inside this repository for the proprietary rebuild.
- Keep this repository as a read-only extraction/reference archive after the controlled extraction step.
- Copying is allowed for owner-attested reusable contributions identified by full-history provenance review, preferably from isolated export bundles rather than directly from the old repository.
- New files created entirely by the owner may be copied wholesale if they do not contain GPL-derived/generated material or third-party material with unclear rights.
- For files that modify pre-existing GPL files, copy owner-authored hunks or owner-authored feature regions when they can be separated from the surrounding GPL base; do not copy the surrounding GPL file wholesale.
- Reuse the same broad languages and platform stack where useful: Rust, TypeScript, React, Tauri, SQLite, UCI engines, local files, and background jobs.
- Reuse the same general product architecture shape where useful: desktop shell, front-end board/workspace UI, native back-end services, database/search/indexing services, engine process services, import/export services, preferences, and optional cloud/account adapters.
- Write GPL-base replacement code, fresh schemas, fresh product assets, and final user-facing copy independently unless a specific item is owner-authored and approved in a reusable-delta bundle.
- Use behavior-level specifications, user stories, acceptance criteria, public protocols, and independently authored designs.
- Do not ask implementation agents to compare against, port from, or inspect the GPL repository once the proprietary implementation begins, except when using a reviewed owner-authored delta bundle.
- Keep a written design log explaining why major architecture, schema, UI, and dependency choices were made independently.

### Do Not Copy GPL Or Unowned Material

The proprietary rebuild must not copy from the GPL base or from unowned material in the existing repository. Owner-authored feature code and assets are the planned exception after provenance review.

- GPL or original En Croissant source files.
- GPL or original En Croissant function, class, hook, command, type, component, or module names.
- GPL or original En Croissant folder structure, route structure, database schema, migrations, indexes, generated bindings, serialized index formats, or storage layouts.
- GPL or original En Croissant UI text, menu labels, tooltip wording, onboarding copy, empty-state copy, error messages, or translation strings.
- GPL or original En Croissant assets, icons, logos, images, sounds, board themes, piece sets, screenshots, or generated media.
- GPL or original En Croissant CSS, theme files, layout measurements, visual tokens, or component styling.
- Third-party test fixtures, expected-output files, PGN samples, database samples, benchmark inputs, or snapshots without rights clearance.
- GPL or original En Croissant documentation text, README text, comments, issue templates, contribution guides, build scripts, packaging config, capability manifests, launcher scripts, or generated code.

Owner-authored files, code hunks, tests, docs, scripts, and assets from the fork may be copied after provenance review confirms they are part of the owner's own contribution set and are not generated from GPL files unless the generated output is independently reproducible from owner-owned inputs.

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

### Owner-Attested Reusable Delta Policy

The owner has stated that all functionality in this fork that is not native to the original En Croissant app was added by the owner. The proprietary rebuild should therefore reuse the owner's feature work heavily instead of rebuilding it all from scratch.

For this plan, the first explicit reusable contribution range observed was the 2026-04-24 through 2026-04-27 commit range from `42732755` through `6c9de0d8`, plus documentation commit `4c34803e`. That range remains a known reusable starting point. It should be expanded with full-history extraction passes that identify all later owner-authored feature code, tests, docs, scripts, prompts, assets, and generated outputs whose inputs are owner-owned.

Extraction agents may inspect this repository's full git history to establish provenance. They may use `git log`, `git show`, `git diff`, `git blame`, tag/branch comparisons, and comparison against the original En Croissant upstream to determine which parts are native GPL base, which parts are owner-added features, and which parts need manual/legal review. This source inspection is allowed for provenance extraction; it is not permission for implementation agents in the fresh proprietary repo to browse the GPL-derived repo as a coding reference.

Allowed reuse:

- Directly copy owner-created new files from any attested range when they do not include GPL-derived generated output or third-party assets with unclear rights.
- Directly copy owner-authored feature code, hooks, utilities, UI components, tests, docs, scripts, prompts, and assets when provenance review confirms the copied material is owner-authored.
- Directly copy owner-authored code hunks or larger owner-authored feature regions from modified GPL files when the copied region can be separated from the surrounding GPL base.
- Directly copy owner-authored tests and fixtures when the test data was independently authored or otherwise rights-cleared.
- Directly copy owner-authored documentation and prompt templates from this plan.
- Use owner-created screenshots and session artifacts as private design references; do not ship them as product assets unless their contents and rights are reviewed.

Required controls:

- Prepare reusable-delta bundles from the relevant commit ranges before importing code into the proprietary repository.
- Mark each copied item as `new owner file`, `owner hunk from modified GPL file`, `owner asset`, `owner test`, `generated from owner-owned input`, or `needs manual/legal review`.
- Do not copy unchanged GPL files just because they were touched nearby.
- Do not preserve original En Croissant module paths, command names, schema names, or UI text unless they are generic or independently chosen. Owner-authored names may be retained when they are useful, but still prefer fresh public-facing names where that improves product distinctness.
- When extraction is hard to reason about, reimplement the behavior from the neutral spec instead of copying code.

### Separate Repository Isolation Workflow

The proprietary rebuild should use a two-workspace process:

1. **Extraction workspace:** this current GPL-derived repository, used to identify and export owner-authored material across the full fork history.
2. **Implementation workspace:** a brand-new proprietary repository created independently, used for all product implementation.

Required isolation rules:

- The implementation workspace must be created with `git init` or an equivalent empty-repo setup, not by cloning or forking this repository.
- The old repository must not be added as a submodule, subtree, remote, package dependency, workspace member, or path alias.
- Do not copy `src`, `src-tauri`, `public`, `sound`, `.github`, build outputs, dependency folders, generated bindings, generated route trees, caches, or config files wholesale.
- Do not copy `.git`, commit history, branches, tags, issue templates, CI files, lockfiles, generated artifacts, local build outputs, or app metadata from this repo into the new repo.
- Put the approved reusable delta in a neutral transfer bundle, for example `approved-owner-delta/`, with a manifest describing provenance and reuse status for every included file or hunk.
- The transfer bundle should contain only owner-authored items approved for reuse. It may retain temporary source-path notes for provenance, but the proprietary repository should organize imported code under a fresh project structure.
- Import the plan document into the new repo as a specification document, then treat the old repo as closed for implementation work.
- Start future Codex sessions from the new repo root only. Do not include this GPL-derived repo as the active workspace or adjacent source reference.
- If an implementation task needs additional detail from this repo, pause and run a controlled extraction pass in this repository to create a small owner-reviewed spec or delta export; do not let the implementation agent freely inspect the old repository as a coding reference.

### Transfer-Friendly Architecture Policy

To reduce rewrite friction, the new repo should deliberately mirror the current app's broad technology and responsibility split while avoiding protected implementation expression.

Allowed alignment:

- Use Rust for native services, process control, indexing, import/export, and performance-sensitive chess/database work.
- Use TypeScript and React for the desktop UI.
- Use Tauri for the desktop host and front-end/back-end bridge.
- Use SQLite for the local database and sidecar indexes if useful.
- Use public UCI protocol concepts for engine integration.
- Use a similar high-level set of domains: board workspace, notation/game tree, analysis, databases, files/studies, repertoires, review/training, settings, online accounts, and background jobs.
- Generate front-end/back-end type bindings from newly written Rust or schema definitions.
- Keep and reuse the same owner-added feature algorithms and implementation code wherever practical when they come from an approved owner-delta bundle.

Not allowed alignment:

- Do not copy the old `src` / `src-tauri` folder structure or route/component layout wholesale.
- Do not copy GPL command names, type names, generated binding names, state atom names, SQL table names, CSS modules, or translation keys.
- Do not reproduce the old IPC/API surface mechanically unless it comes from owner-authored reusable delta and is reviewed.
- Do not copy old migrations, index binary formats, generated code, package config, Tauri config, lockfiles, theme files, or asset directories.
- Do not use the old repository as a live "how did they implement this?" reference during new implementation.

Practical target: make the new repo familiar enough that owner-authored feature code can be moved with minimal conceptual translation, while keeping file layout, base app architecture details, schema, generated APIs, final styling, and shipped assets distinct enough that GPL base code is not carried across.

### 1:1 Behavioral Clone Policy

The proprietary product target is a complete behavioral replacement for the current fork, not a reduced chess GUI inspired by it. The rebuild should preserve every meaningful capability recorded in the current product map, including features added after the original April rebuild plan.

Behavioral parity means:

- The same user goals are supported from equivalent entry points, even if the screen layout and copy are redesigned.
- The same source types can be opened, imported, searched, refreshed, exported, and organized where terms/licences allow.
- The same chess workflows produce equivalent practical outputs: games, positions, annotations, review decks, prep trees, training attempts, reports, imports, exports, and sync artifacts.
- The same evidence categories are available to users: WDL/result data, game counts, recency, ratings, local database provenance, online source provenance, local engine results, cloud-eval status, validation confidence, and known limitations.
- The same safety behaviors exist: stale-request cancellation, background job progress, deduplication, canonical-player audits where relevant, source-confidence labels, engine-safety gates, and explicit skipped-game reporting.
- The same cross-device workflows exist for the phone/web companion, including hosted file browsing, database imports, prep/database parity surfaces, PWA startup, static library publishing, and local sync/export helpers.
- The same quality bar applies: large databases remain responsive, long scans can be cancelled or resumed where appropriate, local verification is scoped to the change, and browser/Playwright verification remains opt-in unless specifically requested.

Behavioral parity and owner-code reuse do not mean:

- Copying GPL/original En Croissant source files, generated code, schemas, migrations, routes, command names, component names, state keys, style tokens, UI strings, screenshots, board/piece themes, or build scripts.
- Recreating the old visual design with only superficial color changes.
- Letting implementation agents use the GPL repository as a live reference while coding.
- Importing owner-authored work without full-history provenance review and reusable-delta bundling.

The current fork's `agents.md` is the living product map for parity scope. Before implementation begins in the fresh repository, convert the relevant parts of that file into behavior-only specifications, acceptance criteria, and fixture-free test plans. Once converted, agents in the proprietary repository should use only those neutral specs, public protocols/docs, and approved reusable-delta bundles.

### Design Direction And Difference Requirement

The proprietary app should draw inspiration from the current fork's clean, modern, simple feel: calm density, clear task-led surfaces, compact evidence, board-first workflows, restrained controls, and low-friction navigation. The goal is to preserve the product's usability taste while giving the proprietary app its own identity.

- Create original branding, iconography, board and piece presentation, sound set, empty states, status copy, onboarding copy, and settings labels.
- Use original or rights-cleared assets for icons, boards, pieces, sounds, screenshots, generated images, and marketing materials.
- Keep the visual direction clean, modern, and simple rather than ornate, gamified, or cluttered.
- Redesign navigation labels, spacing, component styling, color tokens, and layouts enough that screenshots are clearly distinguishable from the GPL-derived fork while retaining equivalent workflows.
- Prefer domain-language names for new modules and APIs; do not preserve old internal names unless they are generic chess terms or approved owner-authored API names.
- Treat old screenshots and local verification images as private product-memory artifacts only. Do not ship them.

## 3. Feature Inventory

Inspection basis: top-level metadata, public README-level product description, behavior-level route and feature names, the current `agents.md` product map, user-facing screenshots/artifacts as private design-memory inputs, and the fork git history. No GPL implementation logic or source snippets were copied into this plan. The custom-feature classification below treats owner-authored non-native fork features as reusable after full-history provenance review and reusable-delta bundling.

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

### Current Full-Parity Scope Addendum (2026-07-02)

The table above is an older baseline inventory. The proprietary replacement should also cover the post-plan feature set recorded in `agents.md`. Treat this addendum as the current behavioral parity target. A future implementation pass should turn each bullet into neutral user stories, acceptance criteria, and tests before coding in the fresh repository.

#### App Shell, Home, And Workspace

- Task-led home launcher for opening recent files, importing games, starting analysis, choosing review decks, launching mistake scans, seeing daily goals, and returning to active work.
- Board-first workspace with a large resizable board, always-near annotation tools, right-side panels, under-board compact panels, detached eval/notation/controls where appropriate, saved layout preferences, and small-viewport resilience.
- Multi-panel research model covering analysis, database, prep, plan exploration, engine views, coach, practice, structures, moves, and files without losing board context.
- Report entry points for game analysis, move-list reports, rating/time-management reports, and generated prep/style reports should remain part of the task-led workspace, with outputs treated as user artifacts rather than hidden diagnostics.
- Robust startup behavior on Windows, including serialized dev-session startup for the fork equivalent, self-healing dependency installation for local development, clear progress fallbacks during heavy route/chunk loads, and safe single-instance handoff.
- App settings for board design, pieces, sounds, keybindings, trainer thresholds, engine behavior, source defaults, prep strength settings, builder settings, phone/web preferences, and layout.

#### Board, Game, Annotation, And Playback

- Legal move entry, promotion handling, FEN/PGN load/save, game-tree navigation, variations, comments, NAGs, clocks, visual annotations, arrows, highlights, and move-list display.
- Imported PGN annotations and variation trees must remain available during playback and when saving back to files, review decks, or databases.
- Board clocks and move think-time chips should display when online imports provide clock or timestamp data, with live replay that can animate recorded move timing.
- Analysis and training board states must preserve attempted moves, expected lines, variation context, and saved annotation edits instead of collapsing back into transient previews.
- Blindfold-style board modes should be supported for both puzzle/training use and play/trainer-bot use, with explicit visibility/reveal controls and engine move reporting.
- Board style choices should preserve the behavior of the fork's clean/default and chess.com-inspired modes, including sound/selection behavior where useful, but proprietary releases must use original or rights-cleared board, piece, and sound assets.

#### Analysis, Engines, And Cloud Evals

- User-supplied UCI engine configuration, MultiPV analysis, engine profiles, options, diagnostics, cancellation, and responsive local process management.
- Local Stockfish or equivalent user-supplied engine starts promptly while cloud checks run independently; stale engine results cannot update current positions.
- Lichess Cloud or equivalent local/cloud-eval source integration for root PVs, engine fallback, analysis display, database/prep strength scoring, and coach evidence, subject to terms/licence review.
- Local compact cloud-eval storage/build workflow, status/lookup tooling, cache-miss handling, shard/index format versioning, and rebuild safety should be recreated with fresh formats and names if kept.
- Engine panels should show eval-first move information, source/status labels, depth/CP/loss data where available, compact plans/setups modes, and quiet behavior when eval data is missing or intentionally unavailable.

#### Databases, Sources, Files, And Export

- Local databases, database folders, file folders, rename actions, pinned/archived/manual-order file organization, lazy folder loading, metadata-first scans, PDF/report visibility, and hidden generated artifact folders.
- Database import from PGN, compressed PGN, and supported database files; database export into Files as one PGN per game; analysis-board save-to-files; linked Files folders that sync one-game PGNs from database changes.
- Search by headers, exact position, transposition-compatible modes where designed, player/event metadata, dates, ratings, results, time controls, and current-position opening statistics.
- Large-database responsiveness with cancellable request ids, stale-result protection, mmap or equivalent warm caches, progressive loading, partial results, and bounded memory.
- Opening tables with sortable columns, compact mode, recent-move sorting, WDL bars, result-perspective correctness, player/source-side attribution, engine-only CP strength, blended strength, and source default controls.
- Source selectors for local databases, hosted database folders, Lichess All, Lichess Masters, study databases, generated web exports, and online account databases, with stable persisted identities and graceful fallback when sources move.
- Files and database views should support source-game jumps, direct game/database export shortcuts, in-app PDF previews, generated report browsing, linked-folder dedupe, and moved/renamed source recovery.

#### Online Games, Studies, And Account Data

- Lichess and Chess.com username imports into local databases with progress, date/count/range options, deduplication, import summaries, token reuse where appropriate, and provider-specific error handling.
- Online game picker with provider tabs, account/search flows, selected-game analysis, selected-game review creation, and paging beyond the first recent slice.
- Online games should preserve available clock/timestamp comments, time controls, move think times, board clocks, live replay controls, and clock-data enrichment during refresh.
- Auto-update metadata for online game databases and review decks, including moved database detection, PGN timestamp normalization, stable source identity, and explicit skip/error summaries.
- Lichess Study import as a local database with source-order preservation, chapter/study metadata, refresh controls, optional two-way sync, ordering repair, and protection against appending unrelated account games into study databases.
- Online account and external-service imports, including World Chess / FIDE Online Arena where useful for opponent prep, should be behind reviewed adapters, with terms-of-service notes, rate limits, source labels, exact-identity checks, and user-visible confidence/provenance.

#### Prep, Opponent Research, And Strength Models

- Desktop Prep must support player-specific and general modes, target color, source selection, root controls, import drawer, min-games/show-top settings, saved builder/strength settings, started/setup surfaces, and compact under-board parity.
- Prep move tables need sortable columns, WDL/result evidence, branch coverage, relative last-played labels, row previews, active-branch controls, player/color labels, and default source behavior matching the fork's workflows.
- Strength scoring must preserve the fork's Smart/Practical/Engine concepts at the behavior level: local eval data, WDL/practical evidence, minimum-game hardening, low-count safeguards, engine-safety gates, CP-drop limits, and clear source/status labels.
- `After prep` projection is in scope for both opponent-specific and general prep sources: candidate rows and opponent/source rows should project nearby prep-side continuations, use local evals only when enabled, avoid external eval API calls, progressively resolve rows, and keep lower/identical projections hidden except when sparse local-eval evidence is the useful signal.
- Prep builder should create a compact game-plan brief, priority-led queue, focused reply expansion for shorter runs, deep mode for broader coverage, hard CP safety enforcement, and a separate coach-report evidence pass that does not require building a tree.
- Plan Coach integration for prep should pass only supplied safe-route evidence, forbid recommending excluded or engine-unsafe alternatives, and distinguish normal strength, WDL/game share, local-eval CP/loss/source, after-prep projection, and no-answer states.
- Opponent prep data workflows should support per-player folders/databases, online account research, OTB and online source separation, source-game jumps, straight-line and venom-style prep finders, canonical name audits, duplicate detection, skipped/malformed PGN reporting, latest-game reporting, style/report outputs, and app-side database organization by event/player.
- Account research should include Chess.com, Lichess, World Chess/FIDE Online Arena, public event/broadcast sources, club/member clues, rating plausibility, FIDE/ECF identity checks, and explicit confidence labels before importing online account games.

#### AI Coach

- In-app Coach should support local CLI/model bridge modes, small chat transcript UI, progress/elapsed state, right-side and workspace entry points, concept-first teaching answers, and app-rendered formatting.
- Coach evidence packets should include legal moves, position facts, relevant PGN scope, Stockfish/cloud evals, targeted candidate lines, before-move FEN anchors, and strict clickable-line validation.
- A planner/pro model split or equivalent staged reasoning pipeline should decide context scope, gather facts, and produce final answers, while invalid or unsupported engine lines are repaired or stripped rather than breaking the UI.
- Coach must answer the user's actual question, keep chess-fact scaffolding internal, avoid hallucinated illegal lines, distinguish conversational follow-ups from phase-review tasks, and interpret engine lines rather than merely quoting evals.
- Local prompt/evaluation tooling, hidden test prompts, style evaluation reports, and lesson/prompt artifacts should be treated as owner-authored material only if separately attested before copying.
- Coach-adjacent report workflows should include move-list game reports, style reports, rating trajectory reports, and time-management reports where they are part of the user's current analysis workflow, with generated artifacts clearly separated from shippable product assets.

#### Opening Review, Mistake Review, And Daily Training

- Opening Review decks should be saved files, not localStorage-only state, with create/merge/delete/open flows, due/full/focused practice, SRS attempts, daily goals, source evidence, annotations, user overrides, and post-attempt explanations.
- Opening health and repertoire scans should support orientation-aware attribution, frequency/recency/practical-result gaps, date filters, validation metadata, bulk save, player/source-side color grouping, and explicit low-confidence handling.
- Mistake Review should scan local databases, PGNs, online selected games, and auto-updated sources into normal decks with source-game metadata, player database info, phase categories, reveal controls, time-management/long-think training, daily progress, and large-deck responsiveness.
- Review trainers must preserve attempted moves, hydrate saved practice trees, keep the interactive engine listener alive where needed, defer/coalesce saves for responsiveness, and avoid showing the saved answer before the attempt when that is the intended training mode.
- Daily goals should count Opening Review and Mistake Review practice, sync after auto-updates, and stay stable across session transitions.

#### Puzzle, Bot, Blindfold, And Practice Modes

- Puzzle training should include train/stats/SRS panels, import/migration safety, attempt summaries, dashboard/progress export, explicit start/next flows, latency-tolerant transitions, and blindfold tactics mode.
- Practice bot should support setup profiles, engine-backed opponents, managed Maia/LC0 or proprietary alternatives where legally/distribution-wise appropriate, FIDE-style strength selection, calibrated human-style time usage, clock pacing, move delays, and engine fallback.
- Blindfold trainer/play modes should support library previews, compact engine panels, move announcements, latest-engine-move display, reveal/visibility controls, and source naming that stays generic/original.

#### Plan Explorer, Engine Plans, And Structures

- Database-backed Plan Explorer should show piece routes, pawn plans, sample size, WDL/result bars, side filters, ply/depth controls, hover previews, pinned arrows, automatic arrows, board-piece shortcuts, and large-source cancellation.
- Engine Plans should support moves/plans and setups modes, local engine or cloud evidence, template/setup clustering, Lichess All practical overlays, source explanations, and safe behavior when engine/template evidence is sparse.
- Pawn-structure trajectory views should detect and explain named structure templates, support color reversal and allowed file mirroring, show compact current-structure surfaces, and avoid overclaiming when templates do not match.

#### Phone/Web Companion And Hosted Library

- Browser/PWA phone companion must provide board, files, database, prep, moves, engine, review-adjacent, hosted-library, and import workflows without eager desktop/Tauri imports.
- Hosted library build/publish flow should mirror selected PGN/PDF/database exports, generate manifests and position indexes, publish static assets, and keep `npm run web:publish` or its successor as the done criterion for phone-facing changes.
- Phone Database and Prep should mirror desktop source selection, local/hosted imports, strength settings, WDL bars, sort controls, branch coverage, setup/start split, stable source persistence, import drawer behavior, and compact row layouts.
- Phone Moves should preserve PGN variation trees, source titles, annotations, playback controls, board orientation, engine arrows, and stable current-folder/source labels.
- Phone UI should handle iPhone-scale viewports, compressed headers, compact previous/next controls, dense file rows, non-overlapping text, and no accidental desktop-only controls.

#### Verification, Migration, And Parity Audits

- Every rebuilt feature should have behavior-level acceptance tests or manual verification notes that prove parity without comparing source code.
- Import/export parity should be checked with independently created or permissively licensed PGN/FEN/database fixtures, not copied GPL fixtures.
- Database migrations, review-deck migrations, puzzle progress migrations, and hosted-library import migrations should be newly designed but cover the same user data survival cases.
- A pre-release parity audit should walk `agents.md` headings and recent feature inventory, marking each current fork capability as implemented, intentionally redesigned, deferred with reason, or legally blocked.

### Current Outpost Gap Audit Addendum (2026-07-07)

Four parallel read-only audit agents compared the current Outpost rebuild at
`C:\Users\loxty\Desktop\Repos\outpost-chess` against this fork and Outpost's own
`PARITY_AUDIT`, `PHASE_STATUS`, `FORK_FLOW_SPEC`, and `FORK_LAYOUT_SPEC` records.
This addendum is the dated patch list for future Outpost agents. It should be
used together with Outpost's local release sign-off checklist; if an item below
is later fixed in Outpost, update both the Outpost docs and this plan or add a
superseding dated note.

Important context from the audit: Outpost is no longer an early stub. Home,
tabbed board workspaces, Files, collection management, engine basics, prep
tables, coach, reports, review/training, structures, packaging, and much of the
fork-like desktop geometry already exist. Future agents should focus on the
holes below instead of re-litigating already implemented surfaces.

2026-07-07 owner direction: phone/PWA/web-companion parity is acceptable to
defer for now. Do not treat dedicated phone shell, phone layout, phone prep,
phone engine, hosted phone publish automation, or phone-specific cache behavior
as active Outpost gaps unless the owner reopens that scope.

#### Release-Blocking Or High-Priority Product Gaps

- **Startup launcher can regress into package-manager prompts.** Outpost's
  Tauri dev/build hooks still call the package manager path directly. Replace
  them with a non-interactive launcher path equivalent to the fork's
  `safe-dev`/npm-script handoff so local dev startup cannot hang on a pnpm
  reinstall prompt.
- **Restored tabs do not automatically select the Board route.** Outpost now
  persists tab sessions, but startup navigation still begins on Home. If saved
  board tabs exist, startup should open the Board workspace; Home should be the
  default only when no restored workspace exists.
- **URL/history routing is not parity-complete.** Outpost uses an in-memory
  surface store. Decide whether URL-addressable Home, Board, Files, Databases,
  database detail, Engines, Accounts, and Settings routes are required for
  parity. If yes, implement browser history/deep-link restoration; if no, record
  the in-memory model as an intentional proprietary redesign.
  - 2026-07-07 update: Outpost chose URL-addressable shell routes and now maps
    Home, Board, Files, Databases, database detail (`/databases/:id`), Engines,
    Reports, Accounts, and Settings into browser history. Explicit deep links
    restore their surface on startup, root startup still preserves restored
    board workspaces, app navigation pushes `history.pushState`, back/forward
    uses `popstate`, and the Databases detail Explore/back flow keeps the URL
    synchronized.

#### Prep, Database, And Source-Research Gaps

- **Opponent prep straight-line and habit finder is missing.** The fork has a
  straight-line/venom-style prep finder that ranks forced or habitual opponent
  paths, supports cancellation, and can play the found line onto the board.
  Outpost has strict/venom strength modes but not the full search/result
  workflow. Add this as a separate prep workstream with tests.
- **Prep coach/game-plan reporting is reduced.** Outpost has prep coach packets
  and a compact builder, but not the fork's richer game-plan report action,
  natural-language report output, evidence grid, safe/unsafe/no-answer states,
  and bounded independent evidence pass. Patch this separately from ordinary
  coach chat.
- **Prep source-management tooling is not first-class enough.** Add event/player
  prep organization, per-player OTB vs online source separation, combined source
  PGNs beside converted databases, latest-game reporting, source PGN vs
  converted count reporting, canonical player-name audits, duplicate detection,
  skipped/malformed-game reporting, account confidence records, mismatch cleanup,
  and first-class World Chess/FIDE Online Arena account identity where terms
  allow.
- **Prep online import behavior differs.** Desktop prep import works, but future
  agents should close parity for provider/date previews, save-as-database
  toggles, and temporary unsaved prep sources.
- **Database move tables lack full strength parity.** Outpost's database table
  remains more WDL/game-count centered. Add fork-equivalent Smart/Engine/
  Practical strength columns, settings popover, local-eval blend, CP-drop
  controls, sortable strength/after-prep behavior, and perspective-safe WDL bars
  to database and compare surfaces.
- **Reachability and stale-empty protections are incomplete.** Patch search so
  placeholder reachability metadata does not hide reachable games, indexed empty
  results can fall back to slower recovery scans, and existence-only novelty
  probes cannot poison shared move caches.
- **Import/export/source robustness still trails the fork.** Future work should
  cover compressed PGN/database import, foreign-format import decisions,
  interrupted or placeholder file repair, linked Files-folder sync, hidden
  intermediate artifact folders, direct jump-to-source-games follow-through, and
  database/source move recovery after renames.
- **Opening/repertoire gap workspace is thinner.** Outpost has useful scan
  modals and deck save flows, but the fork's unified opening-review workspace
  combines stats, filters, analyze/review actions, position management,
  per-deck settings, urgency/verification display, and embedded practice. Add a
  workstream to decide whether to rebuild that unified workspace or document the
  modal split as an accepted redesign.

#### Analysis, Review, Training, And Coach Gaps

- **Review deck auto-update runner is missing or incomplete.** Outpost exposes
  auto-update flags, but needs a real background runner that detects changed
  online/local sources, resolves moved databases by identity, rescans linked
  decks, and records update summaries before practice starts.
  - 2026-07-07 update: Outpost now has an Opening Review deck auto-update
    runner for saved account, local-collection, and coverage-walk recipes. It
    runs as a 30-minute app-scheduler job, performs the same stale-check before
    opening an auto-update deck, writes generated cards through the deferred
    review-card batch path, and records `lastAutoUpdate` summaries on the deck
    catalog. Remaining nuance for future work: mistake-review online-DB-linked
    deck refresh still uses the separate rescan-prompt path, and local source
    recovery should be revisited if collection identities become path-based.
- **Engine PV arrows are incomplete.** Outpost has an arrows preference, but
  engine PV rows should actually draw/update board arrows like the fork, without
  leaking hidden review answers.
  - 2026-07-07 update: Outpost now draws transient board arrows for visible,
    legal engine/cloud PV first moves when Analysis arrows and eval visibility
    are enabled; stale rows, hidden-answer review positions, and collapsed or
    non-Engine views clear the overlay.
- **Game report generation differs.** Outpost can export/copy reports from
  current evidence, but lacks the fork-style explicit engine-analysis report
  workflow that runs analysis, builds eval charts, writes quality markers, and
  lets users jump from report rows to moves. Either implement this report modal
  behavior or record the current report model as an intentional replacement.
- **Eval display may be live-engine-only.** Verify and patch whether the board
  eval bar and charts should display stored node evals, cloud/local evals, and
  report-generated evals after the live engine is stopped.
  - 2026-07-07 update: Outpost's board eval bar now stays available for
    matching last/live engine PV1, transient cloud/local eval snapshots, and
    stored node `[%eval]` text from imported/report PGNs while preserving the
    focus-mode hide behavior.
- **Mistake-review metadata is simpler.** Add or explicitly defer richer
  severity/nature/phase/time classifications, tactical cause labels, online
  clock backfill, and filters matching the fork's mistake-review workspace.
- **Clock hydration/backfill is missing.** Outpost parses `%clk`/`%emt`, but
  needs the fork-equivalent layer that enriches older online PGNs and
  mistake-review cards with clock/timestamp data during refresh.
- **Puzzle source/database parity needs a decision.** Outpost's local puzzle
  sets, SRS, and blindfold work are strong, but the fork's native puzzle
  database import/download/source model is not equivalent. Decide whether local
  sets are the accepted proprietary replacement or add puzzle database
  import/download/management parity.
- **Managed human-like trainer models need a decision.** The fork supports
  Patricia/Maia/Stockfish-style managed trainers. Outpost uses local personas
  and user engines. Record this as an intentional legally safer replacement or
  authorize a licensed managed-model workstream.
- **Opening Review home modal tails remain.** Close parity on per-deck settings,
  online opening scan settings, positions/settings actions, and mistake-review
  online scan settings exposed from Home modals.
- **AI Coach is present, but provider behavior needs sign-off.** Outpost's
  deterministic/local-CLI/Gemini architecture is a viable proprietary
  replacement, but the plan should record which provider path is accepted for
  release and which fork native-coach behaviors remain required: engine request
  allowlist and bounded illegal-line repair.
  - 2026-07-07 update: Outpost now surfaces local CLI auth failures explicitly.
    Empty-output CLI runs with login/auth/token/session diagnostics and thrown
    desktop command auth errors append a `CLI authentication required` message
    and mark provider status `auth required`, instead of falling through to a
    misleading empty-response/provider-failed fallback.
  - 2026-07-07 update: Outpost now records fixed-prefix verdict semantics in
    the Coach bridge. The system prompt and evidence packet tell providers that
    supplied line 1 is the candidate/prefix verdict under best play, while later
    supplied lines are comparison or alternative replies and must not be cited
    as that candidate's own evaluation.
  - 2026-07-07 update: Outpost now records the concept-first teaching voice in
    the Coach bridge. Providers are instructed to explain the concrete chess
    mechanism before eval numbers, use evals as supporting evidence, and avoid
    psychological attributions unless the user explicitly asks for that lens.
  - 2026-07-07 update: Outpost now reuses targeted evidence for conversational
    follow-ups. The Coach panel attaches the previous answer's evidence lines,
    answer snippet, and anchor to questions such as "that line"; previous lines
    become verdict evidence only when the board FEN is unchanged, otherwise
    they remain scope notes.

#### Visual And Flow Differences To Verify

- **Board right-side layout is close but not identical.** The fork has a more
  explicit persisted top-right/bottom-right region model, while Outpost uses a
  simpler two-pane split and training tab replacements. Verify with owner
  screenshots whether the current model is acceptable or implement the missing
  right-column row divider behavior.
- **Titlebar action injection differs.** The fork can inject board-specific
  actions beside the File menu. Add an Outpost titlebar action slot if save or
  board actions should live in that same place.
- **Accounts and database details are not first-class routes.** Even if
  in-memory navigation is kept, decide whether Accounts should be visible in the
  rail or addressable from a stable route, and whether database detail needs a
  deep-linkable page equivalent.
- **Database storage model is intentionally different.** Outpost centralizes
  games in a proprietary library SQLite with collection labels instead of
  managing many `.db3` files/folders. This is probably desirable, but future
  agents must preserve user-visible folder/source workflows, source provenance,
  export paths, and prep/event organization so the storage redesign does not
  remove practical fork workflows.
- **Visual sign-off items remain.** Confirm notation density and engine-card
  header anatomy against the reference captures. These are owner sign-off items
  unless the owner explicitly asks for code changes.

#### Owner, Legal, Or Product Decisions

- **Internationalization:** the fork ships multiple locales; Outpost is
  English-only. Decide whether English-only is acceptable for proprietary
  release or authorize a translation pipeline.
- **Local Lichess eval-store builder:** Outpost can read an existing compact
  eval store, but a full public-dump builder/download workflow remains a
  product and distribution decision.
- **Auto-update and changelog:** packaging exists, but updater channel,
  changelog presentation, and release distribution are owner decisions.
- **Telemetry:** Outpost currently has no telemetry. Confirm this privacy-first
  stance or authorize an opt-in telemetry design.
- **Titlebar style:** custom titlebar is currently aligned to fork geometry and
  Outpost identity; confirm or request native-titlebar conversion.
- **Online-service terms:** Chess.com PubAPI, World Chess/FIDE Online Arena,
  Gemini BYOK, Lichess token storage, and engine download/bundling decisions
  must be resolved through Outpost's adapter/licensing docs before release.

## 4. My Added Features Preservation Plan

The following specifications preserve the desired behavior and identify owner-added code that may be copied into the proprietary rebuild after provenance review. The "Current reference location" column is for private owner review and extraction. Implementation agents in the fresh proprietary repo should use reviewed reusable-delta bundles rather than browsing the old GPL repository.

### Current Owner-Authored Feature Wave Map

This inventory supersedes the old April-only "past week" list. It summarizes
the reusable owner-authored feature waves currently visible in branch history
through 2026-07-02. Exact file and hunk boundaries still require Phase 0
provenance extraction against the original En Croissant baseline before code is
copied into a proprietary repository.

| Date range / anchor commits | Owner-added feature wave | User-facing scope to preserve | Reuse guidance |
| --- | --- | --- | --- |
| 2026-04-24 to 2026-04-27, `42732755` through `6c9de0d8`, plus docs `4c34803e` | First owner-feature foundation | Compare, Plan Explorer, database source workflows, opening health/repertoire gaps, review decks/practice, Mistake Review, cloud/local eval validation, responsive board layout, engine dock, hover previews, file organizer polish, and rebuild planning docs. | Known starting owner-delta range. Copy owner-authored files/hunks/tests/docs after provenance review; do not copy surrounding GPL/native base files. |
| 2026-04-28 to 2026-05-04 | Board/workspace, online data, review, home, and prep expansion | Better engine/cloud interaction, merged online databases, online import progress, daily Opening Review, latest-game analysis, online game picker, provider tabs, Lichess Study import/update, home launcher, daily goals, time-management trainer, practice bot, managed Maia/human trainer work, startup/launcher reliability, opening plan gaps, opponent prep builder, SRS feedback, and report/stat benchmark artifacts. | Bundle owner-authored workflow code and tests by feature family. Treat launcher/package changes and generated reports/assets as separate review classes. |
| 2026-05-07 to 2026-05-16 | Smart prep, notation, review performance, live clocks, Files export, and pawn structures | General prep sources, smart prep builder and scoring, prep builder controls/depth/play-rate thresholds, practical prep ranking, under-board notation/annotation layout, review startup and transition performance, engine lifecycle hardening, online game clocks/time controls/live replay, file rename/import/export shortcuts, analysis save shortcuts, Lichess Study reload, pawn-structure detector and trajectory panel, online game picker pagination, and mistake review SRS/readiness fixes. | High-value owner code for Prep, review, clocks, Files, and structures should be reused heavily. Replace any copied Chess.com-style assets/sounds unless rights-cleared; preserve only behavior unless asset provenance is approved. |
| 2026-05-17 to 2026-05-29 | Database/files organization, under-board Database/Prep, prep strength, opponent-prep workflow, board style, and PDF/report surfaces | Large study/deck stall fixes, default opponent prep player/source/min-games, online player import in Prep, under-board Database and Prep modes, database folders and folder-first pickers, sortable prep columns, rebuilt strength scoring and persisted settings, database eval/strength columns, linked database-to-Files folders, lazy Files tree, pin/archive/manual ordering, Lichess Study two-way sync, opponent-prep source/account-search playbook, chess.com-inspired board style, move-list annotation action, source-game jump from prep, plan castling, in-app PDF previews, hidden render artifacts, straight-line/venom prep finders, and app/browser verification guidance. | Reuse owner-authored workflows and performance fixes. Board-style implementation needs special asset review; if assets are not clearly owner-owned/right-cleared, rebuild with original proprietary board/piece/sound assets. |
| 2026-05-31 to 2026-06-05 | Prep data operations, puzzle backend, phone companion MVP, hosted sync, and phone parity foundation | Hayk prep refresh docs, archived file filters, durable puzzle trainer backend/workspace, puzzle feedback/start/advance fixes, Lichess Study order/dedupe fixes, notation focus mode, mobile web prep companion MVP, hosted phone prep workspace, web prep database imports, phone database source parity, phone site auto-sync, database publishing to phone site, phone prep setup/common-move/source/branch/root/strength/database/filter/game-list/sort parity, hosted database loading, stale hosted source filtering, and Tauri dev startup binary selection. | Treat phone/PWA and hosted-library code as owner-authored feature code. Keep web publishing pipeline behavior but recreate product assets/copy and avoid desktop-only eager imports in the proprietary phone app. |
| 2026-06-06 to 2026-06-08 | AI Coach, generated lessons/reports, and coach grounding | Stockfish opening-game generator, repertoire/lesson documentation, experimental AI Coach, Gemini/AGY CLI bridge, progress logging, planner/pro split, current-FEN line validation, side-panel Coach, transcript response handling, answer formatting, reference context memory, prompt blanking, Enter-to-send behavior, whole-game scope handling, cloud root lines for prompts, clickable move paths, line-backed verdicts, chess-fact grounding, invisible fact scaffolding, follow-up anchoring, annotation-style evaluation probes, and rating/time-management report artifacts. | Reuse owner-authored Coach orchestration, prompt/evidence shaping, validators, UI, and report scripts after provenance review. Generated lessons/reports are owner artifacts but should be classified separately from shippable product assets. |
| 2026-06-10 to 2026-06-15 | Puzzle hardening, phone UI, blindfold, setup plans, and Coach validation | Puzzle mode simplification, Elo/progress/SRS persistence, puzzle database handling, study duplicate prevention, phone overflow/layout fixes, board quick actions, phone engine panel/arrows/eval signs, compact phone rows/header/files, phone PGN variation preservation, Blindfold Maia/trainer/library/tactics modes, managed Maia preparation, blindfold reveal/input/controls/engine dock/resume/progress, analysis under-board moves density, Lichess cloud throttling, Plan Explorer setups and WDL bars, engine setup candidates, setup clustering/templates/practical blend, setup previews, review auto-update movement fixes, and castling-normalized Coach validation. | Reuse owner-authored puzzle, phone, blindfold, setup-mining, and Coach validation code. Keep Maia/LC0 engine distribution under licence review. Replace any borrowed visual/audio assets with original/right-cleared assets. |
| 2026-06-18 to 2026-06-20 | Performance reports, event prep records, database picker hardening, prep strength cleanup, and Southall workflows | Unrated rapid/rating trajectory reports, Southall prep/account/database organization records, opponent-prep account workflow updates, database picker pinning/ordering/folder pinning/dropdown constraints, indexed position-search hardening, placeholder metadata handling, provider-labeled prep player resolution, phone prep strength scoring, split under-board state, cloud status handling, unified prep strength scoring, low-sample caps, engine-best prep scoring, Southall dedupe/style-report scripts, Southall Chess.com/Lichess imports, and prep tab stage persistence. | Treat scripts, reports, prep manifests, and workflow docs as owner-authored artifacts. For proprietary implementation, preserve data workflow behavior and reporting outputs while using fresh product storage/schema. |
| 2026-06-22 to 2026-06-23 | Local Lichess eval store, After-prep projection, prep builder game plan, and prep Coach report | Compact local Lichess eval store/build/lookup, conditional prep line signals, candidate after-prep values, continuation lookahead, strength-based future selection, separate after-prep column, row-strength floor behavior, practical WDL lowering Smart strength, local eval data for sparse/general source projections, local-only eval lookups, progressive after-prep speedups, focused prep builder game plan, coach-report button, natural-language prep report, independent coach-report evidence pass, after-prep ranking, main-branch ranking fixes, and bounded Stockfish startup fallback. | This is core proprietary parity scope. Reuse owner-authored prep/eval code heavily, but create fresh local eval storage formats and names unless provenance confirms the whole format is owner-authored and safe. |
| 2026-06-30 to 2026-07-01 | Sameera prep, World Chess/FIDE Online Arena workflow, and account-search expansion | Sameera Kodukula prep assets, explicit Lichess broadcast database, app-side prep folder reorganization, World Chess profile/import workflow, account-search guide expansion beyond Chess.com/Lichess, FIDE ID verification, World Chess API endpoints, and online-account database organization. | Preserve as opponent-prep data workflow requirements and reusable scripts/docs. Online-service adapters need terms review and rate-limit handling before shipping. |
| 2026-07-02 | Proprietary rebuild plan refresh | Full behavioral clone plan, phased rebuild plan, design direction, owner-code reuse policy, and full-history provenance workflow. | May copy directly as owner-authored planning documentation. |

### Current Commit-History Coverage Snapshot

As of this update, the branch history after the original rebuild-plan commit
contains owner-authored work on these active dates: 2026-04-27, 2026-04-28,
2026-04-30, 2026-05-02 through 2026-05-05, 2026-05-07, 2026-05-09 through
2026-05-11, 2026-05-14 through 2026-05-18, 2026-05-21, 2026-05-24 through
2026-05-29, 2026-05-31, 2026-06-02 through 2026-06-15, 2026-06-18 through
2026-06-20, 2026-06-22 through 2026-06-23, 2026-06-30, 2026-07-01, and
2026-07-02. Phase 0 extraction should use `git log --reverse --date=short`,
`git show`, `git diff`, `git blame`, and upstream comparison to turn these
waves into exact reusable-delta bundles.

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

The new architecture should be transfer-friendly and domain-first. It should use the same broad stack and deployment shape as the current app, while defining fresh module boundaries, names, APIs, schemas, generated bindings, and UI composition. UI components should consume application services and domain models rather than owning chess rules, persistence logic, or engine protocol state.

### App Shell

- Cross-platform Tauri desktop shell with a TypeScript/React web UI front end and Rust local service back end.
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

- Implemented primarily in Rust, with SQLite as the MVP storage engine.
- Stores canonical game records, participants, events, annotations, studies, and source metadata.
- Builds derived indexes in background jobs rather than during UI interactions.
- Keeps raw imported PGN or original metadata only when useful for export/audit.
- Version all storage formats and provide migrations from day one.

### Search/Query Layer

- Exposed to the TypeScript UI through freshly generated Tauri command bindings or an independently designed equivalent.
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

## 6. Required Technology Stack

Use the same broad language/platform stack as the current app unless the owner explicitly approves a change. This is a requirement, not just a preference, because it maximizes reuse of owner-authored feature code and reduces translation work. Prefer permissively licensed dependencies where possible. Verify licences at selection time and before release. Avoid GPL/AGPL dependencies unless deliberately chosen with legal review and a distribution strategy.

Required baseline stack:

- Desktop shell: Tauri 2.
- Native layer: Rust.
- Front end: TypeScript, React, Vite.
- Local storage: SQLite.
- Engine integration: UCI process adapter with user-supplied engines.
- Background work: Rust async tasks or worker threads exposed through Tauri events.
- Generated bindings: newly generated from fresh Rust command/type definitions.

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

## 11. Key Rebuild Phases

The rebuild should move through clear gates. Earlier phases create the independent shell and clean replacement for original En Croissant baseline functionality. Later phases import and adapt the owner's feature code heavily, using full-history provenance bundles, until the proprietary app reaches full day-to-day parity with the fork.

### Phase 0: Provenance, Scope, And Design Direction

**Goal:** define exactly what can be reused, what must be rebuilt, and what the new product should feel like.

- Inspect the fork's full git history and compare against the original En Croissant baseline to classify owner-added features, owner-created files, owner hunks inside modified GPL files, generated owner outputs, third-party assets, and GPL/native base code.
- Produce reusable-delta bundles for owner-authored code and assets, with provenance manifests.
- Produce a behavior-only parity checklist from `agents.md`, grouped by desktop, phone/web, prep, coach, review/training, files/databases, online data, reports, settings, and verification.
- Define a fresh visual identity that is inspired by the current fork's clean, modern, simple design language but uses original assets, copy, spacing, color tokens, icons, board/piece styling, and branding.
- Decide dependency licence rules, engine distribution policy, online-service terms constraints, and manual/legal review gates.

**Done when:** the fresh repo can be created with this plan, the parity checklist, approved owner-delta bundles, a design direction brief, and a clear "do not copy GPL/native base" boundary.

### Phase 1: Fresh Repository And Product Shell

**Goal:** create the independent proprietary app container without chess complexity.

- Initialize a new repository with independent history, remotes, package metadata, licence notes, clean-room notes, dependency licence tracking, and original placeholder branding.
- Set up the broad transfer-friendly stack: Tauri, Rust, TypeScript, React, Vite, SQLite-ready persistence, background job plumbing, and freshly generated front-end/back-end bindings.
- Create the app shell, task-led home launcher skeleton, board workspace shell, settings skeleton, error/progress surfaces, and original design system foundations.
- Keep the implementation workspace isolated from this GPL-derived repository; import only approved bundles and neutral specs.

**Done when:** the app launches as its own product, shows the intended clean/modern/simple direction, has no copied GPL/native base assets or configs, and can receive owner feature modules.

### Phase 2: Chess Core And Baseline Data Model

**Goal:** replace original En Croissant baseline mechanics with independently owned core services.

- Implement or integrate permissively licensed chess rules, board state, legal moves, move application, FEN, PGN parsing/export, game trees, variations, comments, NAGs, clocks, annotations, and board overlays.
- Design a fresh SQLite schema for games, players, events, sources, studies, repertoires, review decks, attempts, engine snapshots, imports, and background jobs.
- Add migrations from day one, independent fixtures, PGN/FEN diagnostics, and round-trip tests.
- Build the board, notation, move list, save/open, and basic file/database flows needed for later feature imports.

**Done when:** the proprietary app can open, edit, annotate, save, import, export, and navigate games without depending on old GPL/native base code or schemas.

### Phase 3: Engine, Analysis, And Evaluation Foundation

**Goal:** provide the shared evaluation layer used by analysis, prep, coach, review, and training.

- Implement a fresh UCI adapter for user-supplied engines, with engine profiles, options, lifecycle, cancellation, MultiPV, diagnostics, and stale-result protection.
- Add local/cloud eval abstractions, source labels, cache policy, status reporting, and fresh storage formats for any local cloud-eval database.
- Recreate engine panels, eval-first move information, compact line display, local engine fallback, and responsive analysis behavior.
- Keep GPL engines such as Stockfish external/user-supplied unless legal review approves another distribution strategy.

**Done when:** every later feature can request evaluation evidence through one owned service with clear source/provenance and cancellation semantics.

### Phase 4: Databases, Files, Sources, And Search

**Goal:** make the app a serious local chess workstation before layering advanced workflows.

- Implement local database creation/import/export, database folders, Files folders, linked Files/database exports, pinned/archived/manual order behavior, metadata-first scans, and PDF/report visibility.
- Implement header search, current-position search, opening statistics, source filters, result perspective, player/source-side attribution, recent sorting, WDL bars, and large-database cancellation/progress.
- Import owner-authored search/index/cache code heavily where provenance permits, adapting it to the fresh schema and names.
- Add source selectors for local databases, generated web exports, online references, studies, and account databases.

**Done when:** local database research, Files organization, import/export, and opening table workflows can replace the fork for normal desktop use.

### Phase 5: Owner Feature Import - Research And Planning

**Goal:** bring across the owner-authored research features that distinguish the fork.

- Import/adapt owner-authored two-source comparison, Plan Explorer, engine plans, setup/template clustering, pawn-structure trajectory, hover previews, pinned/automatic arrows, source preferences, and board-piece route shortcuts.
- Preserve behavior and evidence while refreshing public names, final styling, and assets.
- Verify large-source cancellation, sample-size reporting, WDL/result bars, source provenance, and no-stale-result behavior.

**Done when:** source comparison, plan exploration, engine plans, structures, and visual planning tools reach behavioral parity with the fork.

### Phase 6: Owner Feature Import - Prep And Coach

**Goal:** recreate the guided preparation and explanation workflows that are now central to the product.

- Import/adapt owner-authored Prep, strength scoring, Smart/Practical/Engine modes, after-prep projection, prep builder, game-plan briefs, coach-report evidence, source defaults, import drawers, and compact under-board prep surfaces.
- Recreate AI Coach with legal-line validation, context selection, evidence packets, model/CLI bridge options, progress UI, app-rendered formatting, and failure-tolerant unsupported-line cleanup.
- Preserve engine-safety gates, CP-drop limits, sparse-line behavior, progressive row resolution, player/general modes, and saved settings.
- Keep opponent-prep data workflows in scope: per-player folders/databases, online account research, canonical-name audits, dedupe, skipped-game reporting, latest-game reporting, and style/report outputs.

**Done when:** opponent prep, general prep, coach reports, and conversational Coach can replace the fork for tournament preparation and analysis explanations.

### Phase 7: Owner Feature Import - Review, Training, And Play

**Goal:** bring across all practice loops and user-progress data.

- Import/adapt owner-authored Opening Review, Mistake Review, Puzzle Training, Practice Bot, Blindfold, daily goals, SRS, time-management review, deck migrations, source evidence, reveal controls, and large-deck responsiveness.
- Preserve saved decks, attempts, annotations, evidence, due queues, progress summaries, selected-game review creation, and online/local scan outputs.
- Recreate practice bot and managed-engine support with licensing/distribution review for Maia/LC0 or alternatives.
- Verify that attempted moves, saved practice trees, annotations, review evidence, and daily progress survive app restarts and source moves.

**Done when:** training and review behavior reaches full parity, including saved-data survival and large-deck responsiveness.

### Phase 8: Online Data, Studies, Sync, And Phone/Web Companion

**Goal:** restore cross-device and online-source workflows.

- Implement Lichess/Chess.com imports, account/token handling, online game picker, selected-game analysis/review, paging, auto-updates, import summaries, dedupe, clock/comment preservation, and moved-source recovery.
- Implement Lichess Study import/update/sync, source-order preservation, chapter/study metadata, and protection against mixing account games into study databases.
- Rebuild the browser/PWA companion without eager desktop runtime imports, including board, files, moves, engine, database, prep, hosted-library imports, source pickers, and compact phone layouts.
- Recreate hosted-library build/publish flows, manifests, position indexes, and static publishing as done criteria for phone-facing changes.

**Done when:** desktop and phone workflows stay in sync, online data imports are reliable, and phone/PWA parity is no longer dependent on the old fork.

### Phase 9: Polish, Packaging, Migration, And Commercial Readiness

**Goal:** turn the parity product into a shippable proprietary application.

- Complete original branding/assets/copy, accessibility, responsive layout hardening, crash recovery, backup/restore, settings completeness, onboarding, shortcut help, and packaging/signing.
- Add migration/import tools for user-owned data where legally and technically safe, using fresh schemas and explicit provenance notes.
- Run dependency licence scanning, online-service terms review, engine distribution review, manual/legal review, and clean-room design-log review.
- Build performance benchmarks for large databases, imports, review decks, phone hosted-library imports, and engine/prep workloads.

**Done when:** the app is installable, visually distinct, commercially reviewable, and ready for owner beta use.

### Phase 10: Full Parity Audit And Release Gate

**Goal:** prove the new product can replace the fork.

- Walk the final parity checklist from `agents.md` and mark every workflow implemented, intentionally redesigned, deferred with owner-approved reason, legally blocked, or missing.
- Confirm every copied file/hunk came from an approved owner-delta bundle or was rewritten independently.
- Confirm no GPL/native base source, schema, generated API, UI copy, assets, build scripts, or fixtures were imported.
- Run focused automated/manual verification for desktop, phone/web, prep, coach, review/training, online imports, files/databases, reports, settings, packaging, and data survival.

**Done when:** there are no release-blocking parity gaps, contamination risks, licence blockers, or unverified critical data paths.

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

### Full-Parity Product Acceptance Criteria

- The proprietary product can replace the current fork for the owner's normal workflows without needing the old app open for board analysis, database research, opponent prep, review training, online imports, phone companion use, or file/database organization.
- Every current `agents.md` product-map feature is represented in a neutral parity checklist and has an implementation status before release.
- Desktop prep behavior covers player-specific and general sources, strength settings, after-prep projections, prep builder briefs, coach-report evidence, import drawers, source defaults, and row-level evidence.
- Review/training behavior covers Opening Review, Mistake Review, Puzzle Training, Practice Bot, Blindfold, daily goals, SRS, saved attempts, review migrations, and large-deck responsiveness.
- Data workflows cover local databases, database folders, Files folders, linked exports, hosted web exports, online account imports, Lichess Study imports, auto-updates, dedupe, skipped-game reporting, and source provenance.
- Coach behavior covers legal-line validation, engine/cloud evidence, phase/conversation scopes, app-rendered answer formatting, progress states, and failure-tolerant cleanup of unsupported lines.
- Phone/web behavior covers PWA startup, hosted files, database/prep/source parity, import progress, engine arrows/eval display, compact moves, variation preservation, and the static publish workflow.
- Performance behavior covers cancellation, stale-result protection, progressive results, local cache warming, bounded memory, and visible progress for long-running work.
- Visual design, UI copy, branding, icons, board/piece presentation, schema, generated APIs, and build/package structure are original enough that a screenshot and code review clearly distinguish the proprietary product from the GPL-derived fork.

### Licence Hygiene Acceptance Criteria

- The proprietary rebuild lives in a separate git repository with independent history, independent remotes, and no relationship to this GPL-derived repository other than documented import of approved owner-owned material.
- The new repository uses the same broad language/platform architecture for transfer ease while retaining independently written file layout, module boundaries, command names, schema, generated bindings, UI copy, styling, and assets.
- The new repository has no copied GPL base source, file structure, generated code, schemas, migrations, fixtures, UI copy, comments, documentation, assets, or build scripts.
- Any copied material comes only from audited owner-attested reusable-delta bundles, with provenance notes.
- New owner-created files are identified separately from owner-authored hunks or regions inside modified GPL files.
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
| Rebuild accidentally occurs inside the GPL-derived repository | New proprietary work may inherit contaminated history, paths, configs, or accidental copies. | Use a physically separate `git init` repository; keep this repo read-only after extraction; never add it as a remote/submodule/dependency; run implementation sessions from the new repo root only. |
| Accidental GPL contamination | Proprietary release may be compromised. | Start fresh repo; remove old repo from active workspace after extraction; forbid open-ended source reference during implementation; keep clean-room design log; review diffs before release. |
| Confusing owner-code reuse with GPL-base copying | Useful owner-authored feature code may be copied together with surrounding GPL/native base code. | Use full-history extraction, upstream comparison, tight hunk review, reusable-delta manifests, and manual/legal review for unclear regions. |
| Confusing stack parity with code copying | Same languages and high-level architecture could lead contributors to recreate GPL structure too closely. | Allow Tauri/Rust/TypeScript/React/SQLite parity and owner feature reuse, but require fresh base layout, schemas, generated bindings, final UI copy, styling, and assets. |
| Over-reliance on old architecture | New app may be argued to be structurally derivative or inherit old limitations. | Keep only broad architectural parity; use domain-first boundaries in this plan; rename concepts where not generic; document independent alternatives considered. |
| Hidden copied UI text or assets | Licence and branding risk. | Create original copy deck, icons, themes, sounds, piece assets, and screenshots; audit translations and resource folders; keep only approved owner-created assets. |
| Distinctive GPL/native names copied into APIs | Internal structure may reveal old implementation influence. | Use new names for base modules, commands, types, state keys, generated bindings, and database tables; keep owner-authored feature names only when reviewed and useful. |
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
| Parity goal mistaken for broad copying permission | A "1:1 clone" instruction may cause GPL/native source, schema, UI, or asset copying. | Define parity as behavior plus approved owner-code reuse; keep reusable-delta bundles and code-review gates; require original base naming, schemas, copy, styling, and assets. |
| Stale parity specification | The fork continues to gain features after this document is copied into the new repo. | Maintain a dated parity checklist sourced from `agents.md`; periodically export neutral behavior addenda; require owner approval for deferred features. |
| Feature-complete scope creep | Full parity can delay first usable proprietary builds. | Ship staged internal milestones, but label them foundation/MVP only until the full parity audit is complete. |
| Phone companion deployment drift | Desktop changes may not reach the hosted phone/PWA workflow. | Treat static web publish or its successor as done criteria for phone-facing changes and verify hosted-library manifests/imports. |
| Manual/legal review gaps | Unresolved uncertainty reaches release. | Maintain "needs manual/legal review" list; schedule review before beta and before commercial release. |

## 14. Manual Review Checklist

Before implementation starts:

- [ ] Record the owner's attestation that all non-native fork functionality was owner-added and is intended for heavy reuse where provenance confirms it.
- [ ] Compare the fork against the original En Croissant baseline and inspect the full git history to identify owner-created files, owner-authored feature hunks, owner tests, owner docs/scripts/prompts, generated owner outputs, native GPL/base code, and uncleared third-party material.
- [ ] Create reusable-delta bundles from the initial commits `42732755` through `6c9de0d8`, documentation commit `4c34803e`, and later owner-authored feature ranges identified by full-history extraction.
- [ ] Classify bundled items as new owner file, owner hunk from modified GPL file, owner feature region, owner asset, owner test, generated from owner-owned input, or needs manual/legal review.
- [ ] For modified GPL files, extract only owner-authored hunks/regions or rewrite the behavior from the behavioral spec.
- [ ] Export the current `agents.md` product map into a behavior-only parity checklist with dated source coverage.
- [ ] Confirm that "1:1 clone" is written in implementation prompts as "1:1 behavioral replacement with heavy approved owner-code reuse, original base implementation, and original product design."
- [ ] Create a physically separate repository for the proprietary rebuild; do not fork, clone, or rename this repository.
- [ ] Confirm the new repository has its own `.git` directory, independent first commit, independent remote, and no connection to this repository's history.
- [ ] Copy only this plan, the neutral parity checklist, design direction brief, and approved owner-delta bundles into the new repository.
- [ ] Remove the old GPL repository from the active implementation workspace after the controlled delta extraction is complete.
- [ ] Keep the old repository closed/read-only during implementation sessions unless a new owner-reviewed delta/spec export is needed.
- [ ] Use only this plan, later clean-room specifications, public documentation, and the reviewed owner-delta bundle as implementation references.
- [ ] Confirm implementation agents are instructed not to open, inspect, or copy the old GPL repository directly.
- [ ] Choose a proprietary-compatible licence for the new application.
- [ ] Verify every direct and transitive dependency licence.
- [ ] Avoid GPL/AGPL dependencies unless deliberately chosen after legal review.
- [ ] Decide whether engines are user-supplied, separately downloaded, or bundled; get legal review before bundling GPL engines.
- [ ] Replace all GPL/native branding, names, logos, icons, screenshots, sounds, board themes, and piece sets with original or rights-cleared proprietary assets.
- [ ] Write original final UI copy and original public documentation, while allowing approved owner-authored docs/prompts/specs to be reused internally.
- [ ] Avoid copying UI text, empty states, tooltips, error messages, translation strings, or settings labels.
- [ ] Design a fresh folder structure and module naming system.
- [ ] Design a fresh database schema and migration strategy.
- [ ] Design fresh generated API bindings if needed.
- [ ] Create independent test fixtures from public rules, original examples, or permissively licensed datasets.
- [ ] Create a release-blocking full-parity audit that covers desktop, phone/web, prep, coach, review/training, online data, files/databases, reports, and settings.
- [ ] Document independent design decisions in a clean-room design log.
- [ ] Mark uncertain items as "needs manual/legal review."
- [ ] Get legal review before commercial release.

## 15. Implementation Prompt Templates

Use these prompts later in the fresh repository. Each prompt forbids open-ended reference to the old GPL repository. If a task should reuse owner-authored work, provide Codex with a reviewed owner-authored reusable-delta bundle and explicitly say which files or hunks are approved to copy. When asking for full parity, say "behavioral replacement with heavy approved owner-code reuse" rather than "port the GPL app."

### Extract owner-authored reusable code

```text
In the GPL-derived extraction workspace, inspect the fork's full git history and compare it against the original En Croissant baseline to identify all owner-authored non-native feature code, tests, docs, scripts, prompts, assets, and generated outputs. Use git log, git show, git diff, git blame, upstream comparisons, and manual review. Build reusable-delta bundles with a manifest classifying each item as owner-created file, owner hunk from modified GPL file, owner feature region, owner asset, owner test, generated from owner-owned input, third-party needs review, or GPL/native base do not copy. Do not implement proprietary product code in this workspace.
```

### Create the neutral parity checklist

```text
Create a behavior-only parity checklist for the proprietary chess workstation from the supplied product-map excerpt and this rebuild plan. Do not inspect or reference the old GPL repository. Convert each workflow into user goals, inputs, outputs, edge cases, data outcomes, acceptance criteria, and suggested independent tests. Do not include old source paths, component names, command names, schema names, UI strings, CSS details, screenshots, or implementation details. The checklist should cover desktop board/workspace, analysis/engine/cloud evals, databases/files/export, online imports/studies, prep/strength/coach report, AI Coach, Opening Review, Mistake Review, Puzzle Training, Practice Bot, Blindfold, Plan Explorer, structures, phone/web companion, hosted library publishing, settings, migrations, and verification.
```

### Create the separate proprietary repository

```text
Create a brand-new proprietary repository for a feature-complete behavioral replacement of the current chess workstation with heavy approved owner-code reuse. Do not fork, clone, rename, or continue from the old GPL-derived repository. Initialize independent git history. Use the same broad stack for transfer ease: Tauri 2, Rust, TypeScript, React, Vite, and SQLite, subject to licence review. Add only original project scaffolding, import this plan, the neutral parity checklist, the design direction brief, and approved owner-delta bundles as reviewed inputs. Do not copy GPL/native source trees, build configs, generated files, assets, lockfiles, CI files, UI text, database schemas, or git history.
```

### Import owner-owned reusable delta

```text
Import the approved owner-authored reusable code bundles into this separate proprietary repository. Do not open, inspect, or copy from the old GPL repository. Only use the files/hunks/regions/assets/tests/docs/scripts included in the approved bundles. Preserve useful owner-written logic heavily where it fits the new architecture, adapt APIs and modules as needed for this new codebase, and do not import GPL/native base files, old folder structure, old UI text, old schemas, or generated files that were derived from GPL sources unless separately approved.
```

### Create the initial app skeleton

```text
Create the initial desktop app skeleton for a proprietary chess workstation in this separate fresh repository. Use the same broad architecture class as the current app for transfer ease: Tauri desktop shell, Rust native service layer, TypeScript/React front end, Vite build, SQLite-ready persistence layer, generated front-end/back-end bindings from fresh definitions, and background job/event plumbing. Do not reference, inspect, or copy any old GPL repository, GPL/native source files, folder structure, UI text, assets, schemas, generated code, tests, or implementation details. If approved owner-authored reusable-delta bundles are provided, use only the approved items from those bundles. Use this repository's plan, the neutral parity checklist, the design direction brief, and public documentation for selected dependencies. Set up original project structure, original placeholder branding, licence notes, and dependency licence tracking. Do not implement chess features yet.
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

### Run the full parity audit

```text
Audit this proprietary repository against the supplied neutral parity checklist. Do not inspect the old GPL repository. For each workflow, mark it implemented, partially implemented, intentionally redesigned, deferred with owner-approved reason, legally blocked, or missing. Verify that implementation names, schemas, UI copy, styling, assets, build scripts, generated APIs, fixtures, and docs are original or from approved owner-delta bundles. Produce a release-blocking issue list for any missing parity, contamination risk, licensing issue, or unverified data-migration/import/export path.
```
