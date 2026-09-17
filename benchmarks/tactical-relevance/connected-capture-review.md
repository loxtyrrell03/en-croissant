# Connected capture recall — adapter 143 / live pipeline 150

**Source milestone; desktop delivery recorded separately.** The first engine
audit exposed an unsafe constructed witness, corrected and rechecked below.

The May owner's wrong-rook decision now has its own live and missed-opportunity
explanation. Previously only the earlier fork was understood: the capture leaf
charged the queen countercapture without recognising the collecting knight's
new attack on the opposing queen. This is one recovered decision mechanism,
not comprehensive tactical accuracy or a completed recall goal.

## Chess judgement and contrary evidence

After the reviewed ...e6, **Nxd8** attacks the queen on b7. **...Bxa3** can be
answered by **Nxb7**. **Nxh8** does not create that counterattack and loses the
queen. The new capture proof retains a local minimum of 180 cp; the root fork
still includes its initial pawn and keeps its own value. Neither value is a
full-position engine evaluation.

The exact-input replay reuses all **1,000 contexts from 21 owner games**, not
new downloads or fresh whole-game searches. Nine full rows change: four around
the May fork/collection and five source continuations containing the same Bxd5
in another game. Only the Nxd8 live primary changes. The preceding ...e6 keeps
existing danger neutral because the capture also survives ...Nf6; the wrong
Nxh8 now receives the missed Nxd8 explanation. The new result does not invent
positive prevention evidence for the separate Bxa3 accusation.

The Bxd5 continuation wins a pawn with a rook counterattack, but fresh Stockfish
also proves mate in three. Earlier source mating primaries and all live mating
headlines stay intact; the new material detail is secondary. This is **not**
certified as its ideal explanation: the capture-root short-mate nomination still
depends on the supplied continuation and deserves follow-up. Five changed rows
are not five discoveries. Empty/unchanged outputs are not correct negatives.

The first independent engine audit has **285 fresh depth-16 held-move searches**:
five real/constructed roots, 278 selected defensive answers/countercheck answers,
and two controls. The initial review incorrectly checked finite centipawns
without noticing two negative mate scores. In the constructed checking-flight
case, the selected Qa4 loses by mate in five and its Kc1 answer loses by mate in
four. This disproves that witness despite the root remaining winning. The
original receipt is retained. The corrected audit explicitly asserts the sign
of both mate and centipawn scores. Its final **140 fresh depth-16 searches**
cover four real/constructed capture roots and their selected answers, the
withheld but winning checking-flight root, the two rejected losing witnesses,
and two other controls. All expected signs pass; the 136 positive nominations
have a lowest finite score of +344 cp. This is not exhaustive chess minimax.
An earlier 111-search corrected subset also passes; it omitted a fork-payoff
root from its export, so the final exporter includes connected fork collections.
The earlier fork's complete tree is re-exported too: its value and collections
remain, but the stronger leaves add actual captures of further checking knights
and change one king evasion. All **155 fresh held-move searches** for that final
tree pass the explicit positive-outcome check. Its proof uses 1,924 of the
unchanged 4,096 operations. Those searches overlap the standalone-capture audit;
they are not 155 additional tactical discoveries or independent games.

The wrong-rook constructed control scores -273 cp. Moving the queen to a7
removes this certificate but retains another resource (+137 cp); it is not a
certified non-tactical or losing position. Removing the c/d blockers likewise
does not refute the entire Nxd8 root (held score +485), but its old local
certificate was unsafe. A legal king flight alone does not prove retention.
Connected-capture and fork-collection leaves now require any further check to
have a safe capture of the actual checker, ending the checking sequence without
another check/promotion. The same 4,096-operation budget is retained. The
constructed certificate is now withheld in both colours, not declared a correct
negative; the real owner capture and original fork remain supported.

## Implementation and relevance safeguards

- Only a newly attacked non-pawn target of the capturing piece can nominate
  the counterattack. Unrelated future PV gains cannot finance it.
- The ordinary liability-aware leaf runs first. Its remaining work allowance
  may prove the connected continuation, with every legal reply covered. The
  shared capture budget remains **4,096 operations**, not another 4,096 per reply.
  Countercaptures and all friendly-piece liabilities remain; connected leaves
  use the stronger bounded countercheck ending described above. Other existing
  preparation callers retain their previous one-evasion horizon. Promotions,
  checking roots and incomplete work do not
  enter this new fallback.
- Capture proof and explanatory metadata share one bounded cache entry. Failed
  custom budgets cannot replace normal cached evidence.
- A connected gain is not an already-earned capture for primary ranking. The
  initial draft demoted an equal-valued trapped-rook lesson; the final code
  separates immediate from connected gain and preserves that test's original
  judgement rather than changing its expectation.
- Material Gain describes the counterattack and draws the capture plus the
  actual new target. It is not labelled a free rook. Matching queen exchanges
  receive Countercapture / Countercapture Payoff without fresh profit values;
  the earlier fork instead retains Fork Payoff / Fork Countercapture. The wrong
  rook cannot borrow those labels, nor can an unrelated continuation.
- Mistake comparison includes the connected targets. A failed same-square
  exchange cannot by itself refute a complete counterattack certificate.

## Verification and delivery boundaries

All 246 private source/live course results and twenty rare-theme full results
remain unchanged from adapter 142 apart from versions. The final focused
tactical selection passes **2,653 tests**, with 295 optional skips. A final
six-file source/real-React/lifecycle selection passes 148 checks (two optional
skips). The draft
had one real trap-priority regression, corrected as described above. Existing
unrelated store tests were not included in this focused selection.

Eighteen generated-service checks pass (one optional engine skip), including the
new missed capture, contextual payoff and saved-deck reload. Its first synthetic
score fixture used the wrong cloud-score orientation and produced no card; the
fixture was corrected to White-perspective scores. Type checking, scoped lint,
review/frontend builds, and both development-cache/recovery checks pass. Real
React/jsdom checks exercise the result and actual-ply timeline; no browser
automation or owner native-window interaction was performed.

The 808 prior public compiled-worker primary lists remain unchanged; ten new
standalone capture/reflection inputs and ten existing fork inputs also pass.
Public computation/transfer median/p95/max is 42/208/1,131 ms, excluding engine
and native UI. Worker `liveTactics.worker-Dt8A9W0f.js` is 586,558 bytes, SHA-256
`45abdcd253a5b241b1180f312211d42b64e8b5d6ae4f82f4c966d058fb6e29af`.
All 1,000 owner-game inputs also match through the production controller: **1,828
final worker inputs** in total. Source results are unchanged from the corrected
draft, apart from withdrawing the unsafe constructed certificate; nine owner
rows still change against adapter 142. Desktop delivery is recorded separately.
Owner computation/transfer median/p95/max is 91/331/1,290 ms, excluding engine
and native UI. These timings do not establish an acceleration.
No new cold-HTTP reliability claim follows; the prior startup failure is open.

Private receipts use the `connected-capture-` prefix in
`Documents/OnCrescent Tactical Benchmarks/`; drafts, fresh engine searches and
exact-input source replays are retained separately. Paid/owner boards stay out
of Git. Native packaging is documented in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
Broader recall, capture-root mating specificity, longer counterplay, automatic
review candidate coverage and native startup remain unfinished.
