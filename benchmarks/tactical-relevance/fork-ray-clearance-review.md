# Fork preparation by clearing a slider ray

Adapter **156 / live pipeline 163** recovers a reached alternative from an
owner game. This does not solve the original quiet **...Bb4** root or complete
the broader conservative-recall goal.

## Chess finding and relevance

After **...Bb4 Bd2**, **...Bxc3** was previously empty. If Bxc3 accepts, the
bishop leaves d2 and opens **Qc1+**, forking Ke1 and Ng5. Rxc3 instead permits
Qa1+, with a different fork/mating continuation. Declining by **Bxg4** requires
the correct order: **Bxd2+** first, then **Nxg4** after each check evasion.
All 33 root replies now have a bounded connected continuation. The local
minimum is 220 cp, not the engine's full-position evaluation or a free knight.

The classifier identifies **Fork Preparation**, explains the departing blocker,
and draws the offer/possible acceptance on the current board. The later fork
is not drawn prematurely. A constructed queen-loss review keeps Hanging Piece
primary and the missed preparation secondary, in both colours and after saved
shared-review reload.

## Algorithm and safeguards

- This supplements existing capture preparations only when accepting the offer
  newly opens a bishop/rook/queen ray to a different non-pawn material victim.
  Original and reached geometry, legal entry and reintroducing the actual
  blocker must agree. Only the newly opened victim can finance the fallback.
- The checking fork must independently retain material against every defence;
  the sacrifice, all friendly-piece liabilities and counterchecks still count.
- If the same slider can safely take that victim directly, the added fork
  explanation is suppressed. A direct deflection should not acquire an
  unnecessary checking-fork badge.
- The offered piece can answer a connected off-square countercapture by first
  taking that same ray blocker with check. All check evasions and immediate
  counterchecks are independently checked before collecting the actual
  counterattacker. Unrelated loose material cannot fund this branch.
- Existing operation budgets, worker deadlines and network behavior are unchanged.
  This is bounded local verification, not exhaustive longer-attack proof.

## Contrary evidence and corrected judgments

An initial constructed queen entry was not a useful new preparation: Qxg6
already collected the victim. Moving the king also left Qb1+ available when
Qc2+ was capturable, so that first proposed negative was wrong. The final
construction starts the queen on e2, where neither shortcut applies; removing
the king's protection then genuinely defeats the proposed Qc2+ certificate.

A rook-file construction also allowed the simpler Rxc7. It is retained as
a direct-deflection control, not celebrated as another recovered preparation.
Other controls cover a second blocker, an already open ray, a pawn victim,
a victim capturing the forker and a recapturing pawn newly defending the victim.
Several control roots remain winning through other mechanisms; rejection of
this certificate does not establish a non-tactical or losing position.

## Evidence and delivery boundaries

- The final engine audit has 121 fresh depth-16 decisions: 72 public constructed
  searches in `fork-ray-stockfish-18.json` and 49 private owner searches. These
  include repeated positions and colour reflections, not 121 independent puzzles.
  The selected positive/reached-owner decisions remain winning in these searches.
- Python-chess independently verifies complete root-reply sets (6, 6 and 33),
  the three opened rays, all five countercapture check evasions and their
  countercheck answers. An omitted root reply is rejected. It does not certify
  the TypeScript material arithmetic or a full-position win.
- The same 27 games / 1,319 actual contexts have **no full-result changes**.
  This recovery is in a reached alternative, not an additional actual-game root.
  All 246 private-course and twenty rare-theme full results remain unchanged;
  stability is not an accuracy rate.
- The selected suite passes 2,837 tests (336 conditional skips). Final focused
  source/React checks pass 109 tests (two skips); 31 generated-service checks
  pass (one optional engine skip). Types and builds pass. Scoped lint has no
  errors; the new diagnostic's conditional assertions have seven warnings.
  An earlier parallel selection hit one secondary-sample test timeout; the
  isolated test and final full selection pass without changing that assertion.
- The compiled controller passes 808 existing public inputs plus twenty new
  constructed/reflected inputs and the reached owner alternative. Three checks
  against the retained adapter-155 worker reproduce the former empty outputs.
  The full owner compiled replay and clean desktop delivery are recorded separately
  after completion. No native interaction or startup-under-load claim is made.

Private receipts are under `Documents/OnCrescent Tactical Benchmarks/`, prefixed
`fork-ray-` and dated `20260917`. The `decisions156-final`, `engine156-final`,
`review-engine156`, `owner156-final`, `private156`, `rare156` and
`worker156-baseline` receipts are authoritative over earlier drafts.
Paid material and owner boards are not committed. The original pin's other
defensive mechanisms, longer combinations, known queen-ending promotion and
broader recall/primary-theme accuracy remain open.
