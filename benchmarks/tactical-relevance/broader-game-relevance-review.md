# Quiet forks and broader game contexts — adapter 98 / live 103

## Selection and chess judgement

The new sample uses four further frozen Lichess source games at plies **6, 16, 30, 50, 70 and 90**. One game ends before ply 90, leaving **23 positions**; it is not replaced. The complete legal games, source hashes and selection are in [broader-game-context.json](broader-game-context.json). [Initial board-based judgements](broader-game-initial-judgement.json) were recorded before the fresh engine searches or classifier output.

These are contexts of puzzle-selected games, not a representative sample of all chess. All fixed root plies happen to be White-to-move. Every actual next move's resulting Black-to-move board is also analysed, without filtering for large mistakes; these 23 replies are paired observations, not 23 independent games.

The [public engine receipt](broader-game-stockfish-18.json) contains **106 fresh depth-16 Stockfish 18 searches**: 35 root/fixed-source-move searches, 23 after-move searches and 48 diagnostic fork/comparison/control searches. Every exported PV is legally replayed and matched to its requested position and fixed move. These are searches, not 106 independent puzzles. Scores are whole-position side-to-move estimates in centipawns; local proof gains use pawn = 100 and must not be equated with those scores.

My assessment of the sampled themes:

- Normal development, equal exchanges and an extra exchange already owned are not new tactics. The geometric bishop pins in two opening contexts do not force a material win. Their empty root scans remain appropriate on the examined lines.
- The bishop ending's restricted bishop is not demonstrably trapped: the position remains approximately drawn with normal king/pawn play. No Trapped Piece or Zugzwang label is justified by restriction alone.
- The knight recapture in the Dutch game and the bishop recapture in the London-style game are exchanges, not newly hanging pieces. The latter appeared as Hanging Piece in an intentionally contextless diagnostic; the actual previous-move-aware scan correctly suppresses that claim. No production recapture fix was needed.
- The defensive king move **Kc2** in game `h5yHhpzr` allows a real quiet fork. This is the recovered root lesson described below.
- The wing-gambit game's **g3** check evasion allows **...Rxf2+**, opening a checking rook attack after the g-pawn vacates. The scan still has no root explanation here. This is a concrete coverage lead, not a certified tactic-free result.
- The same game is already overwhelmingly lost before **g4** permits a five-move mate. Forcing Mate correctly leads the reached board; the later fork and checkmate remain on their actual plies. The review stays neutral about causation rather than claiming g4 first lost the game.
- The large evaluation loss from **b4** in an exchange-up middlegame has not been reduced to an independently proved tactical mechanism. The pawn ending's move-order/checking-capture resources also require further proof; neither is automatically a fork or zugzwang.

All 23 root/source classifications remain empty. That agrees with several specific quiet judgements but is **not** a claim of 23 correct negatives. The contextual after-move scans have the recovered fork and the pre-existing forced mate; the other 21 are unproved, not automatically correct.

## Why the quiet fork is the primary theme

After Kc2, **...Nf3** attacks **Re1, Pd4 and Ph4**. A simple piece-only detector sees just one substantial target and misses the tactic. Attacker/defender counts alone also miss the pinned defender and the rook's possible simultaneous defences.

I initially tried two-target explanations. Both were insufficient:

| White's defence | What it saves | Black's verified answer |
| --- | --- | --- |
| Rd1 | d4 and the rook | Nxh4 wins the other pawn. |
| Rh1 | h4 and the rook | Nxd4+ wins d4: c3 cannot recapture because Rc6 pins it to Kc2. |
| Re4 | Apparently both pawns | dxe4 takes the rook. |
| Rxe6+ | A checking counterattack | Rxe6 recaptures the original fork target with an ally. |

All three targets are necessary, not gratuitous arrows. The independent proof covers **all 27 legal replies**, tracking the named targets if they move and debiting immediate losses elsewhere. Its minimum local gain is **100**, one pawn. Fresh engine searches support all 27 selected capture witnesses (minimum whole-position estimate **+134 cp for Black**). The root searches return Nf3 at +189/+196 cp, not a claimed engine value of +100.

The board has one **Fork** label and five arrows: the knight move, its three targets and the supporting rook pin. It does not draw the future knight capture as though already played. The actual **Nxd4+** on ply 3 has **Pin** as a secondary continuation detail. Root-only, truncated, full and colour-reflected inputs retain the same first-move lesson.

**Kb2** instead of Kc2 unpins c3 and supplies a concrete answer to the same immediate fork-target captures. **Kc1** leaves that danger in place. The review therefore distinguishes enabling the fork from merely retaining existing danger. A separate Black alternative, **Rc7**, was initially considered as a missed-opportunity example; engine review showed it hangs Nd2 to Kxd2. The resulting lesson correctly leads with **Hanging Piece**, then retains the smaller **missed Fork** secondarily. It is not portrayed as a harmless move that merely misses a pawn.

## Boundaries and contrary controls

The new rule is for **non-capturing, non-checking piece-and-pawn forks**. It requires a non-king material target worth at least a minor piece, a pawn target and a complete named-target capture proof. Existing stronger fork proofs retain ownership. The rule tries sufficient pairs before a larger set, shares an 8,192 leaf/mate allowance among those attempts, and abstains on exhausted or uncertain proofs. This allowance is not a count of every nomination operation. Existing engine/worker deadlines and the separate promotion-combination allowance are unchanged.

Unpinning the pawn, removing the pinner, adding a second pawn guard or allowing the knight to be captured defeats the new certificate. Full-position scores may nevertheless remain positive, so these are controls of this particular claim, not blanket no-tactic labels. A checking queen-sacrifice variant has a real intermediate-check recovery; it is outside this quiet/immediate-capture rule and remains a coverage limitation, not a losing-move success.

An early candidate also admitted king-and-pawn-only checks and wrongly replaced a frozen Skewer headline with Fork in both colours. That regression was fixed without changing the expected priority. Restricting the new branch to quiet moves also avoids repeating a discovered check's already-explained targets as another fork badge.

## Existing course and rare-theme coverage

The 246 exact private course/generated-game records retain all root/source results and all headline lists. One live result adds a real fork at **ply 5**, after the larger first-move combination. It stays in the collapsed continuation and does not replace the primary lesson or its board arrows. Its complete twenty-reply local proof is checked separately with **21 further fresh engine searches**: the reached root is +696 cp for the mover; eleven finite-score selected replies are at least +682 cp and nine mate. Those full-position values include the already-won material and do not establish the local one-pawn gain by themselves. Paid positions, PVs and proof branches are retained privately.

All twenty earlier rare-theme full results, 23 earlier cross-phase full results and 32 frozen primary-priority judgements are unchanged. This includes existing interference, self-interference, deflection, trapped-piece and exact drawing/winning KPK coverage. Stability is not a fresh accuracy certification or evidence that wider zugzwang/quiet-move coverage is complete.

## Verification and delivery

- **1,807 selected source/review/render tests** pass across 120 files (119 passing, one conditionally skipped; 84 conditional test skips). New checks cover all fork replies, necessary target subsets, counterchecks, simultaneous defence, an independently constructed off-square queen liability, colour reflection, draw/budget/cache boundaries, source truncation, contextual game scans, causal/missed priority and the actual result component.
- Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, fifteen-file lint, three built-service tests and two dev-cache/recovery scenarios pass. Artifact: `liveTactics.worker-C4OHQv2F.js`.
- **26 isolated cold HTTP cases** pass with the existing 20-second startup and three-second classification deadlines. New root/continuation cases use 888/437 ms startup and 60/96 ms classification/transfer. Another case's startup reaches 1,924 ms; promotion verification reaches 1,291 ms classification/transfer. Prior multi-second cold-start variability remains unresolved. This is HTTP/controller evidence, not native WebView or physical UI proof.
- **968 actual-controller production-worker inputs** pass across fifteen tests: 462 public inputs, 505 retained private inputs and the separate fresh promotion-continuation regression. The [public timing receipt](built-worker-adapter98.json) measures median/p95/max **70/231/837 ms**, excluding engine search and native UI. Maximum startup is 35 ms and classification/transfer 811 ms. All 386 previous public headline lists are unchanged; those common inputs measure 73/234/837 ms. The new root-only/full-line fork inputs take 79/102 ms total. These are host-specific observations, not a speedup or native-latency guarantee. The first run completed public input processing but failed an obsolete 386-input count assertion; after adding the 76 new cases to the count, the complete suite passed without changing the classifier or deadlines.

Private evidence includes `adapter98-broader-game-initial-engine.json`, `adapter98-broader-responses-engine.json`, `adapter98-mixed-fork-engine.json`, `adapter98-mixed-fork-supplement-engine.json`, `adapter98-private-mixed-fork-proofs.json`, `adapter98-private-mixed-fork-engine.json`, `adapter98-release-exact-replay.json`, `adapter98-broader-release-results.json`, `rare-theme-adapter98-release.json`, `cross-phase-adapter98-release.json` and the release worker/HTTP receipts. The earlier intermediate replay that added a duplicate checking-fork badge is retained, not presented as final.

No owner app/package/service was restarted, installed or deployed. Broader quiet attacks, positional-versus-tactical boundaries, causal comparisons, secondary mechanisms and larger endgames remain unfinished. This milestone does not guarantee the correct primary theme in every position.
