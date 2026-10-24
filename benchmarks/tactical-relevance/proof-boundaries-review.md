# Proof boundaries and retained opportunities — adapter 167 / pipeline 174

Verified source work in the En Croissant fork on 2026-10-02. The separate website, installed desktop package, phone runtime and owner databases are unchanged.

## What changed

- **A claimable draw is a legal defence.** Checking material attacks, forced self-interference, exchange deflection and mating king-deflection now use the existing fifty-move claim guard. Checking-material continuation search also checks later defending turns. A subsequent capture cannot erase an earlier claim. Captures and pawn moves that reset the count, positions with only zeroing replies, and immediate checkmate remain valid positive controls. These are claim rules, not a blanket ban on high halfmove clocks; see [FIDE 9.3 and 9.6](https://handbook.fide.com/chapter/E012023).
- **A pawn attack need not explain a mate.** A bounded counterfactual removes the newly uncovered nonking victims of a material discovery. The badge is omitted only if the same root independently forces mate within the original distance and the displayed legal line retains identical captures. Unknown proofs and captures of removed victims retain the label. Checking discoveries, double checks, clearance and underpromotion are not suppressed by this rule. The real development puzzle ZrgCo retains Mate in 2 and Under-Promotion without its irrelevant a7-pawn discovery.
- **A fork actually played is not a missed fork.** Two independently proved ordinary root forks with the same destination, piece role, capture and complete original target set are retained as neutral comparison context. Different target sets, unsafe forks, checks, promotions, compound collections and mating gains are not equated. Local gain bounds need not match: shared mechanism does not mean equally good moves. A separate proved cause still takes priority. The trainer says “Both moves create this fork,” preserves the context through saved cards and timelines, and does not infer a tactical or positional mistake from that shared fact alone.
- **Delivering checkmate cannot miss another mate-in-one.** Direct legal-board checks now cover named mating patterns as well as numbered mate labels. If both the preferred move and the played move immediately checkmate, the review must not accuse the played move of missing the other mate or a subordinate material tactic. Nonmating checks and later patterns remain separate cases.

The existing bounded proofs remain authoritative. No search limits, worker deadlines or engine depths were increased. Source cache versions advance to invalidate stale classifications.

## Reproducible evidence

`proof-boundaries-adapter167.json` retains identical per-case judgments, FENs, lines, before/after outputs and exact core hashes:

| Targeted contract group | Before | After |
| --- | ---: | ---: |
| Draw-claim boundaries and reset controls | 26 / 54 | 54 / 54 |
| Incidental discovery and necessary-motif controls | 18 / 22 | 22 / 22 |
| Shared-fork wording and actual missed-fork controls | 2 / 6 | 6 / 6 |
| Two legal immediate mates, including different named patterns | 0 / 4 | 4 / 4 |

These deliberately selected clock, colour and line-length variants are related contracts, not independent positions or a population accuracy estimate. The discovery baseline was recorded after the draw patch with the adapter version already advanced; the distinct core hashes identify the precise before/after code. The real public roots and constructed controls must not be presented as a representative false-positive rate.

The fork/mate comparisons in `retained-choice-adapter167.json` use identical observable before/after probes and the same frozen HEAD-18255054 core, isolating adapter changes. They do not count a missing new helper export as a baseline failure. The permanent fork/mate suites separately cover 33 contracts, including candidate-path parity, unsafe played forks, different victims, nonempty timelines, later named patterns and invalid moves. Checking and compound forks remain outside the new ordinary-fork comparison; their exclusion tests preserve evidence without certifying the old blame wording as correct.

To record future comparisons, set `TACTICAL_FIFTY_MOVE_REPORT` and/or `TACTICAL_INCIDENTAL_DISCOVERY_REPORT` to new output paths and run their corresponding Vitest files. Reports refuse to overwrite prior evidence. Preserve expected judgments when evaluating algorithm changes.

The [public development frontier](public-frontier-review.md) adds eight fixed, output-blind nominations. Its pre-fix observations remain frozen. Only ZrgCo's incidental discovery was independently adjudicated and corrected in this pass; six unresolved roots and one provisionally plausible skewer are not counted as correct results. The sampler now distinguishes actual examined positions from exclusion inventories, which previously exhausted the development fixture incorrectly. It still excludes prior source games and never selects holdout rows.

## Delivery and remaining limits

Final verification is preserved in `proof-boundaries-verification.json`:

- Public regression: **3,104 passed, one known expected failure, 364 conditional skips, zero unexpected failures** across 221 selected files (200 passing, 21 skipped). The 114 newly added source/consumer tests all pass. Vitest's JSON includes the expected-failure contract in its 3,105-pass field; it is not counted as a repaired position here.
- Frozen lesson priority: **32/32 primary theme and source matches**, five secondary lessons, 17 distinct primary IDs. Full output is unchanged from adapter 166. Per-theme denominators are in the verification receipt. This is reused development stability, not all-54-label gold accuracy or fresh engine analysis.
- Exact staged core: **268 passed / two optional report skips** across eleven source/consumer suites, with index and watched sources unchanged during the test. The loader confirmed that pending checking-ray changes were absent. Consumers/tests were frozen current-working files; their bytes were then staged unchanged. This is not a fully indexed build or installed runtime check.
- Generated shared-review service: **41 passed / one opt-in engine skip**, including two new neutral-fork export/reload checks. Sampler: **10 passed**. Whole-project types, scoped lint (zero warnings/errors), and the frontend/review-worker build pass. Build retains existing large-chunk, dependency BigInt-target and plugin-timing advisories.

The milestone core without pending checking-ray work is LF SHA-256 `5e2763c0d003bcd787b8105254cc1c5597f23234f8bb139c63e2af0262c0812d`, Git blob `a3653550dcfe17ed542cf07a4063c53a9ddc3810`. The broad/build working core is `9f9ba822b995f13c2f6318a0e3eecc7408e305b502b15ea74d324390a9ca6f60`; the final adapter is `584e689c8b3e63ae0fbe1df5d04edfc4679d0d56895d07394a1e007eb1d57121`. Source hashes remained unchanged throughout the final public run.

The classifier and trainer share this source. A saved-card schema update preserves neutral `available` evidence instead of rejecting it. Shared desktop/phone line explanations use the comparison wording, with no layout redesign. Generated-service tests use temporary synthetic stores and check export/reload; they do not rescan owner data.

The working checkout also contains separate unfinished checking-ray deflection changes (46 added / four removed lines). Those remain outside this milestone. Working-source reports identify their inclusion; a separate staged-core verification checks this milestone without them. Generated build output is not committed.

This milestone does not establish complete tactical recall, perfect primary choice, general positional false-positive rates or all-motif independently adjudicated accuracy. The unresolved queen-ending promotion regression, quiet preparations, broader rare-motif judgments and held-out real-game coverage remain follow-up work. No native package, browser/native interaction, phone deployment or physical-device verification is claimed.
