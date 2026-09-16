# A meaningful capture below the one-pawn cutoff

Adapter **116** / live pipeline **121** continues the same frozen three-game,
217-position owner audit. This is recall and causal-comparison work, not a new
sample or an overall accuracy estimate. Private games and detailed engine
receipts remain outside Git under `Documents/OnCrescent Tactical Benchmarks/`.

## Chess findings

The repeated ...Nxe5 opportunity takes a knight while a bishop is attacked.
If the opponent takes that bishop, a knight can recapture the pawn. The bounded
net material gain is 90 cp: one pawn less the model's 10-cp bishop/knight
difference. The old 100-cp admission cutoff suppressed it entirely. It should
say **Material Gain**, not that an uncompensated free knight is won.

Fresh depth-16 held searches support the first ...Nxe5 at +186 cp for Black
versus -138 for retreating the bishop. In the later reached position it scores
+125 cp and was actually played. The selected recaptures after the opponent
takes the bishop score +88 and +116 cp. These whole-position estimates are
not the local 90-cp bound. Nxe5 occurs on two reached boards of the same idea;
four changed source/live/review rows are not four independent discoveries.

The replay also exposed a false persistence comparison. In the better line,
Nxc6 Qxc6 trades knights: the recapture cannot be treated as the same net loss
as overlooking ...Nxe5. The comparison now credits material captured or gained
through promotion by each initial choice before comparing the opponent's
reply proofs. It still cannot infer prevention from a failed or smaller bound.
The actual g4 choice now retains the supported allowed-capture explanation;
the earlier f3 choice keeps its larger missed bishop capture primary, with
the smaller opponent gain secondary. Actually playing Nxe5 has no missed label.

## General changes and limits

- Direct generic capture admission and immediate-lesson selection retain a
  high-confidence 90-cp compensated gain. Bare 10-cp minor-piece exchanges and
  lesser gains remain excluded. Pawn-history admission is unchanged.
- Countercapture and mating-compensation filters compare against the admitted
  capture threshold, not a contradictory hardcoded pawn. Existing public
  helper defaults remain 100 cp; threshold-sensitive caches include the bound.
- Capture legality, all-piece immediate liabilities, countercheck handling,
  proof operation limits and runtime deadlines are unchanged. This is still
  bounded local analysis, not exhaustive whole-game safety.
- A later generic sub-pawn capture does not acquire a timeline badge merely
  because it occurs in the PV. Independently connected payoff observations
  remain, and the reached board can show the capture when analysed directly.

The initial broader timeline added an incidental late course knight capture;
that draft was rejected. All 246 prior private course/generated-game full
results and twenty rare-theme full results are unchanged in the final replay,
apart from versions. Unchanged or empty results are not certified correct.

## Verification and contrary controls

Nineteen fresh engine searches cover the two real roots, held choices,
compensating recaptures, preceding exchange decision and constructed controls.
Removing a recapturing knight invalidates the local gain certificate while the
constructed position still evaluates winning; it is not called a refutation
of every tactic or of the whole position. Adding a separate rook liability
also prevents the material headline. A constructed inferior choice allows a
different mating queen capture: the local knight-capture control is not a
claim that it is the strongest reply. Renderer nomination scores are synthetic
and explicitly separate from the engine evidence.

- 2,341 selected tests pass with 161 optional skips across 150 files; 36 final
  focused checks additionally cover the owner moves and the late-capture
  relevance control. TypeScript and scoped lint pass.
- Eighteen real React/Chrome groups check live labels, keyboard board preview,
  review explanation, saved-card migration and layout at 1100/760/360px and
  100/200% text. Narrow enlarged screenshots were inspected.
- Frontend and shared-service builds pass. Ten built-service checks include
  actual Stockfish plus compensated-card persistence; two development-worker
  cache/recovery checks pass. No native API/schema change was needed.
- All 105 forced-cold HTTP cases pass. First/max startup is 1,268/2,017 ms;
  maximum computation/transfer is 1,364 ms. This overlapped compiled testing
  and does not resolve earlier 19.7-second startup variability.
- All 217 compiled owner scans exactly match the final source replay.
- Fourteen enabled production-controller groups pass, with thirteen optional
  groups skipped. All 1,043 earlier public primary lists are unchanged; this
  checks regression stability, not correctness. Public computation/transfer
  median/p95/max is 38/202/886 ms. Owner source/live/review computation has
  median/p95/max 121/483/1,062 ms; both exclude engine and rendered UI time.
- Tested worker: `liveTactics.worker-DJBk11YE.js`, SHA-256
  `be1ffcea2ae93523cc8fe1fc45dce1b8aba075177e4a081955a08327d026c247`.

Final receipts: `chesscom-recall-adapter116-final.json`,
`adapter116-{tests,private,rare}-final.json`,
`adapter116-dev-cold-final.json`, `adapter116-worker-*-final.json`, and
`compensated-capture-{engine,comparison-engine}-20260916.json`.
Earlier initial/reviewed draft reports remain as contrary evidence.

Older loose-pawn opportunities, quiet/longer combinations, representative
independent accuracy, alternate practice answers and native responsiveness
remain open. This milestone does not deploy a phone service or modify owner
data. Desktop package delivery is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`.
