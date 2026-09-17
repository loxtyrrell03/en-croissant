# Fork collection through countercaptures — adapter 142 / pipeline 149

The new May owner-game audit recovers a genuine rook fork previously labelled
only Hanging Pawn. It also fixes a misleading payoff in the played continuation:
taking the wrong rook loses the queen and cannot borrow the successful branch.
This is one explained mechanism, not a claim that all tactical recall is solved.

## Selection and chess review

The May archive contained one eligible game, not the requested three. All sixty
pre-move contexts were retained without result/tactical filtering, with initial
board judgements written before the engine/classifier run. Sixty-one fresh
depth-16 MultiPV-3 searches cover that game. The combined unchanged-input replay
now contains **1,000 contexts from twenty-one games**.

Nxf7 attacks both rooks. After ...e6 or ...e5, collecting on d8 attacks the queen
on b7, so ...Bxa3 can be answered by Nxb7. Nxh8 instead permits an uncompensated
queen loss. Other relevant root defences include ...Nb3 and ...Nc4, which create
counterattacks against the queen/rook. Simply trying quiet allied repairs did
not establish the fork; that failed diagnostic is retained rather than counted
as an improvement.

Fresh held Nxf7 scores +411 cp; after ...e6, held Nxd8 scores +489 and Nxh8 -385.
These are whole-position estimates, not the classifier's local material bound.
The final defensive decision probes also support the previous-move explanation:
...Qe8 permits a safe ...Qxf7 after Nxf7. The queen capture scores +160 for Black
in that reached search. Failure of a shorter fork proof is not used as evidence
that the better move prevents the tactic.

The initial May notes were not an infallible oracle. The apparently loose rook
on d2 was defended by Bc3; its rejection was correct. ...Nb3+ was not a king/rook
fork and actually permitted axb3. The retained source reports make these
corrections distinguishable from genuine classifier omissions.

## Implemented mechanism and limits

- A collection that creates a new attack may use a connected countercapture.
  The extra target must be newly attacked by that same collecting piece.
  Already available unrelated gains cannot fund the new certificate.
- Every legal root reply and every reply to an extended collection needs a
  concrete retained-gain answer. Declining the follow-up may retain material
  already earned; accepting includes the actual friendly-piece loss.
- Extended leaves check all friendly liabilities, immediate terminal resources
  and the existing one-countercheck safety horizon. Work shares the original
  **4,096-operation** fork budget; no startup/calculation deadline increases.
- The real proof covers 24 root replies, including 108 selected collection
  leaves, and uses 1,823 operations. Its minimum local bound is **270 cp**.
  This is bounded tactical accounting, not exhaustive chess minimax or a
  guarantee against longer king hunts and multiple remote losses.
- A safe capture of the forker can positively establish prevention for these
  quiet forks. Longer collection proofs do not fall back to a failed shallow
  comparison; persistence requires the corresponding complete certificate.
- Starting arrows show the two rook targets only. Exact accepted continuations
  label the two queen captures Countercapture / Fork Countercapture without
  inventing two additional material gains. The losing Nxh8 continuation cannot
  acquire a Fork Payoff badge from the verified Nxd8 branch.

The fresh engine decision receipts contain 141 selected root/collection/
countercheck searches, with minimum +292 cp, plus ten initial decisions,
ten causal/constructed decisions and two capturable-forker controls. Including
the game scan, that is **224 fresh searches**, not 224 independent tactical finds.
The proof budget, receipt decisions and legal replay are independently checked.

Constructed controls are not owner-game exports. Both colours are exercised,
including a capturable forker, unavailable connected queen, checking flight,
wrong rook, and missed-versus-played distinction. Some withheld certificates
still have other winning resources: moving the queen to a7 permits separate
queen captures/mating ideas, and the checking-flight board also remains winning.
The capturable-forker board also retains a different checking attack (+416 cp
in the held root search). These are limits of this fork mechanism, not
certified non-tactical positions or whole-position losing moves.

## Regression evidence

Only three combined owner rows change: the fork's live/source result, its
preceding allowed-fork explanation, and an earlier source continuation containing
the same fork. No other owner root headline changes. The May Nxh8 mistake still
lacks a fully established causal comparison at its own root; recovering the
earlier fork does not falsely certify that separate explanation.

All 246 private course/context source/live results and all twenty rare-theme
full results remain unchanged apart from version metadata. All 808 prior public
compiled-worker primary lists are unchanged. Stability and empty outputs are
not independent accuracy judgements.

The broad utility run passes 3,159 tests with two pre-existing store failures
(audio mock and strict timestamp shape), already reproduced in the prior clean
package. A first run mistakenly forced the browser-dependent suites into Node;
its environment errors are retained separately, not product regressions. The
final focused selection passes 130 source/real-React checks (one optional skip),
including both-colour proofs, causes, payoffs and board geometry. Seventeen
generated-service checks pass (one optional engine skip), including save/reload.
Types, scoped lint, review/frontend builds and both
development worker-cache/recovery tests pass. The VM-module cache test requires
Node's existing --experimental-vm-modules flag.

All **1,818 final production-controller inputs** pass: 1,000 owner contexts,
808 prior public cases and ten constructed/reflected controls. Owner
compute/transfer median/p95/max is 90/332/1,426 ms, excluding engine/native UI.

Compiled worker: `liveTactics.worker-Cy6YTwLW.js`, SHA-256
`464a0036dabfadc74db1d7013268cb3f49944959d4f136199625882063e59296`.
The 808-input public compute/transfer median/p95/max is 42/193/1,096 ms,
excluding engine and native UI. These figures do not establish an acceleration
or resolve the prior twenty-second cold-development startup failure.

Private evidence remains under `Documents/OnCrescent Tactical Benchmarks/`,
using `chesscom-may-`, `may-fork-` and `fork-collection-` prefixes. Desktop package
delivery is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`. No owner app/data or phone service is changed
by the audit. Broader recall, standalone collection causes, primary specificity,
longer counterplay and native startup/interaction remain open.
