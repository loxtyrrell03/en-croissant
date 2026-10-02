# One mechanism, one root label

Adapter 176 / live pipeline 183 removes a redundant **Double Threat** label when a proved **Interference** already explains the same move, capturer, defending piece and two material targets. A distinct extra target or a larger certified gain keeps its separate label. This is a relevance improvement, not a claim that the suppressed chess threat was false.

## Real-puzzle finding and contrary controls

The public puzzle eAHH6, from [game 7Exud9aZ](https://lichess.org/7Exud9aZ/black#146), plays Rg8. It cuts the black rook's defence of Nh8 while attacking that rook. The existing independent proofs both establish a local 320-centipawn minimum against all 16 legal replies. Their material targets are exactly Re8 and Nh8, so two root headings repeat one explanation.

The new filter compares those proof records rather than imposing a blanket motif priority. It requires the same ply and move, a high-confidence nonmating interference, the same capturer, a checking capture of the exact severed guard, a complete two-target set, and a bound no greater than the interference's bound. It changes no search budget or proof admission.

The controls preserve meaningful distinctions:

- Add a black knight on b8: the separate threat now has a third original victim and survives alongside Interference. All 17 root replies remain covered by its existing proof.
- Remove the supporting h7 pawn: the interposing rook can be captured, and neither unsupported root claim is admitted.
- Play the checking Rxe8+ continuation: its real fork stays at ply 3, not relabelled as a second root tactic.
- The live board still shows the initiating move, severed guard and genuine targets. Trainer cards, exports and reloaded cards preserve the same distinction.

## Benchmark scope

Six fresh public development puzzles were selected before classification, two each from the interference, deflection and attraction strata. Their source games are disjoint from the recorded earlier reviews. Source labels nominate questions; they are not treated as ground truth. The exact adapter-175 baseline and exact indexed adapter-176 candidate use identical frozen inputs.

Across 24 root/full-line and colour variants, four outputs change: the redundant eAHH6 label disappears in each variant. Its Interference primary and 320-centipawn bound remain. The other 20 outputs are unchanged apart from version stamps. These are variants of **six puzzles**, not 24 independent accuracy samples. The 27 focused audit/regression checks improve from 23 passes plus four demonstrated duplicate-label failures to 27 passes. All 56 complete observations in the separately retained public cohort are also unchanged after excluding version and timing, with all 14 checks passing against the exact staged source.

Independent python-chess checks cover the relevant complete reply sets, checking continuations, mate geometry and adverse board controls. The audit also retains unknown roots and a correctly qualified later-only fork. It does not convert empty output into a positional negative or infer recall from source labels. See `rare-mechanism-precision-v1-review.md` and its verification receipt for case-level judgements.

## Other findings retained without speculative changes

The quiet-preparation audits expose useful causal mechanisms, but several hard responses still prevent a production proof. A selected winning-looking continuation, a positive engine score, or separately successful per-branch searches is not enough to certify the proposed root motif under the existing shared budget. The [clearance review](quiet-clearance-boundary-review.md) and [trap/promotion-interference review](quiet-trap-followup-review.md) retain the counterchecks, sacrificed-material costs, cooperative-reply corrections and unresolved branches for the next iteration.

The separate [promotion-race outcome audit](promotion-race-outcome-review.md) establishes a uniquely winning first pawn push and a later opponent promotion that still loses. It deliberately leaves the known local promotion-retention expected failure in place: whole-game outcomes and local tactical proof are different claims.

## Verification and delivery boundary

The final broad selection has **3,726 genuine passes**, one separately counted known expected promotion failure, 364 skips and no unexpected failures. All 32 frozen primary-lesson outputs are byte-identical to adapter 175. The exact staged core passes 940 checks across 45 files, with five optional skips. The compiled trainer passes 121 checks, including eight new overlap/preservation export-and-reload roundtrips, with one optional engine check skipped. There are 39 new source contracts, including 17 for the separate promotion-outcome audit; these dependent controls are not an accuracy sample.

The accompanying `interference-overlap-verification.json` records these scopes, the retained public cohort, source hashes and artifact manifest. Counts distinguish genuine passes, the known expected promotion failure and skipped optional checks.

Whole-project types, scoped lint and the frontend/shared-trainer builds pass. The exact-core checks exclude the preserved unrelated checking-ray patch; working-tree builds include existing unrelated work and are not clean installed releases. No installed desktop application, phone runtime, website, owner store, evaluation corpus or native/browser session was changed. Broader primary-theme accuracy, positional discrimination and rare-motif recall remain open.
