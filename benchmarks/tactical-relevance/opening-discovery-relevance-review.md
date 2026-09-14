# Opening, positional and checking-discovery audit

## Adapter 91 / live pipeline 96

This milestone recovers a genuine missed **Discovered Check** explanation while preserving the surrounding quiet-position results. It does not declare that every empty position is correctly classified or that the classifier is accurate across all chess positions.

### Output-blind material and chess judgement

The fresh public sample uses reached plies 2, 4, 6, 10, 11 and 12 from each of the three complete games already frozen in [ordinary-games-development.json](ordinary-games-development.json). All eighteen roots are disjoint from the earlier original/adjacent samples. The [initial judgements](ordinary-early-initial-judgement.json) were written before engine/classifier output. The [fresh depth-16 engine audit](ordinary-early-stockfish-18.json) retains the pre-change classifications; the [adapter-91 replay](ordinary-early-adapter91-review.json) is separate. Three games from one account are a small development sample, not representative accuracy evidence.

The sample distinguishes actual tactical losses from these non-tactical explanations:

- Central development and space against a restrained opening setup.
- Attacking a knight that can simply retreat, rather than a trapped piece.
- A bishop's geometric pin that creates pressure but no verified material win.
- Recovering exchanged/gambited pawns, rather than winning newly hanging pawns.
- A defended bishop: capturing it with the queen hangs that queen. The subsequent pawn recapture remains the primary lesson and deducts the captured bishop, for a 570 cp local net exchange rather than a whole-queen claim.

My preliminary judgement on ordinary-3:ply10 also needed refinement: the queen need not move immediately. The engine's e4 blocks the bishop's attack and gains a tempo. That is a concrete positional response, not a reason to invent a winning fork. Sixteen early rows retain empty root and timeline output; those results agree with the stated development/recapture judgements, not with a blanket rule that openings contain no tactics.

A second output-blind sample contains **21 new positional-course roots**, one per chapter by SHA-256 ordering with the fixed seed `positional-broad-2026-09-14`. It excludes all 201 earlier course roots and 24 generated-game roots by board/turn/castling/en-passant identity. The source has 997 eligible records, 996 distinct boards and 891 unseen eligible boards; all 21 selected boards are distinct. Combined source SHA-256: `3dda987bc17e2d64c1ca62ad2774d608cf4beb1c09bb827a978ff2a2907432f1`. Source comments and chapter headings are provenance, not expected labels. Paid inputs, judgements and receipts remain private.

All 21 new course source/live classifications remain empty. That is not twenty-one certified correct negatives. The initial review left six forcing/defensive/initiative positions uncertain. Follow-up engine checks retain an unexplained defensive pawn thrust that improves the position without a forced net material gain. They also correct the apparent poisoned-bishop assumption: accepting and declining the offer have similar evaluations, so acceptance is not established as a devastating tactical mistake. These distinctions remain documented rather than being converted into convenient passing labels.

### The recovered opening tactic

After `1.e4 e5 2.d4 exd4 3.c3 dxc3 4.Nxc3 Nf6 5.e5 Ng8 6.Qe2 f6?`, **exf6+** clears the e-file for the queen's discovered check. Qe7, Be7 and Ne7 concede material. Kf7 instead permits Qh5+ and a connected checking attack. The former proof stopped at Kf7 and returned no theme; the game's subsequent losing moves were not sufficient evidence.

The new certificate covers every legal root reply, without a supplied PV, engine evaluation or supplied motif. The opened battery and moved piece may collect material; another piece must join the forcing attack with check before supplying a material payoff. Up to five further checks share **8,192 operations**. All friendly pieces' immediate liabilities, legal recaptures, counterchecking resources, promotion refutations and claimable fifty-move draws remain part of the bounded verification. Unknown or exhausted work abstains.

The final root certificate uses 7,596 operations and retains a conservative 320 cp local material bound. It is not the full-position evaluation and need not choose the engine's strongest continuation. Shorter checking routes are searched first. Completed shorter proofs can be reused with a larger remaining check allowance, but a failed shallow search cannot prove a deeper result. Cache identity includes the board, turn, castling/en-passant state, halfmove clock, balance and active participants. Colour/file-stable ordering avoids spending a different budget merely because the board is reflected.

Initial experiments with a three-check horizon, depth-first search, and caches that did not reuse shorter completed proofs failed or exhausted their budgets. A large diagnostic search established coverage but was not adopted as the production budget. Final production uses 8,192 operations; existing proof budgets and worker deadlines are unchanged.

The primary label remains **Discovered Check**, not a grab bag of its subsequent checks. Board arrows show the queen's opened e-file, not a future bishop move or capture. Missed-opportunity review retains the initiating discovery; allowing ...f6 identifies the opponent's discovery as the tactical cause. Heterogeneous checking continuations cannot borrow the older single-material-target causal comparison. If the same reply remains legal and no independent comparison proves prevention, causation remains unclaimed.

### Independent checks and contrary controls

The fresh development work includes 22 course-root/source-move searches, 30 distinct before/after opening searches, eleven additional root/king-defence searches and a completed **27-search witness audit**. Its 21 selected proof decisions all retain a winning engine evaluation or positive mate score. The [public certificate and 23-search receipt](opening-discovery-stockfish-18.json) contains those decisions and two constructed controls, excluding all paid-course data. This supports the selected decisions; it is not an independent exhaustive engine proof of every leaf of the bounded certificate. Local 320 cp material and full-position scores remain separate.

The other six witness searches check two constructed refutations and four uncertain course choices. Adding a knight that can capture the checking queen refutes the discovery (Black's Nxe2 is +604 cp); leaving another pawn on the e-file prevents the discovered check (exf6 is -197 cp for White). Bare checking geometry, ordinary development, invalid/exhausted budgets and a fifty-move counterclaim also abstain. Colour/file reflections retain the genuine lesson.

An earlier six-search witness report stopped when a positive mate-in-five score did not satisfy a numeric-centipawn-only assertion. The partial report is retained; the complete audit separately evaluates centipawn and mate score types. It was an audit assertion mistake, not contrary chess evidence.

Private receipts under Documents/OnCrescent Tactical Benchmarks:

- `prepare-positional-hash-sample.mjs`, `woodpecker-positional-hash-21-blind.json`, `woodpecker-positional-hash-21-initial-judgement.json`, `woodpecker-positional-hash-adapter90-initial-audit.json`.
- `adapter91-opening-engine-initial.json`, `adapter91-king-hunt-engine.json`, `adapter91-opening-proof-verified.json`, `adapter91-final-witness-engine.json`; earlier candidate/partial reports remain alongside them.
- `adapter91-replay-inputs.json`, `adapter91-final-exact-replay.json`, `rare-theme-adapter91-final.json`, `adapter91-cold-http-worker.json`.

### Regression, runtime scope and remaining gaps

The selected source/review/render suite passes **1,628 tests**, with 92 conditional skips in 109 files (107 passing). Thirty-nine new opening/proof/review checks and one rendered panel check are included. Whole-project type checking, eight-file lint, shared-review (40 modules), app (8,870 modules), three generated-service tests and two development-cache/recovery scenarios pass.

All **246** exact course/generated-game source and live inputs remain unchanged, including the 21 new positional roots. Twenty rare-theme results, 32 frozen priorities and all 198 previous public worker primary-ID lists remain unchanged. Existing endgame, interference, zugzwang, trapped-piece, deflection and promotion coverage was rerun, not newly declared complete.

All **724 actual-controller production-worker inputs** pass fourteen tests against `liveTactics.worker-lOyUJpI0.js`. The [219-input public receipt](built-worker-adapter91.json) records elapsed median/p95/max **82/204/608 ms**, startup maximum 38 ms and computation/transfer maximum 578 ms, excluding engine/UI and additional private/rare inputs. The unchanged 198-input subset measures 85/221/608 ms. Different case mix means the lower aggregate p95 is not a speed-improvement claim. The recovered root-only discovery takes 101 ms computation/transfer; its full opening scan takes 157 ms.

Eight isolated HTTP cases pass. First/next startup is 1,383/70 ms; the new discovery starts in 57 ms and classifies/transfers in 145 ms. Another KPK startup in the same run takes 1,910 ms. These variable isolated-server timings are not native WebView reliability proof.

No owner app, package or service was restarted or deployed. Broader quiet/defensive mechanisms, larger-ending zugzwang, causal ranking and native UI verification remain open. This is a verified coverage improvement with retained negative controls, not an all-position correctness claim.
