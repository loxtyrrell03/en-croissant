# Recover exchange payoffs without inventing free pieces

Adapter **151 / live pipeline 158** accounts for the complete uninterrupted
same-square capture exchange before a current recapture. It also applies the
same compensation filter to missed-opportunity review and its timeline; that
path previously bypassed the live/allowed filter.

## Chess and user-visible changes

The reviewed owner ...Qxe4 ends ...dxe4, dxe4, ...Nxe4, Nxe4, ...Qxe4.
The whole exchange retains a pawn. Counting only the last two knight captures
incorrectly suppresses it; ignoring history incorrectly advertises a free knight.
The new **Winning Recapture** explanation keeps the actual 100-cp net bound.
The owner played Qxe4, so no missed-move accusation is added.

Three other owner roots recover analogous queen/knight-exchange payoffs:
Bxg4, Qxe5+ and exd4. The last is an approximately equal opening with real
Nb5 counterplay: its local pawn balance is not a winning-position guarantee.
Fresh depth-16 unrestricted/held exd4 searches both score +20 cp. Longer quiet
recovery and positional compensation remain beyond this local certificate.

The missed-review consistency repair removes three routine minor-piece
recapture claims and one unsupported positive net-gain claim; it corrects four
other capture values/wording, including the recovered queen exchange. Their
broader positional/defensive explanations are not declared solved. The mate
remains primary in the reviewed Nxf2/Kd1 example, with its corrected missed
queen-for-pawn exchange secondary.

Avoiding the final recapture does not independently prevent a pawn loss that
occurred earlier. Such partial-exchange allowed lessons remain visible but
uncompared, unless both choices are identical and the danger necessarily
persists. This prevents false blame in the earlier Qxg4 and Nxe4 choices.
Comparable captures remain qualified, not a missed free queen.

## Boundaries and contrary evidence

- Complete original-material history must replay legally to the exact board
  and preceding move. A missing/truncated capture history cannot earn credit.
- Only an uninterrupted, even-length same-square capture chain is eligible.
  Quiet gaps, off-square captures, promotions, en passant and prior positive
  surplus cannot fund the current gain. Exact zero-debt settlement retains its
  existing separate helper contract.
- The current capture still needs the existing liability/countercheck proof;
  accepting a separately proved combination still cannot become free material.
  No proof budgets, native search allowance or worker deadlines are expanded.
- Constructed both-colour legal openings reproduce the missed payoff. Keeping
  the queen on its original defending square refutes the proposed queen capture.
  An initial draft history opened an unanswered check and was rejected before
  use as a classifier regression.
- The constructed safe recaptures are best choices in slightly worse positions
  (held -65/-80 cp), not forced wins; the losing queen controls score -667/-668.
  The public receipt is `capture-exchange-stockfish-18.json`. An earlier Nxc7
  equal-queen-trade hypothesis was also rejected after correct legal replay.

## Same-input evidence

The exact 27-game/1,319-context owner comparison changes fifteen complete rows:
four live primary lists are recovered, their four preceding contexts gain
qualified exchange lessons, and seven other review contexts are corrected.
These are overlapping move contexts, not fifteen newly discovered tactics.
All 246 private course/generated-game results and twenty rare-theme results
remain identical apart from version; stability is not certified accuracy.

The final independent decision audit completes 68 depth-16 searches over the
changed owner contexts and constructed controls. Ten earlier diagnostic searches
overlap these positions and are retained separately. Real best/played/reply
scores, counterexamples and initial judgements are private under
`Documents/OnCrescent Tactical Benchmarks/`, using the `capture-exchange-` prefix
and `20260917` suffix. Owner replay `owner151-final2` is authoritative; earlier
`draft` and `final` files predate the allowed-cause qualification.

The selected source suite passes 2,754 tests with 320 conditional skips; the
subsequent fresh-engine regression and private owner assertions also pass in
the 77-check focused source/React run. Type checking, scoped lint, 26 generated
review-service checks (one optional engine skip), two development-cache/recovery
checks, and review/frontend builds pass. The service test runs a complete
constructed game and verifies history, net missed value, saved deck and reload.
Static React rendering checks both live and missed timelines; it is not native
interaction proof.

The compiled worker passes 808 public inputs and four new both-colour exchange
controls. All prior public primary lists remain unchanged. Public computation/
transfer median/p95/max is 44/213/1,143 ms, with startup max 45 ms; engine search
and native UI are excluded. Artifact `liveTactics.worker-jAKfyxhU.js` has SHA-256
`7c049199a252f8c14973f5afd923803e032a0f68bb87010db51b58b2aa337e37`.
The full owner compiled-worker and clean desktop delivery runs are separate
from this source milestone and are recorded on completion.
Broader quiet/long-combination recall, comparable-capture causal proof, larger
endgame review evidence, the known queen-ending promotion, independently
adjudicated accuracy and native/load-sensitive reliability remain open. This
milestone does not complete the classifier goal. Paid and owner data stay private.
