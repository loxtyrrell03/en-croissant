# Checking exchanges before a material capture

Adapter **164 / live pipeline 171** recovers a move-order lesson found while
reviewing the owner's games. It also avoids turning a delayed, compensated
recapture into a new material win. This is development evidence, not a general
accuracy estimate or completion of tactical recall.

## Chess judgment and contrary evidence

In three related positions, Bxf3+ exchanges a bishop for a pinned knight before
collecting a rook. Taking the rook first permits g4, attacking the bishop and
knight and breaking the pin. The checking exchange is the useful first-move
lesson; neither a free knight nor a fork already on the current board is a
correct explanation.

The initial fork argument was incomplete. After ...Nd4, White can need Nxd4
before collecting the bishop; declined recaptures and ...Ne3+ also matter.
The old immediate-capture proof could not establish that recovery. The new
optional equal-exchange continuation checks every acceptance and decline,
including liabilities and counterchecks. The real root retains a 490-cp local
bound. Reversing the order has a separately proved recovery of 100 or 130 cp;
these are local material bounds, not full-position evaluations or best play.

Final fresh depth-18 root searches prefer Bxf3+ in these cases. Its held scores
are +746, +863 and +907 cp for Black; the principal reversed captures score
+580, +788 and +808. A worse capture of the other rook is not used as the
comparison. Earlier/later Bxf3+ positions without the connected rook capture
remain unclassified by this mechanism.

A constructed bishop-for-bishop variant disproved an initial negative judgment:
g4 fails, but Bxh5 is a different, valid resource after taking the rook first.
The implementation covers that direct capture too. Conversely, removing the
pawn or fork target, failing to check, or permitting capture of the forking
pawn cannot establish this certificate. The sparse first queen-exchange
control was also corrected: its proposed final capture ended in insufficient
material; the final exercise retains pawns. These are constructed controls,
not additional real-game successes.

There are **434 final owner-branch searches and 78 constructed-control searches**.
Independent python-chess reconciliation checks all 928 lines and 15,943 legal
SAN/UCI moves, plus 132 selected counterfork leaf paths and every root defence.
An earlier 51-search audit is recorded separately, not added to the 512 final
search count. Some local-proof moves are substantially inferior to Stockfish's
preferred continuation; this certificate does not call them optimal or claim
to solve longer king attacks. Engine scores nominate/review the lesson rather
than supplying the proof.

## Integration and limits

- Near-equal checking captures before a separate rook/queen capture nominate
  the new family. A real all-defence collection and a legal reversed-order
  counter-resource must independently establish at least a pawn-scale
  difference. Both branches share 16,384 operations. One equal exchange and
  one check-evasion round are allowed; budget exhaustion remains unknown.
- `proveDefenderCombination` keeps its old defaults. The equal-exchange option
  requires full friendly-piece liabilities and countercheck verification;
  arbitrary unrelated captures cannot nominate that exchange.
- Live roots and missed opportunities share Intermediate Check. Root arrows
  show the check and deferred capture, never the hypothetical defensive fork.
  Making the check illegal does not alone establish an opponent mistake cause:
  the deferred capture may remain. Independent alternative capture causes stay.
- A matching earlier capture is included in exchange accounting. A real
  defensive move order remains visible with value zero rather than being
  erased, but it does not claim new material profit. A later generic rook-win
  badge is removed. Complete-history settlement, or two explicitly replayed
  equal major-piece captures on that exact square, preserve genuine profit;
  unrelated old gains do not finance it.
- The additional owner-game queen exchange remains a conditional ply-3 lesson
  in an alternative line, with no root headline/arrows and no fresh rook profit.
  Its initiating queen check is not claimed proved by the later exchange.

## Verification

The final **33-game / 1,704-context** source replay changes seven full results:
six contexts around the three related checking exchanges, and the qualified
secondary queen exchange in another game. The other 1,697 full results remain
unchanged. All 246 private course/generated-game results, twenty rare-theme
results and 808 previous public worker primary lists remain unchanged. This
is regression stability, not 1,697 certified correct positions.

- **2,975 passing tests / 362 conditional skips across 215 files**, including
  27 new move-order/context tests. Private opt-in diagnostics are separate.
- **72 actual React/browser-worker groups** at 1100/760/360 px and 100/200%
  text; keyboard selection, exact arrows, zero-profit wording and layout checks.
- **39 generated-service tests / one optional engine skip**, including
  both-colour missed lessons, deck export and saved reload; two dev-cache tests.
- Whole-project/review TypeScript, scoped lint, review and frontend builds pass.
  The dirty-checkout frontend is not the desktop package source.
- The final compiled artifact is `liveTactics.worker-DSfmccF9.js`, SHA-256
  `7f22e65e1b6e2c04b3bbd1f3ada6fde6f0e07b4a35fb41c33b7a0d2e4707453a`.
  All 808 public inputs, 1,704 owner contexts and twenty new constructed/history
  inputs pass the production controller: **2,532 compiled inputs** in total.
  The final owner replay matches the frozen source results. Clean packaging is
  recorded separately in the desktop delivery receipt.
- Public computation/transfer median/p95/max: **41/189/1,047 ms**, excluding
  engine and native UI. All **227 cold HTTP cases** pass: first/max startup
  1,254/1,754 ms, maximum computation 1,228 ms; server startup is separately
  2,093 ms. An earlier run reached 6,234 ms startup. Neither run resolves older
  load-sensitive failures or proves native latency.

Private receipts use `order164-*-shipped-20260918.json`; source decisions,
counterexamples and engine requests remain outside Git. An in-flight draft
worker run compared an earlier frozen report with the rebuilt final bundle
and correctly rejected the changed zero-profit timeline. It is not a final
parity receipt. Clean desktop delivery is documented separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`.

Longer/quiet intermediate moves, more elaborate counterplay, the complete
Bxa6 combination, Re8+ saving resource, mixed quiet/mating Bd7+ branches,
broader primary-theme judgment and native interaction/startup remain open.
Owner stores are not rescanned, and no phone service is deployed or restarted.
