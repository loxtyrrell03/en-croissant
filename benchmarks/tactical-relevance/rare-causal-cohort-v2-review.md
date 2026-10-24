# Rare tactic and ordinary game review

Eight additional public development puzzles and six fixed positions from two different public games exposed one new relevance defect: an incidental material discovery was attached to a forced mating line at a later ply. Adapter 172 removes that label in both colours while preserving the mate and its supporting mechanisms. This is a narrow, independently checked correction, not an overall accuracy estimate.

## Selection and proof boundaries

The seed, eight ordered motif strata, prior public-review exclusions, two control games and reached plies 12, 20 and 28 were frozen in `rare-causal-cohort-v2-selection.json` before classifier output. Selection uses SHA256 ordering, development rows only and ten distinct source games. The source is the existing small CC0 puzzle fixture; it is not a newly unseen corpus. No holdout position was classified. The retained exclusion inventory describes previously published public review, not owner or private data.

Only two public game exports were fetched: [QZDg7vtX](https://lichess.org/QZDg7vtX) and [Z1Tw5YR3](https://lichess.org/Z1Tw5YR3). The inputs retain 131 legal plies and compact provenance, without player headers, clocks, comments or raw PGN. Missing exports or sampled plies would have remained unavailable rather than being replaced; all six were available. `rare-causal-cohort-v2-inputs.json` and `rare-causal-cohort-v2-hypotheses.json` were frozen before fresh classifier or engine output.

The 56 classifier inputs are paired variants, not 56 independent examples: eight puzzles times root-only/full-line times two colours, plus six contexts times root-only/actual-line times two colours. The initial baseline uses every tactical module from exact commit `455adfd38e23d352b1a4af512f67ca4795c7be5a` through a read-only loader, avoiding concurrent working-source changes. The final adapter 172 receipt hashes six relevant production dependencies and verifies their stability across the run. Every serialized input is identical between these receipts. `rare-causal-cohort-v2-adapter172.json` preserves the earlier checkpoint; `rare-causal-cohort-v2-adapter172-final.json` records the final history-safety implementation and has identical classifier results for all 56 variants.

Twenty independent low-priority Stockfish searches corroborate the eight puzzle roots and six ordinary positions before and after the actual move. Each uses one thread, 64 MiB hash, depth 16, at most three lines and a 30-second timeout. All completed. Engine scores and principal variations are evidence for further investigation, not all-reply proofs or truth labels. These scores are from White's perspective.

## Confirmed later discovery noise

[YvGsE](https://lichess.org/training/YvGsE) starts from `2b1Qn1k/7P/p2p2p1/q1pP1r2/2P5/8/Pr2B1K1/2q2R1R w - - 2 28` with `e8f8 f5f8 f1f8 h8g7 h7h8q`, or Qxf8+ Rxf8 Rxf8+ Kg7 h8=Q#.

The independent legal checker establishes exactly one legal reply at each defending turn and final checkmate. It repeats the same exhaustive reply check after removing Bc8, after removing Qc1, and after removing both, in both colours. All eight boards retain the identical forced mate in three. Therefore the additional Rxf8+ discovery against Qc1, and its simultaneous attack on Bc8, do not explain this mating result.

Adapter 171 correctly led with mate in three and mating deflection, but the full line also selected a high-confidence Discovered Attack worth 900 at ply three. Adapter 172 removes only that incidental material explanation from motifs and timeline. Mate in three, deflection, x-ray support, the actual final named mate and promotion remain. Root-only labels were already free of the discovery; their new explicit mate-outcome metadata is not another accuracy gain. All other sampled motif identities, values, plies and ordering remain unchanged. The permanent actual-ply regression and its contrary material-capture control are owned by the production correction, separate from this cohort.

## Other rare cases

| Puzzle | Evidence and current boundary |
| --- | --- |
| rqcm3 | Nh6+ is the engine's preferred attacking move. Its longer source line contains Black's Bh2+/Ng3+/Nxf1+ counterplay, which remains on Black's actual later plies. A forced root interference/clearance mechanism is unproved; an empty root is not a positional judgment. |
| wN37d | Nb2 clears c4 and attacks Ra4. The sample ...Ra1 Rc4+ Kd5 Rxb4 demonstrates a later rook fork. The stronger engine defence ...Bd6 requires a different route: the quiet Rc6, then Kd5 Rxd6+ Kxd6 Nxa4. The classifier retains the sample fork at ply three but does not certify Nb2's root preparation. All 24 legal root defences have not been independently closed, so this remains a promising recall investigation, not a scored failure. |
| CY182 | Qg2+ has three legal replies. The full line obtains a root Forcing Attack with a 400 local bound; root-only input abstains. The later Rd3+ king deflection and queen capture must not be counted twice. The current all-reply bound and root-only recall difference remain independently unadjudicated. |
| GFfWQ | Rxf2 Kxf2 Ne4+ has clear later double/discovered-check geometry, but acceptance alone does not prove forced attraction. The engine prefers Rxf2; a complete decline/payoff proof with rook debt is not supplied here. |
| Ltbye | Bxe6 before Qxc1 is strongly supported as an intermediate capture. The engine scores Bxe6 at +246 cp and immediate Qxc1 at -308 cp; after immediate Qxc1, ...Bxd5 loses the bishop. The 31 legal replies to Bxe6 have not been independently closed. Current empty root is a recall candidate, not proof of a positional move. |
| ySzc4 | Independently checked e6+ attacks Kd7 and Nf7; all seven legal replies permit exf7, and the king protects the checking pawn. The root Fork's 220 local bound reflects knight minus pawn, not a free 320-point knight. The source defensive-move nomination is not established. |
| Xg7Rd | Bxg2 covers two Na5 escape squares while Bc7 attacks it. Removing the Nd2 guard makes ...Nc4 a legal unattacked escape in both colours. The engine prefers Bxg2, but all 34 original defensive replies have not been independently closed. Trapping/preventing-promotion recall remains open. |

## Ordinary positions are not presumed negatives

All six actual-move position inputs have empty selected motifs in both versions. That is not six certified correct negatives.

The checker establishes two narrow contrary controls in both colours: after QZDg7vtX's a3, Bb4 can legally retreat to an unattacked e7; after Z1Tw5YR3's a3, Nb4 has legal unattacked a6/c6 escapes, and the tempting ...Nxc2+ is answerable by Qxc2. These refute the specific trap or uncontested-fork explanations, not every possible tactical explanation of the positions. Ordinary Nf3, Bf4 and a4 hypotheses remain limited to their stated mechanisms.

Z1Tw5YR3 at reached ply 28 is a real tactical positive. Qc7 is attacked by Bf4 and is undefended. White can play Bxc7, after which the bishop is not immediately attacked. Actual Bd3 instead permits ...Qxf4, also without an immediate recapture. Independent board tests establish both legal captures in both colours. The engine corroborates Bxc7 at +734 cp and the actual-move position at -30 cp. With the compared best and actual moves, the review classifier correctly reports a missed hanging-piece capture in both colours. An empty explanation of the actual Bd3 alone is not a classifier failure or a certificate of quiet play.

## Verification and reproduction

The benchmark suite passes 14 tests against both exact adapter 171 and frozen adapter 172. These cover source-game separation and deterministic development selection, all retained game/solution legality, both-colour mate-removal witnesses, the seven-reply pawn fork, a trap escape control, safe ordinary retreats and the genuine missed-queen comparison. Targeted TypeScript, formatting and lint checks pass. The receipt reports observation changes separately from these contracts; it does not calculate agreement or population accuracy.

Run `node node_modules/vitest/vitest.mjs run --config benchmarks/tactical-relevance/rare-causal-cohort-v2.vitest.ts`. Set `RARE_CAUSAL_COHORT_V2_REF` to the exact 40-character baseline commit for the frozen loader. `RARE_CAUSAL_COHORT_V2_REPORT` must name a new report file; existing receipts are never overwritten. Routine tests replay retained data and do not fetch games or start an engine. One additional selection-reproduction check uses the existing small public source fixture if available and otherwise skips; `RARE_CAUSAL_SOURCE_FIXTURE` can point to that fixture without copying it. All legality, mechanism and paired classifier tests remain available without the sibling website checkout. Fresh exports and engine searches are separate explicit scripts and are not needed to reproduce the classifier comparison.

No full corpus, tablebase download, private/owner data, service restart, runtime deployment or Git mutation was involved in this benchmark work. General rare-motif recall and the unproved cases above remain open.
