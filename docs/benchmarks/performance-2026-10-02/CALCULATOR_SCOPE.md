# Performance figures and their mathematical meaning

Source audit, 2026-10-02. The active model work concerns the selected-game performance calculator in online Stats and its chronological comparison. The same model serves Novelty Home Stats, En Croissant desktop Account Stats and phone Stats (including the phone rating adapter).

`src/shared/truePerformance.ts` is a Bayesian result model with an explicit pre-game rating prior, three-outcome likelihood, opponent uncertainty and conditional posterior intervals. Its numerical and empirical validation requirements are in `RESEARCH_PROTOCOL.md`. The period estimate is not an official FIDE tournament-performance number.

The tournament tracker's `tournamentPlayerStats` has a separate descriptive figure. It averages rated opponents, inverts a binary logistic score curve, and clamps perfect/zero scores to 99%/1%. Current primary source excludes known forfeits and byes before this calculation; the older true-performance feature checkout predates parts of that exclusion work and must not overwrite it.

The initial audit considered replacing the tournament formula with opponent-specific expected-score matching. That is a different performance definition, not automatically a correction to every meaning of tournament performance. FIDE explicitly distinguishes average-opponent TPR from opponent-specific Perfect Tournament Performance, and uses its own conversion tables and endpoint conventions. [FIDE tie-break regulations, sections 10.2–10.3](https://handbook.fide.com/chapter/TieBreakRegulations032026)

For example, 1.5/2 against ratings 1000 and 2500 yields approximately 1941 under the current average/logistic convention and 2500 under opponent-specific logistic score matching. The discrepancy illustrates the difference in definitions; it does not, by itself, establish predictive superiority or conformity to FIDE tables. The current 1%/99% clamp is also a convention, not evidence for a finite unconstrained likelihood optimum at a perfect score.

Therefore preserve the tournament definition while improving the shared Bayesian calculator. If the tournament statistic is subsequently changed, declare its target explicitly: official TPR tables, official PTP tables, logistic score matching, or a regularized latent-performance estimate. Test its result exclusions and endpoint rules and label it accordingly. Do not silently replace a convention with a different estimand and call the difference an accuracy gain.
