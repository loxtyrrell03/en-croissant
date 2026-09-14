# Traps, compensation and irrelevant payoffs — adapter 93 / live 98

## Scope

This is a focused follow-up to the [output-blind eighteen-position secondary-theme audit](secondary-theme-relevance-review.md), with the broad opening, ordinary-game, positional-course, tactical and endgame regressions retained. It is not a new representative sample or an all-position accuracy score. No holdout rows were classified. Source tags and engine PVs nominate ideas; neither is sufficient evidence for a theme.

The [engine receipt](trap-relevance-stockfish-18.json) retains 178 completed fresh depth-16 searches: 38 initial root-defence/guard-capture searches and 140 final selected-witness, unrestricted, root, missed-move and contrary-control searches. Some positions are intentionally searched twice with different root-move constraints. These are searches, not 178 independent puzzles. All FENs and complete PVs are legally replayed. The exporter checks known public roots, complete root-reply sets, reached witness positions and exact regenerated requests before stripping private report fields. No paid course material is published.

## Reviewed chess decisions

### Kf2 really traps the rook, including its defending bishop

In real-game Lichess **qn2Fy**, Kf2 attacks Re3. Rxe4 gives up the rook for a knight, so the lesson is a trapped rook with exchange compensation, not a free rook. The missing defence was **...Bg5**, which guards e3: Kxe3 is then illegal, and an isolated Nxg5 exchange appears insufficient. After **Nxg5**, however, ...hxg5 allows Kxe3, while moving the rook away allows a safe knight retreat retaining the bishop gain.

The new connected proof covers all 37 legal first replies and all 32 replies after Nxg5, without reading a supplied continuation. It uses 395 of the shared 4,096 recovery operations. The minimum local material bound is 180 cp (500 minus 320), not the full-position engine evaluation. All 69 selected root/recovery witnesses were separately searched; their minimum side-to-move estimate is +329 cp. The final root search gives +344 cp for Kf2, versus -289 cp for the legal missed move Rfe1.

The primary lesson is now **Trapped Rook** at ply 1, including in missed-opportunity review. Root-only and longer supplied lines agree. The board shows the king's attack on e3, not future Nxg5 arrows. The supporting explanation names ...Bg5 and Nxg5. It does not invent an additional root defender-removal badge.

### Account for compensation, including captures away from the victim

Three existing genuine traps retain their themes with lower local bounds:

| Case | Old → new local bound | Relevant compensation |
| --- | --- | --- |
| Public Qxb2 rook trap | 830 → 730 cp | The bishop and rook gains must also debit a pawn available to the opposing queen. |
| j8Up4, reached Be3 queen trap | 400 → 300 cp | Qxg6 takes a pawn; after ...fxg6, Kxh3 takes the rook. |
| S9vEb, Ra8 queen trap | 250 → 170 cp | Qxa8+ takes the rook; ...Qxa8 permits bxc5, whose exchange value includes ...Nxc5. |

Fresh fixed-witness engine searches give +393/+477/+481 cp for the first case's three minimum branches, +441 cp for the reached j8Up4 payoff and +351 cp for S9vEb. These full-position values are not asserted equal to the material bounds. j8Up4's root Bd4+ preparation remains unproved; its actual trap stays at ply 3.

### Do not erase a genuine trap because the first proposed payoff is wrong

An earlier generated-game continuation contains Qd5 attacking the boxed-in Ra8. Tightening liabilities initially removed this label after **...Qxb5**: Qxa8 lets Black collect more material with ...Qxb2. That initial withdrawal was wrong. **Qxb5** instead captures the counterattacking queen, independently evaluating +634 cp in its fixed search (+617 unrestricted).

The proof now permits recapturing the *actual counterattacking piece that just captured friendly material*. It does not use any arbitrary loose piece elsewhere. All 24 root defences are covered; the 170 cp local exchange bound survives, and the explanation names Qxb5 answering ...Qxb5. The original position's root headline remains empty; this later trap belongs to ply 19 only.

The unrestricted audit matters: Qd5 is approximately equal with best play. Several direct Qxa8 witnesses are inferior to first improving the bishop, or simply capturing an offered queen. After ...g6, Qxa8 evaluates -174 cp, whereas Bc4 is +209; after ...h5 and ...g5, Bc4 is also better. These results are retained, not called successful engine validation. The local material proof does **not** certify that every witness is the best move or wins the full position. It establishes a specific material opportunity; positional king safety and longer continuations remain limitations. There is no new claim that the original move caused a nineteen-ply-later tactic.

## Negative controls and bounded implementation

Removing Ne4 permits Re6. Removing d4 permits Rexd3 with the other rook guarding the file. Removing g2 permits Rxh3. Giving Black a b2 pawn permits promotion counterplay; the unrestricted search prefers underpromotion to a rook in that constructed position. Those claimed traps are rejected. Adding a loose white queen on c8 also defeats the net-gain claim through ...Rxc8, even though White's much larger starting advantage leaves the full position winning. Conversely, a separate loose queen cannot rescue a trap proof when the named rook can safely play Rd1. These controls distinguish theme validity from the sign of the overall evaluation.

Direct trap captures now debit immediate profitable captures of **all** friendly pieces, not just same-square exchanges. Material leaves reject stalemate and immediate mating/promotion refutations. Capturing a newly moved guard may use the existing bounded connected capture/retention/evasion verifier against every reply, restricted to that guard and the same victim. The pin-on-defender fallback also checks all friendly liabilities. Budget exhaustion remains unknown, not proof that no tactic exists. Default top-level 256 and pin-nomination eight limits are unchanged; the new settlement/recovery work shares 4,096 operations. Worker startup/computation deadlines are unchanged.

Tests include legal escape/countercapture controls, colour/file reflections, invalid and partial budgets, root-only scans, source/engine continuations, missed review, compact board projection, and rendered actual-ply explanations. Future motifs cannot become starting-board arrows. The independent root proof is retained; unsupported causal comparisons are not expanded.

## Verification and delivery

- **1,685** selected source/review/render tests pass, with 93 conditional skips (111 files, 109 passing). This includes 26 new source tests and two rendered explanation tests. Conditional engine/export tests are separate from these counts.
- **805** actual-controller production-worker inputs pass across fourteen tests. The [300-input public receipt](built-worker-adapter93.json) has median/p95/max **79/195/612 ms**, startup max 34 ms and computation/transfer max 586 ms, excluding engine search and native UI. The common 292 inputs measure 79/216/612 ms; no speed-improvement claim. Only qn2Fy's source/engine root headline IDs change among those prior 292 inputs.
- Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, twelve-file targeted lint, three built-service tests and two development-cache/recovery scenarios pass. Artifact: `liveTactics.worker-BqycAduF.js`.
- Twelve isolated cold HTTP cases pass. First/next startup is **8,374/81 ms**; KPK reaches **9,820 ms**. The new trap case is 58 ms startup plus 99 ms computation/transfer, and its escape control is 67/49 ms. Startup was substantially slower in this run; this is not a loading-delay fix, a stable-latency claim or installed WebView verification.

The exact private replay changes only one of 246 course/generated-game source/live results: the generated-game continuation now explains the countercapture in its later trap. All 246 root headline lists and the other 245 full results are unchanged. Twenty earlier rare results and 32 frozen priorities remain unchanged, not certified accurate. Three of the newer eighteen secondary-sample results change (the recovered trap and two corrected bounds); fifteen are unchanged. Authoritative private receipts are `adapter93-final-exact-replay.json`, `rare-theme-adapter93-final.json`, `adapter93-final-trap-witnesses.json`, `adapter93-trap-complete-engine.json` and `adapter93-cold-http-worker.json` in the owner's private benchmark directory. Earlier candidate withdrawals remain retained as contrary evidence, not final results.

No owner app/package/service was restarted or deployed. Paid data remains private. Multi-stage interference, prepared traps, promotion combinations, larger-ending zugzwang, longer positional counterplay, broader causal comparisons and native interaction verification remain open. This milestone improves bounded tactical explanations; it does not establish that the classifier always chooses the correct primary theme.
