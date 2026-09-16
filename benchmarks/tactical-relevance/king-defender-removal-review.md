# King-safe defender removal — adapter 141 / live pipeline 148

A bishop capture in a fresh owner game was missed because its payoff was a king
capture that had previously been illegal. The classifier now explains that
legality-changing removal instead of requiring a legal losing exchange before
the tactic. The local Tactics result and missed/allowed mistake explanations
share the same proof; no score threshold or worker deadline is relaxed.

## Game review and contrary evidence

Three June games were frozen by end time before engine/classifier output,
without result or tactical filtering. All 168 pre-move positions and both
colours are retained, with 168 fresh depth-16 MultiPV-3 searches. Initial notes
cover selected board judgements, not independently adjudicated labels for every
move. The initial notes missed a queen trap and a mate in one that the existing
classifier found. A proposed knight fork is correctly rejected because the
opponent can capture the knight; only after a different reply does collecting
the rook become a genuine exchange gain. The bishop fork and discovered/double
checks were already explained. Ordinary opening and exchange controls remain.

The new omission was identified while inspecting an empty engine-root result,
not in the blind initial notes: Rxd6 removes the bishop guarding a rook on f4.
After Kxd6, Kxf4 becomes legal. The engine's original root score is +510 cp;
fresh held Rxd6 is +482 compared with +12 for the actually played Rd1. This is
a missed removal, not a free rook or a claim that every defence takes the offer.

The new proof covers all 29 legal root replies, including checks and declines.
Its local minimum is 150 cp after compensation and liabilities. The final
145-search receipt separately tests 29 defences, 29 selected answers, seventy
countercheck answers, three root/played decisions and fourteen constructed
root decisions. All 99 selected real answers remain positive at depth 16
(minimum +367 cp). These full-position estimates are not the 150-cp local bound.
Five earlier decision probes are retained separately: **318 fresh searches**
including the game audit, not 318 independent positions or tactical finds.

## Proof and scope

- Removing exactly the captured guard from the original board must make the
  previously illegal king capture legal; the real move must enable it too.
  The illegal exchange sentinel is never treated as a material loss or profit.
- Every legal root reply needs a concrete answer. Accepting the offer must
  permit the connected king capture; declining may retain only material
  already earned. An unrelated later capture cannot finance the tactic.
- Leaves charge all friendly-piece capture liabilities and answer immediate
  counterchecks under the existing preparation-safety horizon. Terminal or
  promotion uncertainty and exhausted work abstain. The shared operation cap
  is 4,096; live startup/calculation deadlines are unchanged.
- A guard already freely won does not acquire a redundant removal badge.
  A second guard, a replacement guard and an exposed queen invalidate the new
  certificate. A negative control may still have a different win: the added
  queen construction has an alternative forced mate while held Rxd6 draws.
- The starting annotation shows the capture, the guard relationship and the
  king's target. It does not draw the opponent's optional acceptance as forced.
  Both colours, root-only input, accepted/declined lines and actual-ply output
  are tested. Playing the identified move is not a missed opportunity.

A final continuation check reproduced a second defect in the draft: the king's
capture after acceptance still said it won a separate free rook. Exact matching
of the verified root/reply/king-capture branch now labels that actual-ply event
**Defender Removal Payoff**, without another profit value. The accepting move
does not receive a contradictory material-win badge. A standalone reached
position without that history retains its own ordinary capture judgement; an
unrelated continuation cannot borrow the contextual payoff. Initial worker
receipts precede this correction and are not the final shipped artifact.

The input-matched owner replay now covers **940 contexts from twenty games**.
Only two rows change: the preceding move's allowed cause and the missed/live
Rxd6 lesson. These are one recovered tactic. The old 772 contexts and other
166 new contexts are unchanged in full, ignoring version metadata. All 246
private course/generated-game and twenty rare-theme results are unchanged too.
Stability and empty results are not independently certified correct judgements.

## Verification and remaining gaps

The constructed root-only test first reproduces the missing label in the old
source. Focused source/real-React markup, history, interference and selection
checks pass 115 tests with one opt-in skip. Types and scoped lint pass. The
final whole utility suite has 3,145 passes, 291 optional skips and two store failures;
both failures reproduce in the prior clean pipeline-147 checkout (the audio
mock and strict timestamp shape), not in the new classifier test. Sixteen
generated-review/service tests pass with one engine skip, including the new
missed lesson's saved deck and reload; both worker-cache/recovery tests pass.
Rebuilding after the payoff correction exposed a test-only serialization
mismatch: JSON omits the optional undefined profit field. The persistence test
now compares the serialized record and explicitly checks that the saved payoff
keeps its label and ply without acquiring another profit value.

The final rebuilt worker passes **1,764 production-controller inputs**: 940
owner contexts, sixteen constructed/reflected mechanism and payoff cases, and
808 public inputs. Every prior public primary list is unchanged. Artifact:
`liveTactics.worker-HfAA__UU.js`, 578,669 bytes, SHA-256
`d8b31033e9b7cecaa7edb69e01293567356e4d4bbc92d507d477e0c74337388a`.
Owner classification/transfer median/p95/max is 91/332/1,362 ms; public is
41/200/1,111 ms. These Node-host measurements exclude engine and native UI,
do not establish a speed improvement and do not resolve cold HTTP startup.
The frontend build transforms 8,877 modules in the dirty primary checkout;
that whole frontend is not the clean desktop delivery source.

Private sample, initial/reviewed notes, the full replay, proof and fresh engine
receipts use the `chesscom-june-three-` and `king-removal-` prefixes under
`Documents/OnCrescent Tactical Benchmarks/`. Owner boards remain outside Git.
Final compiled receipts are `king-removal-owner-worker141-final-20260917.json`
and `king-removal-public-worker141-final-20260917.json`; the final owner source
replay is `king-removal-owner141-payoff-final-20260917.json`. Clean desktop
delivery is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`;
source and worker checks alone do not establish native-window behaviour.

Longer king hunts, other history-sensitive captures, primary specificity,
automatic review candidate coverage and native/cold-start reliability remain
open. This is a concrete recall improvement, not comprehensive tactical
accuracy or a resolution of the earlier twenty-second cold-start failure.
