# Fixed public game-context relevance checks

Eighteen positions were selected at fixed plies 8, 21, 40, 59, 80 and 99 from the four previously selected rare-causal puzzle games. Six unavailable plies are recorded, not replaced. These are new positions from already-used games, **not an independent holdout or a population accuracy estimate**.

`rare-game-context-v1.json` retains the exact selection, full small legal game histories without player headers/comments/clocks, output-blind board hypotheses, and bounded fresh Stockfish corroboration. All 36 root/after-played queries used a private one-thread engine, at most depth 18 / 750,000 nodes / three seconds and three alternatives. Actual depths and lines are retained; an engine score or short principal variation is not a proof of a theme.

`rare-game-context-adapter169.json` is the immutable first classifier observation. The best line in all 18 contexts had no selected root motif; among the 54 root alternatives there was one explicitly answerable mate threat. That is an observation, **not 18 correct negatives**. For example, the saving checking activity in `lwOOWkJP:ply59`, quiet preparation in `ugpVWplb:ply21` and exact ending in `I1scDAqN:ply99` remain unadjudicated for recall.

The permanent `rareGameContextRelevance.test.ts` tests only narrow, reviewable distinctions in both colours:

- Ordinary opening development is not a forcing tactical theme.
- Recovering exchanged material is not an independent loose-piece win.
- An existing trapped-bishop danger that also follows the best recapture is labelled as persisting, not blamed on the move.
- An answerable mate threat is useful context, not a proved reason the move was worse.
- Attacking one knight with a pawn is not a fork or a proven trap.

All source games, sampled boards and returned engine variations are legally replayed by the suite. Broadening these negative assertions requires independent outcome evidence; do not turn every empty classifier output into new gold labels or suppress a newly proved tactic merely to preserve this snapshot.
