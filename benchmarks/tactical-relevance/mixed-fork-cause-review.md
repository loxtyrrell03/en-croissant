# A safe capture explains a previously unclassified fork mistake

Adapter **154 / live pipeline 161** extends the constructive capture-defence
comparison to independently verified mixed-target forks. It does not loosen
live motif admission, convert unknown proofs to negatives, or raise budgets.

## Chess finding and correction

In the reviewed owner game, Qxc7 permits ...Qxg2, attacking Rh1 and Pe4.
Adapter 153 already identified that fork. The missing lesson was why Qxc7 was
tactically bad: after O-O instead, ...Qxg2+ can be answered by Kxg2. The king's
new placement and rook's relocation meant the old two-profitable-piece geometry
was not a valid requirement for testing that defensive capture.

The original fork must have an independent complete certificate and retain at
least a pawn of loss after crediting material taken by the played move. The
alternative must have a positively verified safe capture of the same attacker,
including its entry capture, legal recaptures, all immediate friendly-piece
liabilities and one countercheck response. A failed fork proof still supplies
no causal evidence. Existing checking/connected-fork geometry gates are preserved;
they delegate their unchanged capture-safety work to the shared helper.

Fresh depth-16 searches evaluate the real O-O at +282 cp White, held Qxc7 at
-513, and Black's subsequent held ...Qxg2 at +372 cp Black. In the castled
counterfactual, Kxg2 is best and evaluates +642 cp White. These separately
searched whole-position estimates are not the 200-cp fork bound or the 800-cp
defensive capture bound. Qxc7's initial pawn is credited rather than ignored.

The same **27-game / 1,319-context** replay changes exactly one classification
and explanation: neutral opponent tactic becomes an established allowed Fork.
Every live/source result and the other 1,318 reviews are unchanged apart from
version metadata. This is one recovered mistake cause, not a new live tactic,
an accuracy percentage or completion of the conservative-recall objective.
All 246 private-course full results and twenty rare-theme results are unchanged.

## Contrary evidence and remaining real-game misses

Constructed controls cover protected attackers, off-square queen loss, an
entry capture that already pays for the attacker, and material won by the
player's move. The independent choice-credit control uses Qh3: Qxg2 is a safe
answer, but the actual Qxc7 had already captured a queen, so a two-pawn fork
cannot establish a new net material loss. Ordinary king and queen guards work
in both colours; the implementation is not specific to castling or this FEN.

The protected-queen counterfactual is actually mate in one. The first public
engine batch completed 22 searches before requesting a move from that terminal
board and receiving no PV. The final request generator excludes terminal roots;
the preceding held search still records the mate. This was an audit-harness
mistake, not a production scan failure. Two discarded off-square control drafts
also failed their intended premises (an extra capturable rook, then a bishop
blocking the queen's route). The final rook-protected bishop gives a legal
...Bxd7 queen-loss witness, confirmed by fresh engine searches.

A separate 43-search audit examines two further empty roots in the same owner
sample. Rf6+ removes the king's protection of Rh7 and breaks a perpetual setup;
both Kg5 and Kxf6 remain winning for Black, but the acceptance trades rooks
without a local material gain. This needs an outcome-aware defensive explanation,
not an invented material-profit badge. Bb4 pins Nc3, but Bd2 changes the
continuation to ...Bxe2 and ...Nd4+ rather than the simple supplied ...Bxc3 route.
Both roots remain coverage gaps. Three further selected frozen contexts were
inspected without new engine searches; ordinary development and a long checking
line were not declared solved tactics merely because their evaluations are good.

## Verification and boundaries

- 144 final fresh searches: 43 remaining-root decisions, nine owner cause
  comparisons and 92 constructed decisions in `mixed-fork-cause-stockfish-18.json`.
  Another 22 completed searches belong to the superseded terminal-root batch;
  they overlap the final set, not independent extra positions.
- Selected source suite: 2,795 passes, 331 conditional skips. The final focused
  suite passes 101 checks with nine optional skips, including independent
  choice-credit and derived nature assertions.
- Generated shared review: 29 passes, one optional engine skip; the new cause
  survives saved cards, reload and deck export. Two dev-cache checks, types,
  scoped lint and review/frontend builds pass. An unrelated pre-existing trailing
  space in generated OTB bindings is untouched.
- Compiled controller: 832 inputs (808 public plus 24 new/retained constructed
  controls). All 808 public primary lists are unchanged. Compute/transfer
  median/p95/max: 44/212/1,095 ms; startup maximum 38 ms. These Node-host figures
  exclude engine, development HTTP startup and native UI; no deadline changed.
- The full owner replay is a source/review comparison, not a fresh 1,319-input
  compiled-worker run. Native interaction/load-sensitive startup remain unverified.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/` use
`mixed-fork-cause-`, `mixed-fork-cause154-` and `remaining-root154-` prefixes
with the `20260917` suffix. The private judgement note records actual FENs and
the five selected contexts. Owner and paid-course positions remain outside Git.
Source `3b719cf5` is committed, pushed and packaged from a clean checkout;
clean types, 101 focused source/React checks, 29 service checks and frontend/
review/native builds pass. Exact embedded asset keys and normalized dependency
paths identify the clean classifier and review. Desktop identity and recovery
are recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`. No app was
running or restarted; this is package linkage, not native interaction proof.
Long/quiet combinations, broader recall, the queen-ending promotion, representative
independently judged accuracy and native reliability remain open.
