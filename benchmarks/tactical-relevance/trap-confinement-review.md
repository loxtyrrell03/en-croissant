# Escape-square confinement: Xg7Rd

This public development case now has a complete **local** trap certificate. It is not a held-out accuracy estimate, a forced game win, or proof against every longer quiet/checking continuation.

The frozen source is `lichess:Xg7Rd` in `rare-causal-cohort-v2-inputs.json` (game `lMO0jlIT`). From `r3kb1r/2B2ppp/p4n2/n7/6b1/2P1P3/PP1N1PpP/R3KB1R w KQkq - 0 13`, **Bxg2** removes the advanced pawn and closes Na5's previously safe b7/c6 flights. Bc7 remains the knight's attacker. The move is not itself a bishop attack on a5.

## Independent adjudication

`trap-confinement-verify.py` independently enumerates all 34 legal replies, in both colours, using python-chess rather than classifier output or engine scores. The retained output is `trap-confinement-independent.json`.

- 31 replies permit a capture of the same knight, including its four legal flights.
- **...Bf3 / ...Bh3** attack the new flight guard Bg2. **Bxf3 / Bxh3** instead collect the actual counterattacking bishop.
- **...Bb4** guards Na5; **cxb4** collects that actual defender.
- The minimum local total is **320 centipawns, including the initial 100-point pawn**. After ...Rb8 or ...Ba3, capturing Na5 must also debit a pawn lost elsewhere. It is not a free knight plus the original pawn.
- Removing Nd2 permits the legal, unattacked **...Nc4** escape in both colours. Before Bxg2, Nb7/Nc6 also evade immediate captures.

The finite leaf check covers legal same-square exchange minimax, the largest immediate off-square capture liability, terminal draws, immediate mate and promotion. Longer counterplay and unprovided repetition history remain outside this local certificate. The dangerous pawn's removal does not alone justify an additional defensive/promotion-prevention badge.

## General repair and boundaries

Previously, trap nomination considered only victims attacked by the moving piece. It could not nominate a move that completes another piece's trap by newly guarding escape squares. Even an explicitly nominated Na5 failed at **...Bf3: Not a causal defender**, because the trap proof handled actual countercaptures but not a quiet counterattack on a participating guard.

The new nomination requires an unchanged, profitable allied attack and at least one actual before/after safe-flight witness newly caught by the mover. The original all-defence proof must then close every reply. In this confinement mode only, a quiet defence can be answered by capturing its actual moved counterattacker when that piece profitably attacks a participating capturer or the new flight guard. Arbitrary loose pieces cannot finance the trap. Ordinary direct-attack traps keep their previous witness selection.

Existing 256 top-level / 8 pin-nomination / shared 4,096 recovery limits are unchanged. Nomination witnesses have a private 256-entry cache keyed by complete before-FEN, root move and target; records and arrays are frozen and do not escape. Board evidence shows **Bc7→a5 and Bg2→b7/c6**, not an invented Bg2→a5 attack.

## Verification

The same 16 behavioural assertions improved from **8 passed / 8 failed** to **16 passed**. The eight unchanged negatives cover missing Nd2, a trap already present before the nominated move, an unrelated queen liability, a missing attacker and exhausted budgets, across both colours. One unused test-constant export was removed afterwards solely to satisfy lint; the assertions and inputs did not change.

The final focused run covers 12 files: **219 passed, 3 optional skips, zero failures**. It includes existing direct traps, defender-removal traps, discovery priority, 76 active primary-lesson tests, live tactics, ordinary motifs and material/draw-claim regressions. Whole-project types and scoped lint pass (zero warnings/errors). Exact source/report hashes and timing observations are in `trap-confinement-verification.json`.

A 60-input cold / repeated-warm timing probe used only tiny public or constructed positions. Xg7Rd root averaged 36.5 ms cold (92.3 ms maximum) and 9.9 ms warm; its three-ply line averaged 41.7 / 15.9 ms. Quiet Nf3 averaged 1.6 ms cold. These are local measurements, not hard latency guarantees or a population benchmark.

Re-run the permanent contract with `node node_modules/vitest/vitest.mjs run src/utils/tests/trapConfinement.test.ts`, and the independent checker with `python benchmarks/tactical-relevance/trap-confinement-verify.py` using the existing python-chess environment. No engine/download/full corpus is needed.

This checkpoint preserves the pending checking-ray patch and unrelated work. Root integration owns versioning, exact committed-core verification and generated-service checks. No owner stores, services, native app, website or delivery runtime were changed by this work.
