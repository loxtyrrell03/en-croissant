# Promotion through continuing checks — adapter 146 / live pipeline 153

The real ...d1=Q omission retained in `immediate-promotion-review.md` is
recovered. The older verifier required checking exchanges to settle too early;
the new promotion-specific fallback follows every legal checking reply and
selects a material-retaining legal answer. The headline is Promotion at the
actual first move, with a 300-unit local bound after possible rook compensation.
It does not claim an eight-pawn gain, a won game or a +3 engine evaluation.

## Independent chess review and contrary drafts

Depth-20 Stockfish estimates the real promotion at +51 cp for Black and its
constructed colour reflection at +47 cp for White. Both roots have 31 legal
replies. The retained strategy has 118 distinct answer positions per colour.
All are checked with unrestricted and held-move engine searches: 536 final
requests are covered by 312 exact-input reused searches and 224 fresh searches.
The reused results come from the 400-search first draft, not another 312 fresh
searches. Three additional fresh searches inspect a constructed missed choice.

The first draft's positive material arithmetic admitted queen liquidation into
a losing pawn ending. Rejecting only loss of the last non-pawn was insufficient:
other branches traded queen for rook into losing rook endings. The final
fallback tracks the newly promoted piece through its moves and rejects any
legal opposing capture of it. It therefore cannot fund this certificate with
those liquidations. Earlier draft receipts remain as contrary evidence.

All selected final held answers have a positive finite engine score or a
positive mate score; the smallest finite estimate is +46 cp. They are not
necessarily best moves: one response gives up 736 cp relative to the engine's
preferred reply while retaining roughly +60 cp. These searches corroborate
the absence of the observed losing witnesses, not optimal play or a numerical
material theorem.

An independent python-chess checker re-enumerates legal checks, selected
evasions, captures and material exchanges. Each colour checks 126 nodes and
55 leaves, with zero cycle closures, at the claimed 300-unit bound. Empty and
inflated certificates fail. This checks the finite checking strategy, not all
quiet plans or the full game outcome.

## Runtime and relevance boundaries

- Promotion alone uses a shared 16,384-operation allowance for its existing
  retention check and the new fallback; there is no fresh budget after
  exhaustion. The recovered cases use 14,801 operations each. Ordinary capture
  budgets and the 20-second startup / three-second worker deadlines are unchanged.
- Every opposing check needs a legal positive answer, with off-square friendly
  liabilities and immediate terminal refutations debited. The fallback permits
  at most eight check/answer rounds. An identical checking board can close a
  material-retention cycle, not establish a win; cycle-dependent results are
  never cached across paths. The audited recovery does not need this cycle rule.
- Opposing promotions, exhausted work and unsupported branches abstain.
  The public i2SLh queen-ending checking race still lacks a certificate and
  remains an explicit expected coverage failure, not a correct negative.
- The actual preceding owner move still has a neutral “Tactic after the move”
  explanation: a better checking move may delay promotion, which does not prove
  it prevents the opportunity. The separate constructed Rh6/Rd3 example retains
  a missed-promotion lesson through generated review, save and reload.
- Stockfish finds a stronger Re7+ mate in five after that constructed Rh6.
  The classifier currently misses this mating punishment and instead leads
  with the genuine missed promotion. A second explicit expected-failure test
  records the incomplete primary explanation. This is not a solved cause.

## Same-input comparison and verification

The 1,181-context / 24-owner-game replay changes two full result rows: the
promotion root gains its immediate lesson, and the preceding move gains the
neutral opponent-tactic explanation. These are contexts of one recovered
opportunity, not two independent tactics. The other 1,179 full chess results
are unchanged, ignoring version and timing metadata. All 246 private course
and twenty rare-theme full source/live results remain unchanged; this is
stability, not an accuracy percentage. All 808 prior public worker primary
lists remain unchanged.

The source selection passes 2,707 checks before adding the separate mating
coverage test; the final focused run passes 84 checks plus two explicit
expected coverage failures (three optional skips). The independent checker,
whole-project TypeScript, scoped lint, 21 generated-service tests, two dev-cache
checks and review/frontend builds pass. Renderer checks confirm the root
Promotion text and d2-d1 arrow without future checking arrows. The generated
service uses controlled scores to verify wiring; separate searches judge chess.

All 2,011 production-controller inputs pass: 808 public cases, 22 promotion
controls including the real recovery/reflection, and all 1,181 owner contexts.
Each owner result matches both source and its frozen final replay. Public
classification/transfer median/p95/max is 43/203/1,098 ms, excluding engine and
native UI. Clean desktop delivery is recorded separately after completion.
Worker `liveTactics.worker-YO-E50T4.js` is 590,353 bytes, SHA-256
`5eb435402967018b73466c0ff19169fae240dc21d3439f7e1e0d36ded5d34a40`.
These checks do not resolve native interaction or load-sensitive startup.

## Private receipts

Under `Documents/OnCrescent Tactical Benchmarks/`, the `promotion-check-`
receipts dated `20260917` include `probes146-retained`,
`probes146-new-decisions`, `engine146-draft`, `engine146-new-decisions`,
`missed-engine146`, `owner146-final`, `private146-final`, `rare146-final`,
`tests146-final`, `public-worker146-final` and `owner-worker146-final`. The draft and intermediate
`probes146-safe` strategy are not the final proof. Paid course/game identities
and full owner replay reports stay outside Git.

Broader recall, quiet preparation, the queen-ending promotion and stronger
mating cause remain open. No owner app, data or phone service is restarted by
these tests; native packaging is a separate delivery step.
