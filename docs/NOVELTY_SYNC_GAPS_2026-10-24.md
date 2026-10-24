# Remaining Novelty synchronization work

This ledger accompanies `NOVELTY_SYNC_2026-10-24.md`. The full recent change
inventory is `NOVELTY_SYNC_2026-10-24_INVENTORY.json`, generated read-only by
`node scripts/audit-novelty-changes.mjs --out PATH`. It covers all fetched/local
branches from 24 July, including later feature branches and current source
hashes. Filename/hash comparisons nominate candidates; they do not prove
behavioral parity. Repeated integrations and rejected research are included in
the history inventory, not counted as separate missing features.

## Confirmed remaining differences requiring implementation or target evaluation

| Novelty improvement | Source evidence | En Croissant follow-up |
| --- | --- | --- |
| Fast game-analysis presets and combined depth/time bounds | `b6089855`; Low 8/50ms, Medium 16/250ms, High 22/1s, custom limits | Native bounds/recovery, both actions and PGN/session metadata are delivered. Real Stockfish 81-position Low runs complete in 1.66/1.04 s. Phone now has a fresh bounded-report transport with exact legal chosen-root evidence, a shared recovery budget and cancellation/queue guards; 30 frontend, 19 Node and an isolated real-service check pass. Phone controls and canonical report persistence are now wired in the selected A surface; shared engine protocol is delivered and HTTPS-verified; the phone UI is included in observed `dfc21831`; responsive and end-to-end runtime checks remain; see `GAME_ANALYSIS_LIMITS.md` |
| Exact game-accuracy math and custom starts | `a923445e`, `docs/GAME_ACCURACY.md` | Native canonical reports are delivered. Phone report core now reuses those pure tree/history/accuracy/run modules, validates SAN/UCI/FEN replay, handles Black/custom starts and terminal/repetition/fifty-move results, and verifies saved game/score/depth evidence before rebuilding display data. Thirty-two mixed core/transport/metadata checks pass. Calibrated `statsStrength.ts` stays separate. The owner selected Board Analysis (A) in `design/phone-analysis-parity`; controls and durable save/retry wiring are included in observed `dfc21831`; responsive and end-to-end runtime checks remain |
| Engine Plans default depth 17 | `ff7e42db` / `a212c9e1` | Native source and rebuilt standalone artifact now use 17 for fresh preferences/empty input; explicit saved choices remain. The new phone Plans surface defaults to 17 with independent saved preferences; source/component checks pass and the UI is included in observed `dfc21831`; responsive/end-to-end runtime checks remain |
| Legal, unique PV evidence and continuation coverage | `35e19846` | Native chessops implementation now retains real ranks, legal/unique roots, exact continuation snapshots, competitive alternative ideas, cached horizons and conditional scores. All 66 plan/presentation/strength checks pass; changed controls verified at 390px and the new module is embedded in the rebuilt artifact. Phone Plans now adapts the same pure extraction/evidence/coverage engine with fresh exact legal PVs, cached horizons and supporting-line play. Desktop independent setup-strength/practical mining controls stay target-specific; see `PHONE_ANALYSIS.md`. Source/component checks pass and the UI is included in observed `dfc21831`; responsive/end-to-end runtime checks remain |
| Saved drawing ownership on phone | `5f3ea481` (desktop repair is committed) | Phone now imports root/move/variation PGN marks, separates saved `shapes` from engine `autoShapes`, and saves exact history-scoped nodes through the existing workspace transaction and portable PGN. Draw adds touch square taps and explicit per-node removal; late owner callbacks are rejected. Fifteen new core/real-component checks plus related phone regressions give 85 checks/eight files. Clean types/lint and canonical phone build pass; responsive visual verification and runtime delivery remain; see `PHONE_DRAWINGS.md` |
| Per-file board/source preferences | `97353864` and current Database/Prep integration | Evaluate native tab/file/session persistence and phone saved workspaces. Novelty's exact settings key and collection IDs are product-specific and must not be shared |
| Imported PGN orientation and standalone starting positions | `e4233ec2` (new since the first inventory) | Delivered from clean `44c37e09` in native desktop and hosted phone. Imported perspectives normalize and persist through preview/tab opening; unmarked standalone positions face their starting mover. Phone keeps unplayed FENs, with explicit Prep/player choices authoritative. Actual import controls and drawing/orientation fixtures pass; see `PGN_ORIENTATION_PREVIEW.md` |
| Reversible database archive labels and clear folder names | `376fe441` | Native reversible file/folder markers already exist (`35d75f3c`), follow renames, and exclude archives through shared `getDatabases()`; five helper checks pass. No database rewrite is needed. Phone has a separate hosted/local collection catalogue whose visibility still needs evaluation |
| Date presets and calendar ranges across Prep/Database placements | Current Novelty `GameDateRangeControl`, `gameDateRange`, `useGameDateRange` | En already has `start_date`/`end_date` native query fields and phone local-date filters. Audit every line-search/cache/training path, then add rolling presets and independent selection scopes |
| Prep source refresh and concise setup layout | `397fc567`, `699738d7` | Native folder-based pickers refresh on open; phone Database/Prep force-refresh manifests while retaining successful listings on failure. Search/selection remain stable, errors retry beside the picker, and superseded requests cannot replace refreshed caches. Delivered as phone source `cc3e71d2` and a rebuilt native artifact; connected Chrome at 390px verifies refresh/search. Existing compact-density, focus/autofill and orientation controls are retained; remaining per-file/date scope is tracked separately |
| Failed/overlapping review persistence | `fb5b8233` | Native file-backed decks now share an ordered per-path writer with immutable/coalesced pending snapshots, failed-save retention across remount, visible Retry save and safe page-hide/delete boundaries. Nine regressions and existing native/phone review checks pass (92 checks/ten files); types/lint pass. Phone already retains its root-owned workspace writer. Clean runtime and rendered error-layout delivery remain; see `REVIEW_SAVE_RESILIENCE.md` |
| Background maintenance cadence after browser storage failure | `88e97630` | Already resilient through native timer ownership: tournament callbacks re-arm the interval after completion/failure without reading browser storage; replacing/stopping a registration cancels its old scheduled callback. Three focused fake-clock checks pass. Online/study updater hooks use fixed timers and in-memory running refs, and phone review polling uses a pending guard. En has no persisted app-wide last-run map to port; see `REVIEW_SAVE_RESILIENCE.md` |
| Mistake Review legal played-move recognition | `fe5ccd04` | The Novelty post-move/resulting-FEN bug is absent: native `Board.makeMove` captures the card's original FEN/SAN/UCI before updating the tree, then guards delayed assessment by request/card/FEN/move/phase. Phone attempts replay from `card.fen` and keep result previews separate. Existing native assessment and actual phone grade-flow checks pass; no controller replacement is needed. Tactical certificates are retained |
| Source-bound/no-clobber Files saves and large-file request races | `a1c84b5d`, `f32e7bf5`, current source | Implemented in native source: captured game SHA-256 identity, fresh spans, unique relocation, staged atomic replacement, full-source recheck, no-clobber new filenames/metadata, per-file completion ordering and safe deletion/append. Virtual headers await parsing and merge ranges; retry/path/version guards, current counts and preview opening prevent stale ownership. Eighteen native filesystem and 93 frontend checks, types, 24-file lint and whole native check pass. Native/browser runtime delivery remains separate; external noncooperative filesystem CAS and identical-content identity limits are explicit in `NATIVE_PGN_FILES.md` |
| Database-row save identity | Current Novelty `saveGame.ts` / `library_replace_game` | Native database queries now capture stored row/related-metadata SHA-256 identities and all five opening surfaces retain them. Saves compare and update in an immediate SQLite transaction, refresh queued identities and roll back related names on failure. Seven native SQLite/protocol and 24 frontend save/open checks plus types pass; scoped lint has one existing warning. See `DATABASE_SAVE_OWNERSHIP.md`; native runtime delivery remains. Phone workspace transactions stay separate |
| Practice/new-game source ownership | Native `BoardControls`, bot and Blindfold shortcuts evaluated during source-safety port | All three shortcuts now create an unbound play tab from the exact selected FEN and preserve the original analysis, annotations, dirty state and source binding. Keyed blindfold initialization and activation guards preserve another selected tab. Twelve new regressions and related save/preview/bot checks total 68/eight files; types and lint pass. Native runtime remains; see `PRACTICE_TAB_OWNERSHIP.md`. Phone has no corresponding native multi-tab shortcuts |
| Automatic meaningful-tab save before Clear tabs | Current Novelty `clearTabs.ts` / `ClearTabsButton` | Canonical live trees and background-tab close ownership are implemented; ordinary close waits for Save, retains failed/cancelled/newer work and prompts for meaningful unsaved drafts. Explicit copies preserve the original dirty state. Source export now retains custom-root move counters and multiple NAGs without changing relative history indices (55 related checks/seven files). Automatic save-before-Clear-all is still required, together with the native file protections above |
| Preview annotations, variations and starting-position notes | `ef05c032`, current annotation editor | Delivered in native desktop `44c37e09`: full read-only notation keeps saved notes/NAGs/variations visible independently of edit preferences and renders selected-node marks with rotated pieces. Boards fit short/narrow panes; isolated controls preserve active-board shortcuts/clocks. Circle export and native brush defaults/style redraws are repaired. Phone saved-node drawings are now implemented in source, with visual/runtime delivery separately tracked |
| Startup engine score coalescing and stable evaluation display | `58741060`, earlier retarget fixes | Compare En's existing engine lifecycle, saved score and board overlay ownership before porting the state machine |
| Always-visible Database W/D/L percentages | `de844abd` (new since the first inventory) | Delivered from clean `5f5f45c4` in the standalone desktop and hosted phone. Shared native Database/Prep/review/health and phone Database/Prep rows retain tiny/zero labels, empty/invalid distinction and original perspective/precision/palettes. Nine checks and connected Chrome at 390px verify actual result rows and computed segment colours; source fixtures cover 320px/doubled text/light/dark. See `DATABASE_RESULTS.md` |

## Already present or deliberately separate

- The concurrent tournament-search quality feature (Novelty `64103642`, En
  `3e504902`) is retained in clean delivery `58e1c55c`: saved region/country,
  rough-word and numeric-section matching, bounded supplemental lookup, shared
  cache/retry/cancellation and past-date actions. Its 44 selected search checks
  join 93 PGN/preview/report/phone checks in a passing 137-check combined build.
  Source/browser evidence from that feature is documented separately; hosted
  and installed delivery remain pending.

- The current shared performance model, worker lifecycle and custom-period
  modules were already mirrored in source. Their missing committed prerequisites
  were reconciled and tested in this task; runtime delivery is tracked separately.
- Shared tournament evidence, result semantics, manual forecast results and
  native snapshot assembly were already present as unfinished source. They are
  now reconciled and tested. Existing accepted numerical weights remain; rejected
  research solvers/calibrations are not promoted.
- The October phone opponent picker, prep-side orientation, direct-link and
  installed-root queue handling are ahead of primary's older committed snapshot.
  The delivery merge retains them and passes their storage/import/Prep checks.
- OTB corpus indexing, full source coverage defaults, result deduplication,
  cancellation/checkpoint recovery and October exact-date recovery already exist
  in maintained En sources. Native/helper delivery must be verified independently
  from source, and full corpus acceleration must not be claimed from code alone.
- En's tactical classifier, proof certificates, daily study plans and persistent
  course windows are independent improvements. Retain them; do not replace their
  implementation with Novelty's simpler counterparts.
- Novelty licensing, payments, installer/updater identity, marketing/site work,
  proprietary parsing boundaries and product-specific profile migrations do not
  transfer to En Croissant. Its existing phone service identity/routes remain
  authoritative. A visual difference alone is not a missing behavior.

The refreshed inventory contains 576 Novelty commits through `e4233ec2`. Its
two additions to the original 574-commit snapshot are the delivered PGN
orientation and Database result-percentage changes. En history/source hashes
were refreshed after the review-save milestone.

This is an active work list. No row is silently marked complete from a file
copy, a historical test receipt, a static shell HTTP response or a successful
build. Physical-device interaction remains a separate evidence boundary.
