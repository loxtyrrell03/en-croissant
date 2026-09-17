# Quiet mating finishes and concrete king escapes

Adapter **147 / live pipeline 154** recovers the mate-in-five punishment left
open in `promotion-check-retention-review.md`. It also gives one existing
owner-game mate a positively verified defensive comparison. These are separate
findings: the new mating root is a constructed bad alternative at an anonymous
real-game position, not a newly discovered played owner mistake.

## Chess findings, including the limits

After the constructed ...Rh6, Re7+ starts a forced mate. The former verifier
could not finish the ...Kh8 / Rb3 branch: ...Rb6 needs Rxb6 before two further
mating moves, and ...d1=N+ requires a legal king evasion. Nineteen fresh
depth-20 Stockfish searches inspect the root, Rb3 and all seventeen legal replies
to it. The root now leads with Forcing Mate; the real ...d1=Q opportunity remains
the separately missed secondary Promotion lesson, rather than replacing mate.

The better promotion leaves Kh6 after Re7+, an escape unavailable after ...Rh6.
A complete finite defensive strategy checks every attacking move, not just
checks or the supplied principal variation. This proves avoidance of this
particular five-move mating entry, not a draw, a win or safety from longer and
different attacks. The colour reflection is a constructed control, not another
real-game discovery.

In the unchanged 24-game owner corpus, one actual Ke7 mistake already had a
verified Nf5+ mate-in-five but only a neutral after-move explanation. Nf6 instead
leaves Ke6 after Nf5+; a separate complete finite defence now establishes this
escape. Fresh depth-20 searches put Nf6 at -872 cp for White and Ke7 at mate
against White in five. White was already badly losing. The new explanation
explicitly does not imply that the alternative saves the game.

Candidate order prefers king flights that guard allied material, without using
that preference as proof. The first draft selected Kc6 (-902 cp for White);
the final witness Ke6 (-695 cp) guards the knight. The unrestricted engine
prefers Ke5 (-639 cp). These are finite-depth full-position estimates, not an
optimal-defence claim or material-proof values. The earlier 38-search draft is
retained as contrary evidence, separate from the final engine receipt.

## Algorithm and contrary controls

- Existing successful mating strategies are unchanged. Only after the existing
  fallback fails may a quiet mate-in-three finish be independently nominated.
  Every defence still requires a mating answer, within the original overall
  horizon and the remaining shared 65,536-operation allowance.
- The existing finite entry-capture defence keeps its maximum four-move horizon.
  A separate noncapturing king-flight mode permits at most five moves with the
  same 32,768-operation limit. It must start as a legal check evasion and be
  unavailable in the actual mistake position. Failure or exhausted work cannot
  certify safety.
- A constructed defending knight can capture Re7 even though the supplied
  cooperative line still ends in mate. That certificate is rejected in both
  colours. A fifty-move claim likewise defeats the mating claim. Kh8 in the
  actual mating position is legal but cannot become a defensive certificate.
- Invalid/exhausted budgets and unsupported horizons abstain. Root arrows show
  Re7+, not later Rxb6 or the underpromotion. The defensive underpromotion
  remains at its actual fourth ply in the continuation.
- Generated mistake review preserves mate as the primary explanation and the
  missed promotion as secondary through saving and reloading the card.

## Independent verification

Python-chess replays three complete mating certificates and three finite
escape strategies, independently enumerating legal moves. The constructed and
reflected mates each have 78 defensive nodes and 57 terminal mating leaves;
each escape graph has 13,948 nodes and 59,267 independently checked final
attacking moves. The actual owner mate has 34 defensive nodes and twenty mating
leaves, replayed with the complete game history. Its escape graph has 11,841
nodes and 95,100 final moves. Empty false-mate and missing-defence-branch
certificates are rejected.

The two constructed mate proofs use 4,440 visits each; their escape proofs use
22,715 each. The owner escape uses 22,966. Separate Stockfish 18 verification
covers 217 final fresh searches: nineteen branch searches, 160 constructed/
reflected strategy searches, and 38 owner strategy/decision searches. These
overlap in positions and are not 217 independent examples. All selected mating
answers agree with the claimed finite mate bounds. The engine corroborates
those answers; the independent complete trees supply the all-defence evidence.

## Same-input replay and delivery scope

Exactly one of 1,181 owner-context full results changes, solely its mistake
classification/explanation. All live principal results and the other 1,180
full chess results are unchanged, ignoring version/timing metadata. All 246
private course and twenty rare-theme full source/live results remain unchanged.
All 808 previous public compiled-worker primary lists remain unchanged. These
are regression comparisons, not independently certified correct negatives or
an accuracy percentage.

The selected source run passes 2,714 tests with 306 optional skips; it includes
the deliberately expected queen-ending promotion coverage failure. Whole-project
TypeScript, eight-file lint, 22 generated-service checks (one optional engine
skip), review/frontend builds and two development-cache scenarios pass.
All 2,017 compiled-controller inputs pass: 808 public cases, 22 promotion
controls, six new mating/contrary controls and the complete 1,181-context owner
replay. Every owner scan matches both source and its frozen final replay.
Public classification/transfer median/p95/max is 43/210/1,125 ms, excluding
engine and native UI; owner timing is 91/311/1,448 ms. The unchanged worker limits are twenty seconds to start
and three seconds to classify. Controlled-run timings do not resolve the
previous load-sensitive native/development startup failures.

The tested worker is `liveTactics.worker-mAwbhSwL.js`, 590,484 bytes, SHA-256
`282f8f15d38154b11498c8f1647b2599f58f620b166abb9dc8abc48db8b3f0b8`.
Source `9cb1d9eb` is also packaged from a clean committed checkout; its worker
is byte-identical to the tested artifact. Clean source/React/service checks and
frontend/native builds pass. `docs/TACTICAL_DESKTOP_DELIVERY.md` records package
identity and the preserved prior executable. No owner app was running or
restarted; games, settings, engine installations and phone services are unchanged.
The public queen-ending promotion remains an explicit missed tactic. Broader
quiet preparation, longer combinations, full causal coverage and native
interaction/startup verification remain unfinished.

## Private receipts

Under `Documents/OnCrescent Tactical Benchmarks/`, the `quiet-finish-` reports
dated `20260917` include `owner147-final`, `public-worker147-final`,
`owner-worker147-final`, `tests147-final`, `strategies147-release`,
`owner-strategies147-final`, `engine147` and `owner-engine147-final`.
`mating-punishment-branches147-20260917.json` records the initial nineteen
branch searches. `private147-draft` and `rare147-draft` record the complete
source/live course replays; subsequent king-flight candidate ordering affects
only mistake comparison, not these position scans. Earlier draft engine and
strategy receipts remain separate. Paid course material and owner game
identities/history remain outside Git.
