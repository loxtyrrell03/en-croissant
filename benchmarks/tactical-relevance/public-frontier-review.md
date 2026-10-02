# Public development frontier and evidence-aware sampling

The [eight-case ledger](public-frontier-development.json) records a small output-blind selection from the existing CC0 fixture, restricted to development and source-game-disjoint from previously recorded public cases. It is still reused development data, not an independent holdout. Source labels select strata; they are not expected primary themes. Six roots remain unresolved, one skewer is plausible but not independently certified, and one mating example exposes confirmed secondary noise. Empty or unchanged output is never an accuracy success by itself.

## Sampling repair

`scripts/benchmarks/secondary-theme-sample.mjs` previously searched every JSON string for puzzle/game references. `quiet-mate-development.json` intentionally lists all 1,679 old puzzles and games as exclusions from a separate new sample, including the old untouched holdout. Those metadata lists were incorrectly counted as previously examined cases, exhausting the original fixture for future sampling.

`tactical-sample-evidence.mjs` now collects identities from structured positions, results and judgements, preserving previous source-game exclusions. It ignores nested exclusion inventories, metadata and provenance; older narrative reviews retain their explicitly discussed references. Explicit frozen-exclusion input still reproduces historical selection unchanged. The source checksum, development-only filter, SHA ordering and distinct-game rule are unchanged. Ten synthetic Node tests cover these boundaries, malformed data, order/score invariance and exhausted strata. Run `node --test scripts/tests/tactical-sample-evidence.test.mjs`.

Before adding this ledger, frozen replay reproduced the original 18-case secondary fixture exactly. Default selection recovered 18 cases from 18 distinct games after excluding 131 actual recorded puzzle IDs and 131 games. The new ledger must itself become exclusion evidence in subsequent selections. No classifier was invoked while choosing those 18 sampler-validation candidates; no holdout row was classified.

## Confirmed next noise case: ZrgCo

The legal real-puzzle continuation is `e8=N+ Kc6 Rc7#`. Independently enumerating every legal reply and every following legal mating move confirms mate within two in both colours. Removing the incidental a7 pawn leaves exactly the same mate. Nevertheless adapter 166 emits root/timeline Discovered Attack on that pawn, with a 320 cp local value, beside the correct Mate in 2 and 220 cp Under-Promotion. That optional pawn collection does not explain the mating solution. The primary is already correct; the defect is redundant supporting/timeline noise.

Queen, rook and bishop promotions each permit replies without immediate mate on White's next move. This establishes only that those choices do not force mate within two, not that they necessarily lose. No fresh engine search was performed. The independently enumerated controls and current full motif output are retained in the task's compact temporary audit receipts; the core correction and permanent behavioural tests are owned separately.

Adapter 167 corrects this secondary-noise case with a bounded, all-defence mate counterfactual; `incidentalDiscoveryMate.test.ts` freezes the real position and preservation controls. See [the proof-boundary report](proof-boundaries-review.md). The original ledger above deliberately retains adapter-166 observations, not rewritten post-fix results.

## Coverage boundaries and next sampling

- `rare-theme-development.json`: 20 puzzles from five rare-family strata; its runner asserts legal replay and records outputs, not 20 correct classifications. `rare-theme-review.md` explicitly retains unresolved cases.
- `secondary-theme-development.json`: 18 cases from six strata, with provisional pre-output judgements and frozen depth-16 root/control searches. Later tests mix specific adjudicated contracts with output stability.
- `ordinary-games-development.json` and `ordinary-games-review.md`: 24 fixed-ply positions from three complete public games; 17 quiet roots and seven positive roots were adjudicated at that milestone. This is a small one-account longitudinal sample, not representative prevalence.
- `broader-game-context.json` and `black-context-development.json`: 23 and 20 fixed roots, each with paired actual replies, from four and five puzzle-source games respectively. Their unresolved endings and quiet preparations are not certified negatives.
- `causal-stockfish-18.json` plus `tacticalLessonPriority.test.ts`: 32 frozen primary/source contracts spanning 17 primary IDs. These are useful ownership/priority regressions, not all-54-label coverage.

Keep future ledgers explicit about `unreviewed`, `unresolved`, `mechanism supported`, `confirmed negative`, and `confirmed defect` states. Add an expected primary or forbidden secondary only after the relevant reply branches and contrary controls are reviewed. Preserve source-only versus engine-PV evidence, root versus later ply, and local gain versus full-position evaluation separately. Reuse the sampler's fixed source/hash and frozen exclusions; use actual game contexts for positional negatives rather than declaring an unsolved puzzle a negative. The eight newly selected cases should remain fixed even when six currently have empty root output.
