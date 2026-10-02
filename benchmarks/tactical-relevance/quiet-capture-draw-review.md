# Quiet capture order and trap draw validation

En Croissant adapter 174 and live pipeline 181 recover a proved quiet move-order lesson, prevent repeated counting of its material, and stop presenting draw-claimable traps as wins. The changes are integrated with the shared mistake trainer and tested through saving, export and reload. This is a source milestone; the installed desktop app and phone runtime have not been updated.

## Capture order requires a concrete comparison

The separate quiet-capture rule does not loosen the existing checking-intermezzo detector. It requires a near-equal legal exchange, a different deferred capture, and a legal reversed-order recovery by the exact piece removed first. Both orders must pass all-reply material checks inside one shared 16,384-operation budget. Checking frontier moves are not accepted as settled material leaves; counterchecks, immediate off-square captures and quiet retention are included. A private 64-entry cache returns copies of its certificates.

In the retained public Ltbye position, Bxe6 before Qxc1 retains at least 230 material points from the current board, versus at most zero after Qxc1 Bxd5. The final local certificate uses 3,317 visits and covers all 31 replies in each order. A pawn is worth 100 points here; these are bounded material calculations, not engine evaluations or a game's eventual result. The earlier rook loss was 500, so the history-aware lesson has zero fresh-profit value and explains the -270 combined recovery bound. Removing Rc8 remains positive: that rook is not an invented necessary target. Poisoned recaptures, missing participants, an off-square queen liability and independently free captures provide adverse controls.

Fresh development case Qq0JW requires the same accounting discipline. Its root material bound is 320; the preceding pawn loss reduces the history-inclusive amount to 220. The later knight capture becomes an unvalued Intermediate Capture Payoff, not another free knight. In mistake review, the independently larger allowed queen capture, valued at 890 from its own position, remains primary over the new missed move-order lesson. The quiet proof's smaller reversed-recovery bound does not authorize erasing that stronger explanation.

The fixed Ltbye API contracts improve from 0 of 8 to 8 of 8 across short/full lines, prior-history presence and both colours. These are variants of one reviewed position, not eight independent puzzles. The additional development and adverse-control evidence is retained in [the capture-order audit](quiet-intermediate-development-review.md).

## A draw claim prevents a winning trap

Fresh public FSJC4 supplies a real Ra3 queen trap with a local bound of 170. Constructed clock variants exposed a false positive: the defender could claim a fifty-move draw, or the game had already ended automatically under the seventy-five-move rule, while the classifier still reported the trap.

The trap proof now checks the actual defending side's draw rights before admitting a gain and rejects a root already ended automatically. At root clocks 98 and 99, the defender can announce or immediately make the fifty-move claim; at 149 and 150, the automatic ending applies. No later payoff in the cooperative source line can restore a winning headline. A clock of 97 remains positive because the relevant optional claim belongs to the attacker, who can decline it and capture. Actual captures and pawn moves reset the clock; an immediate checkmate still takes precedence over the automatic draw threshold.

The identical original 18 contracts improve from 8 passes and 10 failures to 18 passes. An expanded 32-contract suite and 26 independent Python-chess clock witnesses cover reset moves, complete timelines and checkmate precedence. These are constructed variants, not claims that the source game actually reached those clocks. The [trap audit](quiet-trap-adversarial-review.md) also retains six fresh development nominations and negative geometry controls; four of those nominations remain unadjudicated.

## Verification and preserved behavior

- The broad classifier regression has 3,661 genuine passes, one separately counted known expected failure, 364 conditional skips and no unexpected failures. The known failure is the existing queen-ending promotion checking race.
- All 32 frozen primary-lesson outputs are byte-identical to adapter 173. This is stability evidence, not proof that every existing judgment is correct.
- The 56-input retained public cohort changes only four paired observations for Ltbye; the other 52 complete results are unchanged after excluding the version stamp. The new development cases are tracked separately.
- The exact core staged for commit passes 875 tests with five skips across 39 files. It excludes the preserved unrelated checking-ray changes.
- The rebuilt shared trainer passes 105 tests with one optional real-engine skip. Twenty new roundtrips cover the two capture-order cases and normal versus draw-claimable traps in both colours. The first test run exposed an illegal filler move in the test and an overly broad assumption that every reversed capture should be hidden; both test assumptions were corrected without weakening the production guard.
- Whole-project types, scoped lint and the frontend/shared-review build pass. The build reports the existing large-chunk, third-party bigint and plugin-time warnings. Generated build output is not committed.

The compact [verification receipt](quiet-capture-draw-verification.json) records source hashes, the exact staged core, counts and delivery boundaries. Retained public development fixtures were read without downloading or copying a full corpus. Tests used task-owned temporary stores; no owner-store rescan, service restart, browser/native interaction or website deployment occurred.

## Remaining limits

These finite certificates cover their enumerated local continuations, not unlimited quiet counterplay or general chess accuracy. Missing or exhausted evidence remains unknown. EpYOT still has unresolved competition between its skewer labels and connected material collection; removing rear pawns changes other rook access, so that experiment does not justify suppressing the skewers. The known queen-ending promotion gap, broader recall and longer preparation sequences remain open. No holdout was consumed and no population accuracy percentage is claimed.
