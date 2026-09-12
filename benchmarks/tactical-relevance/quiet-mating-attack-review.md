# Quiet mating threats and secondary deflection — adapter 86 / pipeline 91

## Chess judgement

In the fixed CC0 Lichess game nBrWE, **Be5** threatens **Qh2#**. The useful first-move lesson is Mating Attack: preventing mate concedes material. It is not already a queen deflection or a forced-mate certificate. The source continuation, **Be5 Qg2 Qe1+ Qg1 Qxe4+**, now reads:

| Actual move | Lesson | What is established |
| --- | --- | --- |
| Be5 | Mating Attack | All 32 legal replies allow a connected material win or mate. |
| Qe1+ | Deflection | Both Qf1 and Qg1 move the queen away from guarding e4; Qxe4+ then wins the bishop. |
| Qxe4+ | Deflection Payoff | This realizes the earlier mechanism, not an additional bishop gain. |

The starting board shows the bishop move and queen's mating threat, with one badge. The reached deflection board shows the checking move and the queen's original guarding connection. Future captures are not drawn on the starting board. Missed-opportunity review retains Be5's first-move lesson; unsupported comparisons about preventing the opponent's tactic remain neutral.

## Independent proof and bounds

The pass position only nominates a newly available mate in one. Existing immediate mates cannot justify unrelated quiet moves. A shared 8,192-operation search verifies every real reply using the prepared piece and mating partner, captures/checks, legal check evasions and at most three further attacking checks. Every material leaf debits friendly-piece capture liabilities and checks immediate mate/promotion resources. Mixed outcomes must include material and mating branches and retain at least a 300 cp local gain. This is not a general quiet-move solver. The real proof uses 1,081 visits, 32 root branches and 40 distinct selected decisions; its local lower bound is 330 cp, not its full-position evaluation.

Checking deflection is a separate 4,096-operation proof. Every legal evasion must move the same nonking guard; a legal, profitable original recapture must cease to save the same target. Captures and all friendly-piece liabilities are checked. An alternative interposer, a pinned/nonexistent guard, promotion or unsupported countercheck prevents this certificate. Matching legal history is required to call the later capture Deflection Payoff. Quiet-attack and checking-deflection proofs include announced fifty-move-claim guards; repetition and other proof families are not comprehensively solved.

## Contrary evidence and noise corrections

The [58 fresh public depth-16 searches](quiet-mating-attack-stockfish-18.json) contain 42 root/selected-decision searches, fourteen threat/deflection/noise controls and two constructed checking discoveries. A separate 32-search private audit checks four changed course continuations and thirteen selected discovery leaves. These ninety searches are development evidence, not independent accuracy labels.

- Be5 is +610 cp Black in the unrestricted main line and +668 when restricted. The wrong Bc5 is +11. Adding a rook which takes the black queen makes Be5 -709/-791 cp. Removing White's bishop still leaves Black +553 from its *existing* extra material; the classifier's abstention is not a claim that Black is losing or the position lacks all tactics.
- An older constructed Qh2 test was not a forced mate in three, but Stockfish finds mate in five. Other queen moves mate in four. Its empty expectation was corrected to a bounded Mating Attack, not relabelled as a forced short mate.
- The old Qxe4+ “Intermediate Check before Bxb2” ignores **Qg2 Bxb2 Qxe4**, losing the queen. Bxb2 is -737 cp Black; exchanging queens instead is +551. Deferred-capture proofs now debit off-square losses. A related false Pin also disappears: a pinned queen can legally capture its pinner along the pin ray.
- Four paid-course continuations change. Two lose unsound deferred-capture claims, one replaces Intermediate Check with its independently verified Discovered Check, and one keeps Intermediate Check with a lower local bound after a pawn liability. These are individually reviewed changes; withholding an explanation does not prove a correct negative. A discovered check now subsumes its own smaller initial capture badge, without hiding captures at other plies.
- In a constructed knight capture, Fork remains primary and Double Check stays secondary. Forcing the double-check label to the top would be less useful. Both colour directions are engine-supported at +528/+542 cp for the mover.
- An extra interposing rook makes the proposed Qe1+ -759; pinning the white queen makes it immediate mate, not deflection. A counterchecking-king control remains winning at +694 but lacks the narrower deflection proof. That is a coverage limit, not a refuted winning move.

## Verification and limits

All 180 stored Woodpecker source/live inputs were replayed. All primary labels remain unchanged; 176 full results are unchanged ignoring versions. Nineteen of twenty rare-sample full results and all 32 frozen mistake priorities remain unchanged. This recovers nBrWE's missing root lesson, not twenty solved rare puzzles. Existing interference, exact KPK zugzwang and branch-specific mating-clearance regressions pass; drawing/larger-ending zugzwangs, snAK4's quiet trap and broader quiet/causal coverage remain open.

The 104-file selection passes 1,476 tests with 75 conditional skips. All 532 production-worker inputs pass eleven controller tests. The [159-input public timing receipt](built-worker-adapter86.json) has total median/p95/max **75/230/628 ms**, startup max 33 ms and computation/transfer max 603 ms, excluding Stockfish, UI and additional private/rare inputs. All 152 previous public headline lists are unchanged. The new full mating-attack input takes 96 ms total. Final artifact: `liveTactics.worker-CuVAfhn-.js`.

Shared-review (40 modules), app (8,870 modules), eleven-file lint, whole-project type checking, three service tests and two dev-cache/recovery scenarios pass. The previous unrelated OTB type error is no longer present in the current checkout; this milestone did not modify that code. Six isolated cold HTTP cases pass; first/next startup is 3,525/70 ms, while KPK/clearance startup varies to 3,024/3,406 ms. No timeout increase or native reliability claim follows. No app, package or service was restarted/deployed. Native WebView interaction and narrow-layout verification remain open.

Authoritative private reports: `adapter86-exact-replay-shipped.json`, `rare-theme-adapter86-shipped.json`, `quiet-mating-attack-adapter86-shipped-proof.json`, `intermediate-liability-adapter86-shipped-probes.json`, `intermediate-liability-adapter86-engine.json`, `adapter86-final-cold-http-worker.json` and `adapter86-human-review.md`. Final proof-generated engine inputs match the audited inputs. Paid positions and course text remain outside Git.
