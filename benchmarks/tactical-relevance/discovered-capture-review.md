# Discovered checks that protect the capture itself

## Decision and scope

Adapter 107 / live pipeline 112 corrects a root lesson in the fixed public game
sample. Desktop nature remains version 4, but motif migration now refreshes its
derived nature text too. No installation, owner restart or deployment is included.

In [BkwHTU3l, before Black's 30th move](https://lichess.org/BkwHTU3l#59),
`Rxd7+` vacates d3 and uncovers Qc2's check on Ke4. Rc7 cannot answer with
`Rxd7`: that would leave its king in check. The correct primary lesson is
**Discovered Check**, not **Hanging Piece**. The capturing rook's apparent free
gain already benefits from this check in legal static exchange evaluation;
requiring a discovery to exceed that exchange value incorrectly suppresses the
mechanism which made the capture possible.

White is not forced to move the king. The critical defense is `Rxc2`, taking
the checking queen and vacating the rook's screen of Qa7. `Rxa7` then exchanges
queens while retaining the original rook gain. All three legal defenses are
covered; the reflected position uses the same 63 proof operations. `Ke5`
actually permits mate, but one mating branch is not the root's universal main
theme. The independent material certificate is sufficient without borrowing
that mate or a later PV capture as the root's explanation.

## Proof boundary

The new proof is separate from existing stronger discoveries, intermediate
captures, mating attacks and preparations. It requires:

- A capture with exactly one newly uncovered sliding check.
- A legal, profitable recapture when that checker alone is removed, which is
  illegal on the real checked board. Removing the checker must not also change
  exchange-square support or an enemy sliding ray toward its own king, even
  through another current blocker.
- Every legal check evasion must have a related retention move: the capturing
  piece's escape, capture of the recapturer/interposer by a participant, or a
  capture of a target actually screened by the departing recapturer.
- Actual captures, promotions and immediate friendly-piece liabilities are
  debited on the real board. Leaves use the existing one-countercheck-evasion
  safety check and reject immediate mate/promotion resources. The counterfactual
  never supplies material to the proof.

The shared bound is 4,096 operations, with a 128-position cache. Exhaustion
abstains. Gains are capped at the initial capture; these are **local material
bounds**, not full-position Stockfish evaluations, game wins, or proofs against
longer king hunts, perpetuals or multi-turn liabilities. Existing stronger
discovery proofs retain priority. The new branch deliberately cannot inherit
an immediate-target causal comparison: an unproved prevention comparison stays
neutral, while a proved missed root retains its lesson.

The board shows the current checking ray, not a premature d7-a7 arrow. The
timeline keeps the actual countercapture and subsequent queen capture at plies
2 and 3. Only the matching root loose-piece badge is subsumed. Short and longer
inputs, both colors, budget failures, and persisted-card migration are covered.
Visible explanations use the chess mechanism and concrete defensive reply;
search methodology stays here rather than filling the result panel.

## Independent checks and contrary evidence

The checked-in [development set](discovered-capture-development.json) contains
the real root and seven mechanism-directed controls. The controls test this
specific certificate, **not** whether their whole positions are tactical.
[Seventy-six fresh Stockfish searches](discovered-capture-stockfish-18.json)
cover both colors, held roots, all positive-certificate defenses and the actual
selected leaf moves. Three earlier exploratory searches established the queen
exchange; a 72-search draft is retained privately, not counted as final evidence.

Important contrary observations are retained:

- In the simplified bishop-check board, escaping with `Rd1` retains captured
  material but leads to a drawn rook-and-bishop versus rook ending in the
  engine. This is not a refutation of the local gain, but it is not a winning
  game. The classifier already has a stronger discovery which captures both
  rooks; that stronger explanation remains primary.
- Without Qa7, `Rxc2` loses the checking queen without the same compensation.
  Black may still be winning because it started far ahead. A positive engine
  score cannot validate the claimed capture gain.
- With Qc2 screening Bb1, `Rxc2 Bxc2` yields only 100 local material, not the
  raw rook's 500. The new single-checker counterfactual abstains, but the older
  **Hanging Piece** valuation still overstates that root. This is an open gap,
  not a correct negative or an accuracy success.
- The own-king-screen control is still labeled Hanging Piece by that older
  route even though the held root is about -7 pawns in the engine. Rejecting
  the new counterfactual does not repair that existing generic-capture bug.
- The support-square control has a stronger independent discovery. Refusing
  this narrower certificate must not erase the stronger valid explanation.

An initial drafted interposition was illegal because it answered only one arm
of double check; it was rejected and replaced by a legal king-capture control
before the final sample/search run. No failed draft is counted as coverage.

## Verification and delivery

- 2,206 selected tests pass with 90 optional skips, including the final
  causal-comparison guard. The 45 focused proof/context checks pass; the
  optional public exporter also passed and produced the 76 probes.
- All 246 private source/live full results, twenty rare-theme full results and
  32 frozen priorities remain unchanged apart from version. These include
  tactical and positional course material, openings, endings, interference and
  exact zugzwang cases. Stability is not a fresh accuracy judgment.
- Of 45 fixed public opening/middle/ending mistake contexts, only the described
  primary/explanation/timeline changes. The other 44 full classifications stay
  unchanged; neither their abstentions nor their stability are called correct.
- Twelve actual React/browser-worker groups check the Tactics result, current
  arrows, labels, collapsed continuation and keyboard interaction. Twelve
  game-info groups check the missed lesson, reveal, details and saved-card
  migration. Both cover 1100/760/360 px and 100/200% text. Screenshots were
  inspected; the initial overlong explanation was shortened.
- Whole-project TypeScript, scoped lint, shared-review and 8,875-module app
  builds pass, plus four service and two development-cache checks. Existing
  large-bundle warnings remain.
- All 19 production-controller groups pass: **1,511 inputs**, including 104
  added inputs (32 mechanism/control variants and 72 source/best/response lanes
  from the remaining 24 fixed game contexts). The [public worker receipt](built-worker-adapter107.json)
  contains 1,003 allowlisted public inputs; 508 private inputs are not published.
  All 899 prior public headline lists remain unchanged. Public computation and
  transfer median/p95/max are 37/182/835 ms, excluding engine/UI and startup.
  The largest production-worker startup in this run is 36 ms on this Node host.
- All 81 isolated cold-HTTP cases pass. Startup remains variable: first/max
  worker startup is 10,712 ms, and server startup is separately 21,910 ms in a
  run overlapping other verification. Maximum computation/transfer is 1,347 ms.
  The existing 20-second worker-startup and 3-second classification bounds are
  unchanged. This is not native WebView/CSP or physical-device reliability proof.

Final built worker: `liveTactics.worker-DOSomRWe.js`, SHA-256
`2520bd3631d0571c8a62c401396333ec0a0fd5f9db29bb28ab0db7231f9e474b`.

Private receipts are under `Documents/OnCrescent Tactical Benchmarks`:
`adapter107-selected-final.json`, `adapter107-rare-final.json`,
`adapter107-nature-final.json`, `discovered-capture-probes-final.json` and
`discovered-capture-stockfish-final.json`; the four `adapter107-worker-*-final.json`
reports and `adapter107-dev-cold-final.json` retain runtime receipts. Paid content
stays private. Public exports use `game-context-receipts.mjs discovered-capture`
and `discovered-capture-worker-receipt.mjs`, which validate the public input set.

The next accuracy work should address generic capture labels that ignore a
lost checking piece or exaggerate compensation, without treating already-won
positions as proof of those local claims. Broader rare/quiet/causal coverage
and native runtime verification remain open. This is a scoped improvement,
not completion of the overall accuracy goal.
