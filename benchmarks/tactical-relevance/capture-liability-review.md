# Capture liabilities and relevant tactical payoffs

## Decision

Adapter 108 / live pipeline 113 stops treating a positive capture-square exchange
as sufficient evidence for a generic winning capture. Desktop nature remains 4;
the existing motif-version migration refreshes saved explanations.

The important distinctions are:

- A free piece remains **Hanging Piece**. A profitable but compensated capture is
  **Material Gain**, with the smaller local bound. Losing material elsewhere,
  unresolved counterchecks, stalemate and dead-material endings cannot certify
  an independent gain.
- An earlier independently proved fork, pin, skewer, discovery or promotion
  clearance can still explain its actual capture. A dead-draw fork payoff, for
  example, remains visible without inventing another winning-material value.
  A compensated capture retains its **Fork Payoff** or **Discovery Payoff** role
  when it matches that mechanism, instead of producing an additional headline.
- Missing or incorrect move history no longer makes a capture that permits
  forced mate look like a free piece. Positive same-square comparisons in missed
  lessons also require independently positive local capture bounds on both moves.
  Failure of the alternative proof is not evidence that a tactic was prevented.

## Chess audit, including contrary evidence

The constructed rook-capture control gives up its checking queen elsewhere.
The old classifier called this a free rook; fresh Stockfish places the held
capture at roughly -7 pawns. Adding a bishop that recaptures the opponent's rook
changes the arithmetic: rook gained, queen lost, rook recovered is a **one-pawn**
local gain, not a free rook. The real capture-protecting discovery from adapter
107 still has its separate all-defence certificate and is not erased by the
generic leaf's failure.

One old knight-capture test was wrong: `exf6` permits `...Qxd1+`, trading a knight
for a rook. Another unrelated trap-control capture permits `Qxh8+`; the engine
confirms the lost rook matters. These expectations were corrected after analysis,
not converted into passing abstentions without checking the positions.

The quiet deflection audit exposed a separate bad witness. After `...Rxe5 Qxh4`,
the checking exchange `...Rxe1+ Qxe1 Qxd3` permits `Qe8+` followed by `Qxf7`.
Taking the exposed rook **directly** with `...Qxd3` preserves the advantage.
Its counterchecks are answered, and apparent off-square rook captures are excused
only when an independent short mate refutes that exact capture.

A knight-decline variant, also encountered in the private course, exposed a
longer counterexample: `...Rxe4?` wins a queen but allows a forced back-rank mate.
The proof now checks mating replies through four checking moves under its existing
shared budget, rejects that witness, and answers the moved knight with `...Qxf6`.
The certificate's minimum falls from 330 to **150 centipawns of local material**;
the full-position engine evaluation is a different quantity. All 34 original
public declines, 41 constructed knight-variant declines and 38 private declines
have fresh held-move engine checks. The root stays **Deflection**, not a phantom
queen win or a generic sacrifice.

The real interference case `zYjb5` retains **Forced Interference** as primary.
Its later rook capture now accounts for an off-square pawn loss: 400, not 500,
centipawns locally. Three other rare-theme continuations only replace raw UCI
coordinates with SAN in the capture explanation. No zugzwang rule was loosened.

## Evidence and limits

The final engine audit contains **154 searches**: 95 allowlisted public searches
in [the receipt](capture-liability-stockfish-18.json), 54 private decision/defence
searches, and five supplemental public interference/trap searches. Depth is 16;
held moves and unrestricted reply searches are distinguished. These are targeted
development audits, not 154 independent test positions or an accuracy estimate.
An interrupted exporter run containing duplicate probes is excluded, as are the
earlier exploratory receipts. The exporter now checks unique IDs.

The fixed 246-position private replay covers tactical courses, positional chapters
and game samples. Compared with adapter 107, ten positions change in at least one
source/live result; 17 of the 492 individual source/live results differ. All 246
source/live primary ID lists remain unchanged. One course deflection lowers its
bound, and a sampled endgame bishop capture becomes compensated Material Gain
(230 instead of 330). One later capture loses its standalone certificate despite
a winning engine evaluation: that remains a bounded continuation-coverage gap,
not a verified negative. The other 236 complete position results are unchanged.
Twenty rare-theme primary IDs and the 32 frozen causal priorities remain unchanged.
Stable outputs are not certified accurate.

The generic leaf is still local: all friendly-piece exchange liabilities, a
material-retaining answer to each countercheck, immediate terminal/promotion
checks, and 4,096 operations. It does not solve every king hunt or quiet tactic.
Deflection's new mate-reply and moved-threat checks share the unchanged 8,192
budget. Unknown/exhausted searches abstain; deadlines are not extended.

Authoritative private receipts are in `Documents/OnCrescent Tactical Benchmarks`:
`adapter108-selected-verified.json`, `adapter108-rare-final.json`,
`capture-liability-private-stockfish-final.json`, and
`capture-liability-supplement-stockfish.json`. Paid FENs, lines and explanations
remain outside the repository.

## Verification and delivery

- 2,226 selected source/review/rendered tests pass; 92 optional tests skip.
  Both optional capture-audit exports were separately exercised.
- All 1,529 actual-controller production-worker inputs pass in twenty groups:
  1,021 public and 508 private inputs. Nine of the prior 1,003 public primary lists
  lose unsupported generic-capture headlines; the other 994 are unchanged. Eighteen
  new controls cover capture liabilities and deflection continuations. Public
  computation/transfer median/p95/max is **37/202/901 ms**, excluding engine and UI.
  See [the worker receipt](built-worker-adapter108.json).
- All 81 cold-HTTP cases pass. The final isolated run starts its first worker in
  1,238 ms and its slowest in 1,559 ms; server startup is separately 3,387 ms.
  An earlier concurrent-load run reached 19,349 ms of worker startup, close to the
  unchanged 20-second deadline. This is not evidence that native startup is fixed.
- Thirty actual React/Chrome groups pass at 1100/760/360 pixels and 100/200% text:
  eighteen live-result/browser-worker groups exercise Material Gain, a rejected
  capture, keyboard board preview and the deflection payoff; twelve review groups
  retain the missed-discovery and saved-card migration path. Narrow screenshots
  were inspected. Four service and two development-cache tests also pass.
- Whole-project TypeScript, scoped lint, the 42-module shared-review bundle and
  8,875-module application build pass. Existing build size/plugin warnings remain.
- No owner app/package/service is restarted, installed or deployed. Browser and
  Node-worker evidence does not certify a physical phone or native WebView.

Final worker: `liveTactics.worker-WDiECg41.js`, SHA-256
`f1953f25fede7c89c568c744861b86a1f93ead796cfc998bcbf021657a30fabd`.
Worker receipts use `adapter108-worker-*-verified.json`; the isolated cold receipt
is `adapter108-dev-cold-verified.json` in the private evidence directory. Earlier
`*-final.json` runtime files precede a minor wording polish and are not the final
artifact's byte-level receipt. Proof logic is unchanged by that polish.

Remaining work includes broader quiet/rare-theme recall, longer causal comparisons,
continuation-specific recovery where the generic leaf abstains, and native runtime
verification. This milestone is a concrete accuracy improvement, not completion of
the overall classifier goal or a claim that every primary theme is now correct.
