# Counterplay relevance and mating-trap skewers

## What changed

Adapter 87 / live pipeline 92 separates a first-move explanation from a later tactical episode. A sequence of checks, evasions and captures can change initiative without ever producing two quiet plies. When an independently verified opposing mechanism starts with check outside a forced evasion, subsequent local gains no longer supply the original move's headline or board arrows. They remain collapsed at their actual plies. An ordinary check alone is insufficient, and independently certified root mates and promotion combinations retain their connected endings. The same selection runs in live scans and both missed/allowed mistake lessons.

The new generated-game sample exposed this directly: Qxb4+ is an ordinary bishop recapture, but a speculative Qd5 rook trap at ply 19 was being displayed as its main idea. Black's intervening Qc1+ prepares Qc2+, a checking fork. White's later trap is real on its reached board; it is not the recapture's tactical explanation. With trusted move history the initial scan now has no immediate headline or arrows. Without that history, the immediate bishop capture remains identifiable, but the remote trap is not appended as a root lesson. The UI distinguishes an unverified first move from conditional themes in its continuation.

Further engine review disproved a second tag in the same sequence. After Qc1+ Kf2, the apparent skewer payoff Qxh1 allows Ne7+ Kh7 Qf5+ g6 Qxf7#. Stockfish finds mate against Black in three, whereas Qc2+ holds equality. King-front skewer proofs now reject capture leaves permitting an independently verified three-checking-move mate. Both direct and checking-continuation certificates use their existing shared operation budgets; exhaustion abstains. This is not a general proof of king safety against quiet or longer attacks. Cache identities distinguish the mate horizons and safety option.

The actual counterattack keeps Fork Preparation primary and the later Fork at its own ply, without the false Skewer. A constructed control with the mating knight removed restores the skewer; fresh restricted searches score its check +349 cp and rook capture +386 cp for Black. These are full-position estimates, not the classifier's local material guarantee.

## Broader review and contrary findings

Before inspecting outputs, 21 unseen positional-course exercises were selected from fixed upper-quarter indices, one per chapter, excluding the existing 84 positional cases. Another 24 positions came from eight locally generated engine games at plies 12, 32 and 68. This deliberately includes openings, middlegames, exchanges and endings. Generated engine games are not a sample of human games; the prior real-game and Lichess rare-theme fixtures remain separate checks. Initial chess judgements, paid inputs and complete reports stay outside Git.

The 45 new cases received fresh depth-16 MultiPV analysis, plus seven restricted source-move searches. A further 23 targeted searches examined defensive concessions, the counterattack, its losing/safe payoffs and ending alternatives: 75 depth-16 searches in the completed audit. Eight depth-8 searches separately verify both castling notations for both colours. The benchmark had wrongly sent chessops king-to-rook castling to standard UCI; the affected partial run is retained, and the entire 24-position sample was rerun after fixing the wire translation without weakening restricted-root verification.

Independent review retained contrary findings:

- An initially underestimated en-passant discovery really forces mate in five; Forcing Mate correctly outranks the en-passant action.
- A bishop capture in a roughly equal ending is still an actual capture. A near-zero engine evaluation alone must not suppress a material motif; competing quiet moves and resulting counterplay remain relevant.
- One course defensive capture still has an over-simple material explanation: the opponent's mating threat forces a subsequent rook concession. That broader defensive-concession proof is unresolved, not counted as a correct result.
- A relative pin in another course continuation does not by itself establish a forcing first-move tactic. Its later checking fork remains conditional.

Exact replay covers 201 course cases plus 24 generated-game positions. The other 224 complete source/live results, all 20 rare-theme cases, and all 32 frozen mistake priorities are unchanged. Stable results are not certified correct; neither empty scans nor theme agreement are an accuracy metric. The changed generated-game result loses both the remote root trap and the actual-ply false skewer, preserving its safe checking-fork sequence.

## Verification and delivery

See the current section of [the course audit](private-course-review.md) for final test counts, worker timing and delivery status. Public regression inputs are in `src/utils/tests/fixtures/tacticalCounterplay.ts`; the private directory is `Documents/OnCrescent Tactical Benchmarks`. Relevant receipts are `adapter87-exact-replay-mate-guard.json`, `rare-theme-adapter87-mate-guard.json`, the three `counterplay*`/`skewer-control*` engine reports, and `defensive-capture-adapter87-engine.json`. Preserve the initial judgement and aborted castling-audit files when extending the sample.
