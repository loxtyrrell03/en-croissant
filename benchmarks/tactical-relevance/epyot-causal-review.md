# Queen exchange and defender removal adjudication

EpYOT supports a specific causal explanation: exchange the queen that guards Ne5, then collect the knight with Bg7. Declining the queen exchange allows other connected captures, often Qxd1. The two pawn-skewer badges reported by adapter 174 do not establish their own profitable rear capture; their apparent gain is funded by the queen already taken at the root. This judgment rests on legal branch evidence and controlled positions, not a preference for a larger generic material number.

## Scope and frozen hypotheses

The root is `r1b2r2/pp4bk/1q1Qp2p/4Npp1/8/2P3P1/PP2PPBP/1R1R2K1 b - - 0 19`, with `b6d6 d1d6 g7e5`, or Qxd6 Rxd6 Bxe5. This is the previously reviewed public development case from `quiet-intermediate-development-selection.json`, not a newly sampled position or holdout result.

`epyot-causal-hypotheses.json` freezes the controlled pawn relocation, all-front-departure inspection and reversed Qxe5 hypothesis before new queries. The baseline uses all tactical modules from exact commit `b75c13e2f3a63d69cf60bd9e0b4221f884a9e190`, through the existing read-only loader. Counterfactual boards are valid alternate positions, not claimed legal variations from the original game. No engine, provider, owner data or runtime service was used.

## The rear captures do not supply independent gains

There are eight legal Ne5 departures after Qxd6. On every one, the named queen rear capture Qxg3 permits legal hxg3, an incremental loss of 800. The named bishop rear capture Bxc3 permits legal bxc3, an incremental loss of 230. The test verifies these moves and material totals independently of classifier labels. The shared exchange evaluator also returns those negative values. Adding the earlier captured queen's 900 can make the whole sequence positive, but cannot by itself prove the claimed rear-target mechanism.

All numbers here are local material units with pawn 100, knight 320, bishop 330, rook 500 and queen 900. They are not engine evaluations or winning probabilities.

The separate connected material certificate covers all 40 legal root replies with a 320 bound. Its chosen answers to the knight departures are not these rear captures: Nd3 permits Qxd3, Ng4 permits fxg4, and the other six departures permit Qxd1. Acceptance Rxd6 instead permits Bxe5. Other declines have their own connected answers. Quiet queen flights are also enumerated as immediately untakeable options, but that property alone is not a complete safety proof and is not used to establish the bound.

## Controlled removal of the rear targets

The previous attempt to remove all four possible rear pawns opened Rb1xb7, introducing an unrelated 100-point loss. Two new controls preserve the b-file blockage and close the original bound in both colours:

| Counterfactual | Legal root replies | Bounded gain | Kernel visits |
| --- | ---: | ---: | ---: |
| Original | 40 | 320 | 318 |
| Remove Pc3, Pg3, Pb2 and Ph2; place an off-ray White pawn on b3 | 37 | 320 | 299 |
| Relocate Pc3 to c4, Pg3 to g4, Pb2 to b3 and Ph2 to h3 | 37 | 320 | 331 |

Rb1xb7 remains illegal after the source collection on all three boards. The counterfactuals have no rear material on either alleged ray, and adapter 174 retains the same material result without skewers. These controls support the causal judgment alongside the original-position capture refutations; they are not an assumption that arbitrary relocation preserves every strategic feature.

## The actual defender and reversed order

Taking the knight first gives Bxe5 Qxe5. The removed queen is the actual legal recapturer. White's retained 330 recovery is verified against all 29 Black replies within 1,567 visits, with independent exact reply-set and selected-leaf replay checks. Therefore this reversed order is bounded above by 320 minus 330, or -10 for Black from the original root, compared with the forward 320. The alternative Qxb6 is not a retained queen win because ...axb6 returns it immediately.

Deleting the defending queen improves Bg7xe5's legal exchange value from -10 to 320. Removing Bg7 leaves no legal target capture after Rxd6 and breaks the 320 proof. Adding a second White guard at f4 keeps Bxe5's exchange value at -10 even after deleting Qd6 and likewise breaks that proof. Thus the identified capturer and loss of the actual guard matter; the result is not just a free root capture or a larger material score.

The original game also contains the preceding Nxe5 pawn capture. Values measured from the root and from before that pawn loss must remain distinct: the local 320 collection is 220 including the prior 100 loss. The already-certified Bxe5 collection is a payoff, not another independent knight win.

The withholding cause is not a lack of material proof: the existing removal proof can obtain 320, but an independent-direct-attack filter rejects it. That supposedly independent alternative uses the same accepted Rxd6 Bxe5 collection and the same removed guard. Reusing this already connected branch is justified only when the actual old guard, improved capture and named target match; an unrelated larger capture must not provide the exception.

## Genuine skewers remain positive

An opposite control uses `7k/5r2/8/8/2q5/8/B1P2PPP/5BK1 w - - 0 1` and Bb3. Pc2 protects the bishop; the line runs through Qc4 to Rf7. All 37 legal replies retain at least 170 material units, including the bishop-for-rook exchange when the queen protects the rear rook. Adding a Black pawn on b3 makes the root Bxb3 and raises the bound to 270. Both colours pass, with 466 kernel visits in each case. The legal countercheck Qxf1+ is answered by Kxf1. These preservation controls show why initiating captures cannot be rejected wholesale: the rear collection must itself earn material, independently of any earlier capture.

## Verification and remaining boundary

The final replay uses all indexed tactical modules at adapter 175, excluding the pending working-tree checking-ray patch. The eight fixed public API inputs cover root-only/full line, without/with the exact prior pawn loss, and both colours. All eight now satisfy the combined primary/bound/no-skewer/payoff contract, versus zero of eight at exact adapter 174. The underlying harness has nine tests including receipt stability; that is not nine distinct chess cases. Genuine-skewer controls remain 170 and 270 in both colours.

The audit suite checks legal replies, selected proof paths, material accounting, all eight rear-capture refutations and both negative guard controls in both colours. A separate Python-chess checker validates both versions' 40 recorded positions, 2,628 legal plies and 1,144 selected leaves, including 32 complete root reply sets. These totals include repeated before/after evidence, not unique puzzles. It independently confirms 64 rear-capture refutations, 12 guard controls and eight genuine-skewer witnesses. This checker does not independently establish the shared kernel's minimax bounds, later liabilities, draw strategy or whole-game outcome.

The production change is owned and verified separately; this audit edits only benchmark files. Its final verification receipt records the immutable adapter 174 baseline, frozen indexed adapter 175 replay, hashes and quality checks. No broad accuracy rate or deployed-app claim follows from this single causal adjudication. A bounded search returning null remains unknown unless a concrete legal counterexample is separately shown.

Run `node node_modules/vitest/vitest.mjs run --config benchmarks/tactical-relevance/epyot-causal-audit.vitest.ts`. Set `RARE_CAUSAL_COHORT_V2_REF` to the exact baseline commit for the frozen loader. Optional `EPYOT_CAUSAL_REPORT` must name a new path; the writer refuses to overwrite existing receipts. Stored proof paths are compact, while tests reconstruct full positions and enumerate replies deterministically.

For the final indexed source, unset the baseline variable and set `EPYOT_SOURCE_INDEX=1`. The skewer-preservation and API-comparison configurations use the same loader. API contracts are always enforced except for the explicitly named adapter-174 observational baseline, including on future versions. Run `epyot-independent-verify.py --output <new receipt path>` with the existing Python-chess environment to repeat the separate rules/material checks without an engine or provider.
