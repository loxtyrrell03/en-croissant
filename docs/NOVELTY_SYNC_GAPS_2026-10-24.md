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
| Fast game-analysis presets and combined depth/time bounds | `b6089855`; Low 8/50ms, Medium 16/250ms, High 22/1s, custom limits | Native `ReportModal` still sends one Depth/Time/Nodes `GoMode`; evaluate native runner and phone batch analysis separately before porting bounds |
| Exact game-accuracy math and custom starts | `a923445e`, `docs/GAME_ACCURACY.md` | Native `score.ts` still uses the old zero-harmonic rule and fixed +15 start. Phone `statsStrength.ts` is a separately calibrated engine-quality model with different windows/constants; preserve its calibration contract while evaluating a canonical report metric |
| Engine Plans default depth 17 | `ff7e42db` / `a212c9e1` | Fresh native default and empty-input fallback are now 17; explicit saved choices remain. Source verified; deliver with the next desktop batch. Phone does not expose this separate desktop panel |
| Legal, unique PV evidence and continuation coverage | `35e19846` | Native chessops implementation now retains real ranks, legal/unique roots, exact continuation snapshots, competitive alternative ideas, cached horizon filtering and source-qualified conditional scores. All 66 plan/presentation/strength checks, types and frontend build pass; actual changed controls verified at 390px. Desktop artifact delivery remains pending. Phone has no separate Engine Plans surface; equivalent phone capability needs design/target evaluation |
| Saved drawing ownership on phone | `5f3ea481` (desktop repair is committed) | Phone `WebBoard` supplies only transient `autoShapes`, with no saved-node drawing contract. Evaluate PGN annotation parsing, node identity and durable workspace ownership before adding persistence |
| Per-file board/source preferences | `97353864` and current Database/Prep integration | Evaluate native tab/file/session persistence and phone saved workspaces. Novelty's exact settings key and collection IDs are product-specific and must not be shared |
| Reversible database archive labels and clear folder names | `376fe441` | En uses filesystem databases and a native folder picker, rather than Novelty collection IDs. Implement equivalent visibility/preferences without deleting or linking databases |
| Date presets and calendar ranges across Prep/Database placements | Current Novelty `GameDateRangeControl`, `gameDateRange`, `useGameDateRange` | En already has `start_date`/`end_date` native query fields and phone local-date filters. Audit every line-search/cache/training path, then add rolling presets and independent selection scopes |
| Prep source refresh and concise setup layout | `397fc567`, `699738d7` | Verify native database discovery invalidation on picker open, saved selection across modes, and responsive native/phone controls. Preserve the phone's newer search-focus/autofill behavior |
| Failed/overlapping review persistence | `fb5b8233` | Different native deck/tree storage. Audit debounced session/local writes and real review save ownership; reproduce failures before replacing storage code |
| Background maintenance cadence after browser storage failure | `88e97630` | Different maintenance callbacks in En. Verify in-memory completion timestamps and stale queued registrations in its own architecture |
| Mistake Review legal played-move recognition | `fe5ccd04` | En has its own review controller and tactical pipeline. Check the actual parent-position/SAN acceptance path; preserve its more extensive tactical certificates |
| Source-bound/no-clobber Files saves and large-file request races | `a1c84b5d`, `f32e7bf5`, current source | Audit native Files writes and previews against source snapshots, unsaved drafts, late requests and save completion. Native path/filesystem identity differs from Novelty Library |
| Automatic meaningful-tab save before Clear tabs | Current Novelty `clearTabs.ts` / `ClearTabsButton` | Audit En tab closing/source binding and save failures. Preserve comments, variations, marks and nonstandard starts and keep tabs open when saving fails |
| Preview annotations, variations and starting-position notes | `ef05c032`, current annotation editor | Evaluate En native preview renderer and phone PGN parsing/navigation; preserve existing full game trees rather than flattening them |
| Startup engine score coalescing and stable evaluation display | `58741060`, earlier retarget fixes | Compare En's existing engine lifecycle, saved score and board overlay ownership before porting the state machine |

## Already present or deliberately separate

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

This is an active work list. No row is silently marked complete from a file
copy, a historical test receipt, a static shell HTTP response or a successful
build. Physical-device interaction remains a separate evidence boundary.
