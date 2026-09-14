# Secondary mechanisms and primary relevance — adapter 92 / live 97

## Scope and selection

This is a development audit, not an all-position accuracy result. Eighteen previously unseen CC0 Lichess puzzles, sampled from real games, cover interference, defensive moves, zugzwang, x-ray attacks, trapped pieces and advanced pawns (three each). They supplement the earlier opening, ordinary-game, positional-course and exact-endgame audits. Existing negative controls and prior judgements remain in the regression selection.

`secondary-theme-development.json` freezes source SHA, seed, exclusions, source games and continuations. Selection used only development rows and source identities, before chess judgement, classifier output or engine analysis. The seed was `secondary-theme-broad-2026-09-14`; source SHA is `c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88`. Source games are disjoint from prior public samples and from each other. No holdout rows were classified. This stratified puzzle sample is not representative of the frequency of tactics in ordinary play.

`secondary-theme-initial-judgement.json` retains provisional human hypotheses. The sampler can reproduce the exact selection using the frozen fixture as its third argument (exclusion lists); a fresh reproduction matched byte-equivalent parsed content. Without that argument, it excludes the current public archive for a new sample. Never select rows by classifier success.

`secondary-theme-stockfish-18.json` retains the initial adapter-91 outputs plus eighteen fresh depth-16, MultiPV-3 root searches and 33 further decision/control searches. All eighteen published first moves were already present in their root search. `secondary-theme-adapter92-review.json` replays those exact source/engine inputs. Scores are side-to-move full-position estimates, not local material certificates or exact tablebase outcomes. The public receipt contains only the allow-listed CC0 sample and constructed probes; paid course material remains outside Git.

## Reviewed judgements

| Puzzle | Chess judgement after engine review | Classifier result / limitation |
| --- | --- | --- |
| DBBd9 | b5 cuts the queen's guard of Nd7; Qg4 requires a second cut with f5. | f5 is verified at ply 3. The root preparation remains unproved; do not call the knight already free. |
| qQG5v | Qg8+ forces mate. At Kg5 the king blocks Qg4's defence of g7. | Mate remains primary; new Self-Interference appears only at defensive ply 4. |
| J3vOR | Be4 cuts Qc2–Nf5 and attacks both. Best defence Nxe7 also collects a rook before the queen falls. | Root interference remains unproved. The simple source Qd2 branch is not the whole story. |
| HuMdz | Rxc6 bxc6 opens a passed pawn; Bc7 then blocks the rook's access and supports promotion. | Winning preparation remains unproved; accepting the exchange offer is not assumed forced. |
| nkeLA | Kf3 produces an engine-supported mutual zugzwang: White-to-move loses, Black-to-move loses in the pass probe. | No exact larger-ending proof yet. Empty output is a coverage gap, not a correct negative. |
| R13Ct | Kxf7 wins the unsupported knight despite Qh5+. Compensating captures matter. | Hanging Piece stays primary, with 220 local cp after supplied previous-move context, not a free 320 cp gain. |
| BvWlf | Kc4 wins with the opponent to move; the pass probe is drawn. | Engine-supported winning zugzwang, outside the exact KPK classifier's scope. |
| vMQ3b | d4 improves the pawn ending; White also wins in the pass probe. | Root zugzwang would be wrong. The exchange/ending preparation remains unexplained. |
| pV2Bd | Kc5 wins with either side to move at this point. Reserve tempi may create zugzwang later. | Do not assign zugzwang to the root from the source tag. Broader plan remains unexplained. |
| sKDBG | Qa1+ forces mate; accepting with Rxa1 opens Ra8's ray. Other interpositions mate immediately. | Mate remains primary. X-Ray Support moves from a spurious final-capture badge to the actual initiating move, explicitly conditional on acceptance. |
| xxDaj | Qxc2+ exploits Rc8 behind Qc7. Qxc2 Rxc2 preserves the rook gain; all six root defences remain winning or mating in fresh searches. | Independently verified X-Ray Support leads; duplicate loose-rook wording is removed. Local bound 500 cp, versus about +360 cp full-position root estimate. |
| SD5oo | Qxe1+ Rxe1 Rxe1# is a forced back-rank mate. An unrelated available Rxe2 does not make this an intermediate-capture lesson. | Forcing Mate replaces Intermediate Check. X-Ray Support is secondary at ply 1; Back Rank Mate belongs to the actual mating ply 3. |
| qn2Fy | Kf2 attacks the trapped rook. Its best response Rxe4 collects a knight, so compensation must be deducted. | Root trap remains unproved. Not counted as a successful abstention. |
| j8Up4 | Bd4+ prepares Be3 to trap Qh6. The queen can collect pawns while being lost. | Live continuation verifies the trap at ply 3; root preparation remains missing. Source-only shorter continuation stays empty. |
| S9vEb | Ra8 traps Qa5; Qxa8+ Qxa8 bxc5 is the best engine defence. | Trapped Queen remains primary with compensation included, not a free queen. |
| i2SLh | a5 wins a pawn race, but both sides queen. After ...d1=Q, Qxc6 preserves a favourable queen ending. | Root race remains unproved. Queening first alone is not its proof. |
| oSj8l | b8=N+ forks king and queen. Queen/rook/bishop promotions all permit forced mate in one or two. | Fork remains primary; Under-Promotion remains secondary. Fresh engine validation supports necessity in this example; generic UI wording does not claim it universally. |
| c6L21 | Rc6+ offers a rook with check to enable b8=Q. | Promotion remains at its actual ply; all-defence root deflection/preparation is still missing. |

The final live sample has seven immediate primary explanations, two continuation-only explanations and nine empty primary results. These are coverage counts, **not** seven correct answers, nine correct negatives or an accuracy percentage. Four source/live explanations change; the other fourteen full results stay unchanged. Only SD5oo changes primary ID.

## General fixes and contrary controls

- The intermediate-capture proof no longer treats an all-mating result's `10000` sentinel as extra material from a deferred capture. Its material claim requires an actual material bound. Independent mate certificates retain ownership of mating headlines. Existing genuine material move-order tests remain passing.
- X-ray admission no longer borrows a profitable/mating PV or a legacy tag. The sole intervening enemy piece must legally capture the offered piece and vacate an allied slider's legal recapture ray. Material roots debit all friendly liabilities, require a positive gain and a worsened local exchange without that slider, and reject immediate terminal refutations. Mating support requires separately proved root and accepted-branch mates. It stays secondary, with no invented material value, and cannot displace the mate headline.
- Mating self-interference requires the exact same legal capture before/after the actual block. The old guard must legally recapture before it; afterwards the capture must be actual checkmate. This includes pawn targets and never promotes a defender's concession into their own offensive root tactic. The turn swap tests protection only.
- Root board arrows use the real slider, blocker and exchange square. Future self-interference is not painted on the starting board. The existing compact supporting-label layout is reused.

Contrary controls remove the old guard, open a king flight, add a second recapturing rook, remove the x-ray slider/receiver, insert an extra blocker, and expose an off-square rook. Removing the old queen in qQG5v leaves mate but removes the interference explanation. Without Ne7, Qxg7+ allows Kf5; an added Rg8 recaptures. The off-square-liability construction is even worse than the initial Bxc8 hypothesis: fresh Stockfish finds Rd8+ Rxd8 Qxd8#, and the new certificate abstains. The first attempted Bxc8 construction was invalid because an e6 pawn blocked the bishop; it was corrected before the completed engine audit. Reflected boards preserve the selected primary and actual-ply relationships. Invalid/partial budgets cannot borrow cached success.

Geometry/material checks use a 4,096-operation budget; each existing short-mate verifier keeps its separate bound of at most 4,096 visits. Mating self-interference uses 512 geometry/capture checks. No worker deadlines or other proof budgets were increased. These remain bounded local proofs, not complete full-game tactical engines; longer x-ray combinations may abstain.

## Regression and delivery evidence

Verification: 1,657 selected source/review/render tests pass (92 conditional skips; 110 files, 108 passing). This includes 27 new source/decision tests and two rendered panel tests. All 797 actual-controller production-worker inputs pass across fourteen tests. The [292-input public receipt](built-worker-adapter92.json) has median/p95/max 74/201/618 ms, startup max 34 ms and computation/transfer max 589 ms. The common 219-input subset is 81/211/618 ms; the lower aggregate median is not a speed-improvement claim. These timings exclude engine search and native UI.

Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, ten-file targeted lint, three review-service tests and two development-cache/recovery scenarios pass. Final artifact: `liveTactics.worker-DbQJ1XS4.js`. Ten isolated cold HTTP cases pass with unchanged startup/computation limits. First/next startup is 1,297/64 ms; KPK startup reaches 2,014 ms. The new mate/x-ray case is 56 ms startup plus 48 ms computation/transfer; self-interference is 55/40 ms. This is not stable-startup, installed WebView, native interaction or physical-device proof. No owner app, package or service was restarted or deployed.

The exact private replay changes one of 246 course/generated-game source/live results: an old final-capture x-ray badge is removed from the continuation and its candidate board labels, while its primary checking attack and later deflection remain. Its longer root x-ray support is still outside the new short proof. All 246 primary headline lists, the other 245 full results, twenty earlier rare results, 32 frozen priorities and 219 previous public worker primary lists are unchanged. Stability is not certified accuracy. Authoritative private receipts are `adapter92-final-exact-replay.json`, `rare-theme-adapter92-final.json` and `adapter92-cold-http-worker.json` in the owner's private tactical benchmark directory; earlier candidate receipts are retained, not substituted for the final ones.

Known follow-ups include two-stage interference, exchange-compensated and prepared traps, promotion/rook-deflection preparations, larger/drawing pawn endings, longer x-ray support, causal mistake comparisons beyond currently proved mechanisms, and native runtime/UI verification.
