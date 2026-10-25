# Remaining Novelty synchronization work

This ledger accompanies `NOVELTY_SYNC_2026-10-24.md`. The full recent change
inventory is `NOVELTY_SYNC_2026-10-24_INVENTORY.json`, generated read-only by
`node scripts/audit-novelty-changes.mjs --out PATH`. It covers all fetched/local
branches from 24 July, including later feature branches and current source
hashes. Filename/hash comparisons nominate candidates; they do not prove
behavioral parity. Repeated integrations and rejected research are included in
the history inventory, not counted as separate missing features.

Current delivery (2026-10-25): clean `41668e2b` is live on the canonical phone
site. The latest native desktop artifact is clean `e386a802`, including guarded
local-engine setup, logo recovery, persistent plan arrows and all verified
Stockfish 19 resources and stored-evaluation controls.
These include the committed ports described below. The existing PC
helper also runs the verified 19 executable; actual HTTPS analysis and phone
version/asset/workspace/library/tournament reads pass. Individual rows retain
historical milestone receipts. Browser-rendered, native-window and physical-phone
checks remain unverified. The Windows Stockfish catalog controls pass 655 clean
related checks/types and the native build; rendered verification and the full candidate audit
remain active; see `NATIVE_STOCKFISH_19.md` and the current delivery JSON.

## Confirmed remaining differences requiring implementation or target evaluation

| Novelty improvement | Source evidence | En Croissant follow-up |
| --- | --- | --- |
| Stored evaluation position binding and finite scores | `c2760248`; raw FEN/score validation | Six old-parser failures reproduced and fixed at the shared phone live/cache/Prep boundary. Supplied four-field FEN, finite scores, legal prefixes, original ranks, zero and legacy replies are handled; invalid HTTP200 remains retryable. Clean41668e2b passes454 checks/63 files/types/canonical build22.53s and is live with exact assets, unchanged workspace/normalized-library/settings/routes and actual bounded legal Stockfish19 evidence. Native typed/hash-keyed local lookup is unchanged. Rendered/touch proof remains; see `STORED_EVALUATIONS.md` |
| Managed catalog installation survives dialog close | `66def21d`, `1274bc9f`; managed state, file progress and retry | Native LCZero/third-party cards now retain operation ownership across close/reorder, separate file/validation/save phases, and require durable matching profiles. Failed saves retry without reinstalling; owner changes/removals and existing custom paths remain. Three prior failures reproduced; 98 related checks/eleven files, types and warning-free seven-file lint pass. Clean e386a802 passes633 related checks/85 files, types and native packaging; exact embedded engine-page bytes/all102 engine resources match. Rendered proof remains; phone managed WASM/PC controls have no arbitrary desktop installer. See `CATALOG_ENGINE_INSTALLS.md` |
| Retryable downloaded-evaluation read failures | `848f4527`; rejecting local reader and failed-promise eviction | Native structured read failures no longer become cached misses; same-FEN/PV consumers share a bounded pending read and failed requests remain retryable. Genuine misses retain caching, optional consumers keep their existing catches and no global unwrap toast/network fallback is added. Three prior failures reproduced; 24 related checks/five files, types and warning-free four-file lint pass. Phone already distinguishes 503 from JSON404 and evicts rejected requests; its actual same-FEN recovery fixture passes without production changes. Clean18e8c74e passes607 related checks/82 files, types and native packaging; exact reader/consumer assets and all102 engine/source files match. Phone production is unchanged; live source stays41f60e91. See `STORED_EVALUATIONS.md` |
| Stored/cloud-evaluation switch for local analysis | `ece3e18e`, `18f81ed0`; Novelty engine panel and Engines cloud-enabled preference | Native Engines/analysis and phone Live settings now share an explicit stored-evaluation choice through each native architecture. Cache/deferred score/arrow filters, abortable stored consumers and ordered same-engine stop settlement prevent old data or searches returning after Off. Failed saves retain the session choice through remount with retry. Native default On, existing phone saved/default values, separate explicit cloud profiles and fresh reports/Plans remain. Three actual prior failures were reproduced; 128 related checks/19 files, full types and scoped lint pass (only unchanged baseline warnings). Clean `41f60e91` passes all 591 related checks/79 files, types, native packaging and the canonical phone build; exact embedded/engine resources match. It is now HTTPS-verified live with owner workspace/settings/routes preserved. Rendered checks remain; see `STORED_EVALUATIONS.md` |
| Stable official engine logos and custom-image failure recovery | `497f656b`, Novelty `engineLogo.tsx` and bundled marks | Native engine names and both catalog flows now try custom images, inline official marks and existing generic icons in order. Profile/image ownership rejects late replies/errors; navigation retries without rewriting saved choices. Three prior failures reproduced; twelve image checks plus catalog/registration regressions (40 checks/three files), types and scoped lint pass. Attribution retains original artwork limitations. Phone managed-engine text controls have no custom profile image state. Clean combined source `0a0056a6` passes 107 engine checks/nine files, types and the complete native build; exact embedded asset and all 102 engine resource hashes match. Rendered verification remains; see `ENGINE_LOGOS.md` |
| Cancellable local-engine setup and late validation replies | `66def21d`, Novelty engine profile validation signal and Add engine lifecycle | Native source now guards chooser/UCI/save ownership, preserves custom settings/images/names, and retains failed profile writes for retry without duplicates. UCI requires `uciok`, a total 15-second deadline and awaited owned-process cleanup; cancel/late replies cannot register. Four failures reproduced on the old form; 95 focused frontend checks/eight files, six native checks including actual Stockfish 19, full types, warning-free seven-file lint and native compile pass. Clean setup source `dab8e02d` passes 549 related checks/71 files and types; combined source `0a0056a6` passes 107 engine checks/nine files and the native build with exact embedded assets/resources verified. Rendered checks remain. Phone managed WASM/service surfaces do not select arbitrary local programs; no native-setup parity applies. See `LOCAL_ENGINE_SETUP.md` |
| Automatic plan arrows take priority, with independent hover layers | `ea3bbbd9`, `c3ec2b03`; Novelty `planArrowPriority.ts` and persistent overlay owners | Native Plans/Engine Plans claim priority per tree store even while empty/loading; automatic/hover/saved layers persist, filter by displayed FEN and deduplicate without changing saved annotations. Owned preview lifetimes reject stale cleanup/setters. Phone Analysis A now has Auto arrows/limit, side/horizon routes and hover/focus/tapped details; hidden panels release claims and workspace changes reject same-FEN late results. Three prior composition failures reproduced; 65 checks/seven files, types and warning-free twelve-file lint pass. WebApp retains its exact 25 baseline warnings. Clean `1f597195` passes 619 related checks/77 files, types, native packaging and the canonical phone build. Nine exact embedded chunks/all 102 engine resources match. Combined source `41f60e91` now carries these controls in the HTTPS-verified live phone app; rendered verification remains. See `PLAN_ARROWS.md` |
| Fast game-analysis presets and combined depth/time bounds | `b6089855`; Low 8/50ms, Medium 16/250ms, High 22/1s, custom limits | Native bounds/recovery, both actions and PGN/session metadata are delivered. Real Stockfish 81-position Low runs complete in 1.66/1.04 s. Phone now has a fresh bounded-report transport with exact legal chosen-root evidence, a shared recovery budget and cancellation/queue guards; 30 frontend, 19 Node and an isolated real-service check pass. Phone controls and canonical report persistence are now wired in the selected A surface; shared engine protocol is delivered and HTTPS-verified; the phone UI is included in observed `dfc21831`; responsive and end-to-end runtime checks remain; see `GAME_ANALYSIS_LIMITS.md` |
| Exact game-accuracy math and custom starts | `a923445e`, `docs/GAME_ACCURACY.md` | Native canonical reports are delivered. Phone report core now reuses those pure tree/history/accuracy/run modules, validates SAN/UCI/FEN replay, handles Black/custom starts and terminal/repetition/fifty-move results, and verifies saved game/score/depth evidence before rebuilding display data. Thirty-two mixed core/transport/metadata checks pass. Calibrated `statsStrength.ts` stays separate. The owner selected Board Analysis (A) in `design/phone-analysis-parity`; controls and durable save/retry wiring are included in observed `dfc21831`; responsive and end-to-end runtime checks remain |
| Engine Plans default depth 17 | `ff7e42db` / `a212c9e1` | Native source and rebuilt standalone artifact now use 17 for fresh preferences/empty input; explicit saved choices remain. The new phone Plans surface defaults to 17 with independent saved preferences; source/component checks pass and the UI is included in observed `dfc21831`; responsive/end-to-end runtime checks remain |
| Legal, unique PV evidence and continuation coverage | `35e19846` | Native chessops implementation now retains real ranks, legal/unique roots, exact continuation snapshots, competitive alternative ideas, cached horizons and conditional scores. All 66 plan/presentation/strength checks pass; changed controls verified at 390px and the new module is embedded in the rebuilt artifact. Phone Plans now adapts the same pure extraction/evidence/coverage engine with fresh exact legal PVs, cached horizons and supporting-line play. Desktop independent setup-strength/practical mining controls stay target-specific; see `PHONE_ANALYSIS.md`. Source/component checks pass and the UI is included in observed `dfc21831`; responsive/end-to-end runtime checks remain |
| Saved drawing ownership on phone | `5f3ea481` (desktop repair is committed) | Phone now imports root/move/variation PGN marks, separates saved `shapes` from engine `autoShapes`, and saves exact history-scoped nodes through the existing workspace transaction and portable PGN. Draw adds touch square taps and explicit per-node removal; late owner callbacks are rejected. Fifteen new core/real-component checks plus related phone regressions give 85 checks/eight files. Clean types/lint and canonical phone build pass; responsive visual verification and runtime delivery remain; see `PHONE_DRAWINGS.md` |
| Per-file board/source preferences | `97353864` and current Database/Prep integration | Native now remembers non-dirty file orientation and independent side/under-board player/general Prep sources; existing Database/Compare maps hydrate synchronously. Successful moves migrate choices/bindings, and Save/Save as retain live selections. Primary and clean `75ea649f` pass 76 checks/types/build. Phone now persists manual views and per-workspace Database sources/filters through its root writer and independent Player/General Prep source defaults; actual control/file-switch/mode/remount checks join 407 passing product phone checks. Clean `46bf0caa` passes types/lint and canonical-phone/desktop builds; all 31 files match. See `FILE_BOARD_PREFERENCES.md`. Runtime/rendered delivery and remaining date scopes stay separate. Product keys/IDs are not shared |
| Imported PGN orientation and standalone starting positions | `e4233ec2` (new since the first inventory) | Delivered from clean `44c37e09` in native desktop and hosted phone. Imported perspectives normalize and persist through preview/tab opening; unmarked standalone positions face their starting mover. Phone keeps unplayed FENs, with explicit Prep/player choices authoritative. Actual import controls and drawing/orientation fixtures pass; see `PGN_ORIENTATION_PREVIEW.md` |
| Reversible database archive labels and clear folder names | `376fe441` | Native reversible markers already exist (`35d75f3c`), follow renames and filter shared `getDatabases()`; five checks pass. Phone now has durable file/folder/device-collection visibility labels, explicit restore controls and filtered new Database/Prep choices. Existing selections are retained and labelled; games, notes, progress and aggregate coverage remain intact. Actual flow and identity/persistence regressions join 414 passing phone checks/types/lint. Clean `46b48b02` passes 419 combined checks and canonical-phone/desktop builds; eleven files match. Hierarchical folder names were already present. See `PHONE_SOURCE_ARCHIVES.md`; rendered/runtime delivery remains |
| Date presets and calendar ranges across Prep/Database placements | Current Novelty `GameDateRangeControl`, `gameDateRange`, `useGameDateRange` | Native Database side/below-board, Compare and Prep now have calendar/custom and rolling controls with independent file/placement/mode/source choices, legacy migration, strict query-boundary resolution and midnight cache refresh. Invalid saved filters require explicit repair; stale Prep results cannot append moves after a context change. Primary and clean `74c3a1d6` pass 559 related frontend checks/69 files, full types and scoped lint; clean desktop and canonical-phone builds pass, and 24 owned files match. See `GAME_DATE_RANGES.md`. Phone now uses the same controls with independent workspace/Database/Prep/mode/source choices, retained rolling Prep metadata and midnight training refresh. Actual controls and serializers join 570 passing related checks/71 files, full types and scoped lint. Lazy aggregate-only sources visibly require All time or a full PGN import; they cannot silently return unfiltered counts. Clean `be9e7eb1` independently passes all 570 checks/types/lint and desktop/canonical-phone builds; ten files match. Rendered/runtime delivery remains |
| Stockfish version and safe default upgrades | `c1f5b659` plus the earlier included-engine/catalog changes | The 55 engine-management candidates remain individually subject to target evaluation. Native profile safeguards preserve invalid/empty/custom/newer/hidden choices, retain failed writes and defer enabled/paused sessions. Phone local live/Plans/reports now use pinned Stockfish 19 lite and recover from critical worker failures; new evidence keeps actual UCI identity and legacy scores are not relabelled as 19. The PC helper learns real identity after requested startup while health leaves workers stopped; existing service/root/task/ports stay compatible. Primary `cc5680bd` and clean `54421267` match 27 owned files; 599 related checks/76 files, full types, scoped lint, real native 18/19 helper and lite WASM checks, and desktop/canonical-phone builds pass. See `NATIVE_ENGINE_PREFERENCES.md` and `ENGINE_VERSION_ROUTING.md`. Native 19 authenticated installer/build staging and idle one-time default migration are now implemented; 58 frontend, ten native-core, two build-target and eight actual-19 live-output checks pass, with types/lint/native checks and two 81-position depth-eight reports at 571/580 ms. See `NATIVE_STOCKFISH_19.md`. Clean packaged resources now match all 102 source files; the PC helper returns actual Stockfish 19 bounded evidence over canonical HTTPS, and phone source `89f64228` is published with verified WASM 19 assets and working data APIs. Windows Stockfish catalog controls now pass 77 focused checks/types, including real Add engine/offline/remount/cancel/save-retry flows. Clean catalog source `10b440d8` passes 655 related checks/78 files, full types and the native build; all 102 engine resources match and its exact catalog chunk is embedded. Individual candidate evaluation and rendered/physical verification remain pending |
| Prep source refresh and concise setup layout | `397fc567`, `699738d7` | Native folder-based pickers refresh on open; phone Database/Prep force-refresh manifests while retaining successful listings on failure. Search/selection remain stable, errors retry beside the picker, and superseded requests cannot replace refreshed caches. Delivered as phone source `cc3e71d2` and a rebuilt native artifact; connected Chrome at 390px verifies refresh/search. Existing compact-density, focus/autofill and orientation controls are retained; remaining per-file/date scope is tracked separately |
| Failed/overlapping review persistence | `fb5b8233` | Native file-backed decks now share an ordered per-path writer with immutable/coalesced pending snapshots, failed-save retention across remount, visible Retry save and safe page-hide/delete boundaries. Nine regressions and existing native/phone review checks pass (92 checks/ten files); types/lint pass. Phone already retains its root-owned workspace writer. Clean runtime and rendered error-layout delivery remain; see `REVIEW_SAVE_RESILIENCE.md` |
| Background maintenance cadence after browser storage failure | `88e97630` | Already resilient through native timer ownership: tournament callbacks re-arm the interval after completion/failure without reading browser storage; replacing/stopping a registration cancels its old scheduled callback. Three focused fake-clock checks pass. Online/study updater hooks use fixed timers and in-memory running refs, and phone review polling uses a pending guard. En has no persisted app-wide last-run map to port; see `REVIEW_SAVE_RESILIENCE.md` |
| Mistake Review legal played-move recognition | `fe5ccd04` | The Novelty post-move/resulting-FEN bug is absent: native `Board.makeMove` captures the card's original FEN/SAN/UCI before updating the tree, then guards delayed assessment by request/card/FEN/move/phase. Phone attempts replay from `card.fen` and keep result previews separate. Existing native assessment and actual phone grade-flow checks pass; no controller replacement is needed. Tactical certificates are retained |
| Source-bound/no-clobber Files saves and large-file request races | `a1c84b5d`, `f32e7bf5`, current source | Implemented in native source: captured game SHA-256 identity, fresh spans, unique relocation, staged atomic replacement, full-source recheck, no-clobber new filenames/metadata, per-file completion ordering and safe deletion/append. Virtual headers await parsing and merge ranges; retry/path/version guards, current counts and preview opening prevent stale ownership. Eighteen native filesystem and 93 frontend checks, types, 24-file lint and whole native check pass. Native/browser runtime delivery remains separate; external noncooperative filesystem CAS and identical-content identity limits are explicit in `NATIVE_PGN_FILES.md` |
| Database-row save identity | Current Novelty `saveGame.ts` / `library_replace_game` | Native database queries now capture stored row/related-metadata SHA-256 identities and all five opening surfaces retain them. Saves compare and update in an immediate SQLite transaction, refresh queued identities and roll back related names on failure. Seven native SQLite/protocol and 24 frontend save/open checks plus types pass; scoped lint has one existing warning. See `DATABASE_SAVE_OWNERSHIP.md`; native runtime delivery remains. Phone workspace transactions stay separate |
| Practice/new-game source ownership | Native `BoardControls`, bot and Blindfold shortcuts evaluated during source-safety port | All three shortcuts now create an unbound play tab from the exact selected FEN and preserve the original analysis, annotations, dirty state and source binding. Keyed blindfold initialization and activation guards preserve another selected tab. Twelve new regressions and related save/preview/bot checks total 68/eight files; types and lint pass. Native runtime remains; see `PRACTICE_TAB_OWNERSHIP.md`. Phone has no corresponding native multi-tab shortcuts |
| Automatic meaningful-tab save before Clear tabs | Current Novelty `clearTabs.ts` / `ClearTabsButton` | Implemented in native source: one control saves meaningful original live trees through protected file/database paths, automatically names new Files PGNs without prompts, promotes temporary games and flushes retained review writers. All originals stay open on failure/newer content/binding/phase changes; new tabs stay and retries retain successful bindings. Browser-storage close failures restore in-memory tabs. Eighteen new synthetic/component checks and related regressions total 95/eleven files; types and lint pass. Native runtime/rendered delivery remain; see `CLEAR_TABS.md`. Phone has its separate root-owned writer rather than this native multi-tab path |
| Preview annotations, variations and starting-position notes | `ef05c032`, current annotation editor | Delivered in native desktop `44c37e09`: full read-only notation keeps saved notes/NAGs/variations visible independently of edit preferences and renders selected-node marks with rotated pieces. Boards fit short/narrow panes; isolated controls preserve active-board shortcuts/clocks. Circle export and native brush defaults/style redraws are repaired. Phone saved-node drawings are now implemented in source, with visual/runtime delivery separately tracked |
| Startup engine score coalescing and stable evaluation display | `58741060`, earlier retarget fixes | Native, desktop PC streaming and phone live output now coalesce startup bursts through their own architecture, preserve final/quiet-stream updates and discard cancelled/retargeted/post-final output. Native/PC display stays at 500 ms; phone keeps 120 ms. Cached native reads cannot bypass startup; phone live bounds are rejected. Eight native checks (including real Stockfish), 39 frontend checks, types/lint and full native check pass. Thirteen broad native failures exactly reproduce on the unchanged baseline. Clean delivery `eb898149` verifies all eight focused native checks, 134 combined frontend checks, types/lint, whole native check and desktop/canonical-phone builds. Runtime/rendered delivery remains; see `LIVE_ENGINE_OUTPUT.md` |
| Always-visible Database W/D/L percentages | `de844abd` (new since the first inventory) | Delivered from clean `5f5f45c4` in the standalone desktop and hosted phone. Shared native Database/Prep/review/health and phone Database/Prep rows retain tiny/zero labels, empty/invalid distinction and original perspective/precision/palettes. Nine checks and connected Chrome at 390px verify actual result rows and computed segment colours; source fixtures cover 320px/doubled text/light/dark. See `DATABASE_RESULTS.md` |

## Already present or deliberately separate

- Native score pills already use White-relative values and distinct positive/
  negative surfaces (`53dfe445`); the parser inverts Black-to-move scores before
  display. Phone Analysis A uses text scores with tested White normalization,
  rather than the same pill interface. Native Mantine controls/styles remain;
  Novelty's capsule-switch CSS (`9bd9c0ca`) is not copied into another identity.

- Native evaluation/scoring deliberately remains local-only under the existing
  En Croissant owner rule recorded after the 22 June correction in AGENTS.md.
  Novelty's optional remote Lichess/ChessDB lookup switches (`135060ca`,
  `e8ddefb9`, `c379a8a6`) must not override it or duplicate the retained corpus.
  The new stored-evaluation control and read-recovery behavior keep that rule.
- The `66def21d` cancellation payload applies to manual profile validation;
  managed installs explicitly continue after closing their modal. Native LCZero
  and third-party catalog cards now retain owned progress/errors/retries across
  close/reopen and require validated durable profile completion. Three prior
  actual-component failures reproduced; 98 related checks/eleven files, types
  and seven-file warning-free lint pass. The phone has no matching arbitrary
  desktop installer. Native clean builds/rendered checks remain separate;
  see `CATALOG_ENGINE_INSTALLS.md`.

- Saved tournament prediction history/player comparison (`a7fdf330`) and the
  concise empty state (`647c4efb`) are already mirrored in native/phone source
  `8c6b4cac`/`dfc21831` and `609a66c6`/`b2328666`. Current source retains saved
  versions/comparison and the heading-versus-summary guard. Historical runtime
  observation includes this feature; refresh live delivery during final checks.

- The concurrent tournament-search quality feature (Novelty `64103642`, En
  `3e504902`) is retained in clean delivery `58e1c55c`: saved region/country,
  rough-word and numeric-section matching, bounded supplemental lookup, shared
  cache/retry/cancellation and past-date actions. Its 44 selected search checks
  join 93 PGN/preview/report/phone checks in a passing 137-check combined build.
  Source/browser evidence from that feature is documented separately; hosted
  and installed delivery remain pending.

- Saved Play UCI options (`51e4751c`) are already present through En's native
  architecture: BoardGame resolves per-player/profile settings,
  buildPracticeBotOptions preserves custom options (apart from analysis-only
  MultiPV), and GameManager sends the resolved options to each engine before
  search. Thirteen current practice-bot checks pass, including custom network
  forwarding. Keep per-game overrides and the richer Maia/strength behavior.
- Two branch pairs have identical engine code patch IDs: `e3e2be1e`/`06df535e`
  (retarget stability) and `badb59cb`/`e87c2c4c` (main-board hover). They are
  duplicate source payloads, rather than four separate missing improvements.
  This does not replace target-specific behavior verification.

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

The refreshed inventory contains 580 Novelty commits across local/fetched
branches, with primary Novelty head still `e4233ec2`. Four additions to the
previous 576-commit inventory are tournament-search quality, saved prediction
history, its concise empty state and the Stockfish default upgrade. The first
three are already mirrored; the engine-management row remains an explicit audit
item. En history/source hashes are refreshed through engine source
`cc5680bd` (453 En commits). All 169 Novelty remote branch heads were checked
against current remote data and match the fetched refs. The inventory now names engine management separately,
so these candidates cannot disappear into an uncategorized group. Comparisons
include the current source checkout and remain candidate evidence only.

This is an active work list. No row is silently marked complete from a file
copy, a historical test receipt, a static shell HTTP response or a successful
build. Physical-device interaction remains a separate evidence boundary.

- Phone stored-response validation (Novelty `c2760248`): six old-parser failures
  reproduced and fixed at the shared live/Prep/cache boundary. Supplied FENs
  match the requested four-field position; finite scores, legal PV prefixes,
  real ranks, White-relative values and legacy missing-FEN replies are retained.
  Invalid HTTP200 stays retryable; genuine misses remain. Seven new checks join
  95 passing related checks/seven files, full types and lint with only the
  adjusted existing fixture's unrelated warning. Native typed/hash-keyed lookup
  already supplies this contract. Clean phone build/publication remain; see
  `STORED_EVALUATIONS.md`.
