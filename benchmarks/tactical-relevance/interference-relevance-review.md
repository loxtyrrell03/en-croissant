# Restored interference and first-move relevance — adapter 94 / live 99

## Scope and evidence

This is a focused follow-up to the [output-blind eighteen-position secondary-theme audit](secondary-theme-relevance-review.md), not a new representative sample or holdout evaluation. Existing opening, ordinary-game, positional-course, tactical and endgame regressions remain in the verification set. Source motifs and Stockfish continuations nominate candidates; the classifier must independently cover legal defences before accepting the root mechanism.

The [public engine receipt](interference-relevance-stockfish-18.json) retains **268 completed depth-16 searches**: 82 initial unrestricted root-defence searches, 167 selected-witness/root searches and 19 final control, missed-move and compensated-bound searches. These are not 268 independent puzzles. The exporter validates known CC0/constructed roots, every root-reply identity, the reached recovery states, exact regenerated requests and complete legal PVs before removing private report fields. No paid course content is published. Full-position engine estimates are side-to-move values, distinct from the classifier's local material bounds.

## Reviewed chess decisions

### Be4 cuts a defence even when White adds another defender

In Lichess **J3vOR**, **Be4** cuts Qc2's defence of Nf5 and attacks the queen. An immediate-capture-only proof missed **Bd3**, which both blocks the queen attack and reinforces White's defence. Black can answer **Bxd3**: the restored defence is removed, with the remaining material verified against every reply. The initial candidate Nxd3 is also winning but is not the selected strongest recovery.

The independent proof covers all **43 root replies** and all **40 replies after Bxd3**, using **659 of 4,096 shared operations**. Its minimum local bound is **150 cp**. The limiting line Be4 Bd3 Bxd3 Rxe7 Rxe7 includes the subsequent knight/queen exchange in its settled value; it is not a free bishop plus a free rook. All 83 selected continuation witnesses and the root were separately searched. The root estimate is **+389 cp for Black**, versus **-28 cp** for the legal missed move Re5. The complete 84-search group has no estimate below +389 cp; this is finite engine corroboration, not a proof of optimal play at arbitrary depth.

The previously empty root now leads with **Interference at ply 1**, including missed-opportunity review. Root-only, source and alternative continuations agree. The starting board explains Be4 and the cut queen–knight connection; it does not display a future Bxd3 arrow or call the source line's later Bxf5 the original cause.

### b5 is the first of two cuts, not a label borrowed from f5

In Lichess **DBBd9**, **b5** cuts Qa4's defence of Nd7 and attacks the queen. **Qg4** restores the same connection, but **f5** cuts it again while attacking the queen. This connected mechanism must survive every response, not merely the supplied Qg3 continuation.

All **39 root replies** and **43 replies after f5** are covered in **980 of 4,096 shared operations**. The minimum local bound is **220 cp**, including pawn compensation after the eventual knight capture. The 82 selected continuation witnesses plus the root give a minimum full-position Black estimate of **+310 cp**; the root is +325 cp, versus -263 cp for the legal missed move Qe8.

The primary Interference now belongs to **b5 at ply 1**, instead of being borrowed from f5 at ply 3. The second cut remains a secondary theme on its actual ply, with its compensated bound reduced from 320 to 220 cp. The default board still has one label and no future f5 arrow. An unchanged theme ID alone would hide this relevance correction, so it is explicitly counted as a changed explanation.

### Do not overstate a rook gain by ignoring a pawn elsewhere

In the earlier real Lichess case **dkEzJ**, c3 still cuts Qd2's defence of Ra5. Its local bound falls from **500 to 400 cp**. For example, **c3 Ra7 Qxa7 Qxc3** allows a genuine pawn recovery. After Nb5, the same compensation can settle through queen exchanges. In contrast, the tempting proposed Qe3 Qxa5 Qxc3 control was invalid: the queen on a5 can recapture on c3. The final test uses the legally supported compensation, not that discarded line.

The direct material proof now debits liabilities of all friendly pieces. Fresh fixed searches give Black +129 cp at the root and +125/+79 cp for the two minimum-bound witnesses. Those full-position estimates are not 400 cp and are not asserted to be equal to the local rook-minus-pawn calculation. The primary theme is unchanged.

## Contrary controls and limits

Four constructed controls test actual missing resources: removing f7 prevents the second cut after Qg4; removing Black's queen removes the target attacker; adding a white rook permits Rxb8 counterplay; removing Nc5 makes Bd3 an effective defence to Be4. The claimed interference certificates are rejected. Their fixed root/defence searches support the counterplay, but a negative full-position score alone is not the reason to reject a theme.

A fifth constructed position tests an **unsafe material payoff**, not certified absence of a tactic. After e7+ Ke8, **Qxh7 allows Rb1#**. The first proposed king escape, Kc8, instead permits e8=Q#; the corrected Ke8 blocks immediate promotion but still allows a longer mate through Qc6+. Both contrary results are retained in the public receipt. The engine's stronger root defence is Rxe7: the root search evaluates -471 cp for White, while the separate fixed Rxe7 search gives +349 cp for Black. Those differing finite estimates do not change the conclusion that Ke8 is not a whole-attack refutation. The classifier's abstention here is not counted as a correct negative or an accuracy improvement.

The new verifier permits only one further cut of the same restored sliding defender, or capture of the actual newly moved guard whose removal improves a legal exchange on an original target. Every real defence, connected capture/retention continuation, all-friendly liability check and immediate terminal/promotion check shares the 4,096-operation budget. Arbitrary improving moves and unrelated loose pieces cannot fund the claim. Invalid or exhausted budgets return unknown. The existing promotion fallback also honors all-friendly liability checks; the existing 48ION promotion/interference regression is unchanged, not evidence of general promotion coverage. Worker deadlines are unchanged.

Root evidence is independent of the supplied future line. Missed lessons retain it, but an opponent continuation alone does not establish that the played move caused the mistake: unsupported comparisons remain neutral, without inventing prevention or severity claims. Tests cover legal replay, complete reply sets, root-only scans, colour/file reflections, partial budgets, compact board projection and rendered actual-ply explanations.

## Verification and delivery

- **1,714** selected source/review/render tests pass, with 94 conditional skips (112 files, 110 passing). This includes 27 new source tests and two rendered explanation tests. Conditional engine/export runs are separate.
- **815** actual-controller production-worker inputs pass across fourteen tests. The [310-input public receipt](built-worker-adapter94.json) measures median/p95/max **78/181/526 ms**, maximum startup 37 ms and maximum computation/transfer 497 ms, excluding engine search and native UI. The common 300 inputs measure 76/181/526 ms; no speedup claim. Only J3vOR's source/engine headline IDs change among the prior 300, while DBBd9's first-move ownership changes without changing its ID.
- Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, twelve-file targeted lint, three built-service tests and two development-cache/recovery scenarios pass. Artifact: `liveTactics.worker-Dn-6tjjs.js`.
- **Fifteen isolated cold HTTP cases** pass: first/next startup is **1,500/70 ms**, and the KPK case reaches 2,072 ms. The new DBBd9 and J3vOR cases measure 56/179 and 57/98 ms startup/computation; the unsafe-payoff control measures 59/128 ms. The previous milestone reached 9,820 ms startup. This is not a loading-delay fix, stable-latency claim or installed WebView verification.

All **246 exact private course/generated-game source/live results** are unchanged, ignoring version fields. Nineteen of twenty earlier rare full results are unchanged; only dkEzJ's compensated bound changes, with all twenty primary IDs retained. Sixteen of the eighteen secondary-sample full results are unchanged; the two interference explanations above change. All 32 frozen primary-priority judgements remain matched. Stability is not accuracy, and abstention is not a correct-negative certificate.

Authoritative private receipts are `adapter94-final-exact-replay.json`, `rare-theme-adapter94-final.json`, `adapter94-final-interference-witnesses.json`, `adapter94-interference-initial-engine.json`, `adapter94-interference-witness-engine.json`, `adapter94-interference-retained-controls-engine.json` and `adapter94-cold-http-worker.json` in the owner's private benchmark directory. Earlier candidate reports are retained as contrary evidence. The public eighteen-case classifications are in `secondary-theme-adapter94-review.json`.

No owner app/package/service was restarted or deployed. Paid inputs remain private. Prepared traps, broader promotion combinations, larger-ending zugzwang, longer positional counterplay, wider causal comparisons and native interaction verification remain open. This improves bounded interference and relevance; it does not establish that every position's primary theme is correct.
