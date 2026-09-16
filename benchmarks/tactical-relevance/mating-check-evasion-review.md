# Mating attacks through defensive check evasions

Adapter **138 / live pipeline 144** recovers a missed mating attack from the
owner's frozen whole-game sample and a more precise outcome for one reused
public Lichess attack. It does not relax material proofs or establish broad
tactical completeness.

## Chess judgement and the actual missing lesson

The initial capture audit inspected all **85 empty principal capture roots**
in the existing 720-context owner replay. That is an inventory, not 85 missed
tactics or 85 adjudicated correct negatives. Exact history invalidated the
initial idea of explaining Kxa8 as a hanging queen: Black had just exchanged
queens with Qxa8+, and Kxa8 is White's only legal answer. The reached KPK ending
draws. The important missed opportunity is Black's **Qe5+**, keeping a mating
net instead of exchanging into that draw.

The previous long-mate verifier required quiet attacking moves to come from
the nominated PV and counted every nonchecking answer against two quiet
preparations. That conflated an answer to check with a free attacking setup.
In this real net the king must also answer alternative queen counterchecks,
not only the supplied Qd8+ branch.

Separating the quiet-evasion count alone did not solve the position: the first
draft still failed after 58,807 visits. The final fallback also considers all
legal answers when the attacking side is actually in check. Free quiet
preparations remain limited to two. The previous
economical searches run first; the fallback shares their remaining **65,536**
visits and unchanged mate horizon, at most seven attacking moves. Incomplete
searches stay unknown. No worker or engine deadline increases.

The real root now proves **mate within seven moves**, using 58,962 visits.
The independently checked tree includes 73 defensive nodes and 51 mated leaves.
Its reflected counterpart is a constructed variant, not another real game.
The positive public constructed net changes the pawn placement; it is not the
owner's full FEN. Capturable-checker and fifty-move-claim controls reject the
certificate. Root-only input remains insufficient to nominate this long mate.

The reused public **Lichess 0QPvf, Rb8** previously had a sound mixed
material-or-mate certificate. It now proves **mate within four moves**, including
quiet king evasions against rook counterchecks. That changes the primary from
Mating Attack to Forcing Mate; the back-rank pattern stays on its actual ply.
The full tree has 697 defensive nodes and 613 mated leaves. Root-only input
retains the weaker Mating Attack explanation rather than inventing the distance.

The first compiled-worker run exposed a second defect: a different stored
Stockfish PV for the same Rb8 board still produced only Mating Attack. It lacked
a quiet finishing move needed against another defence. The final fallback may
nominate an otherwise unlisted quiet **mate-in-two finish**, only when every
legal reply permits checkmate on the next attacking turn. It consumes a quiet
preparation and the same remaining visit budget. The chosen shortened horizon
is retained when reconstructing the full strategy. Earlier successful searches
run first and keep their existing choices. Both source and engine nominations
now prove mate within four, in both colours; the engine-nominated tree has
629 defensive nodes and 546 mated leaves. A constructed knight on d6 refutes
the cooperative mating line by capturing the queen on c8; Stockfish gives
Rb8 -919 cp and the classifier withholds the mate in both colours.

## Mistake review and independent validation

Exactly **two of 720 full owner rows** change: one new principal live tactic
and its missed-mate explanation, plus the preceding best-play position's
neutral danger explanation. The actual best promotion is not blamed for the
existing mate. Qxa8+ is explained as missing the mating attack, not as hanging
a free queen. All 246 private course/game and twenty rare-theme full source/live
results remain unchanged apart from versions. That is stability, not accuracy.

Eight strategy trees pass the independent python-chess checker: one constructed
net, one owner root and two nominations of one reused public root, each with a
colour reflection. These are not eight independent positions.
Every defensive reply, attacker answer, terminal mate, within-tree repetition
and fifty-move claim is checked. The owner pair additionally replays complete
game history; the reflected history uses its actual black-start fullmove count.
The initial test caught that reflection-counter mismatch before certification.
The fixture's exchanged ending is also independently probed by the local exact
KPK bitbase. The classifier itself is still not a general history-aware mate
solver; this audit does not remove that wider limitation.

The completed depth-16 engine audit has **1,458 searches**: 1,226 initial
decisions/controls and 232 additional exact FEN/held-move pairs for the final
nomination fallback. Every selected decision in the eight final strategies is
matched by full FEN (including clocks) and held move, not merely by case ID.
All certified answers have a positive mate score within their stated bound.
The two public receipts preserve 1,296 searches; owner positions remain private.
Search counts include many branches and constructed variants, not independent
puzzles or an accuracy estimate.

Private receipts are under `Documents/OnCrescent Tactical Benchmarks/`, prefixed
`empty-capture-`, `queen-mate-` and `mating-evasion-`. They preserve the failed
drafts, complete history, all exact-input comparisons and independent checks.
Owner positions and paid-course data are not committed.

## Verification and delivery

The broad 142-file selection passes 2,070 tests with 256 conditional skips.
The final four-file mating/rendered selection passes 80 tests with five optional
skips; these selections overlap and must not be added. Seventy-eight rendered
scan/timeline checks pass with one optional skip. Fourteen generated-service
checks pass with one optional engine skip, including this missed mate surviving
deck storage and reload. Whole-project types and eleven-file scoped lint pass.
The 43-module shared-review and 8,877-module primary frontend builds pass; that
frontend includes unrelated local work and is not the clean desktop source.

The final compiled application controller passes all **720 owner inputs and ten
constructed/reflected controls**. The owner classification/transfer median,
p95 and maximum are **83/332/1,406 ms**; total including worker startup is
112/362/1,435 ms, and maximum startup is 36 ms. These are Node-host cold-worker
imports, not native-window or engine-inclusive latency measurements. The
three-second computation and twenty-second startup limits are unchanged.
The tested worker is `liveTactics.worker-CvXqNHj2.js`, 571,426 bytes, SHA-256
`a9bf8ed0fabe6650c99b300fc62d2211f5ca12eeddc0a8225841457978fa24a4`.

The **808-input public production-controller check also passes**, including the
previously failing independent Rb8 engine nomination: **1,538 controller inputs**
across these three groups, not independent accuracy judgements. Public
classification/transfer median/p95/max is **42/190/1,100 ms**, with total
70/223/1,126 ms and maximum startup 36 ms. Clean desktop delivery is recorded
separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`. No owner app has been started
or restarted, and no games, settings, engines or phone services changed.

Remaining gaps include longer/unnominated mating preparations, other quiet
attacks and endgame resources, primary-theme specificity, automatic extra
review candidates, representative accuracy and load-sensitive native startup.
This milestone does not complete the goal.
