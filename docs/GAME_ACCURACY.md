# Game report accuracy

Native reports use the same numerical definition as Novelty: White-relative
centipawns capped at 1,000, the logistic winning-percentage curve with multiplier
0.00368208, exact move-accuracy constants and the one-point uncertainty allowance.
Game accuracy combines a population-volatility-weighted mean with a harmonic
mean whose reciprocal uses a floor of one. Weights include both players and
use windows of `clamp(floor(plies / 10), 2, 8)` positions. The thirteen retained
50-digit Decimal reference cases exercise every window boundary.

Ordinary games use the +15 cp starting prior. Custom FENs require their actual
saved starting evaluation and turn; absent scores stay unavailable. Full-game
accuracy requires all adjacent evaluations. Centipawn loss may describe only
available consecutive pairs and never bridges an unevaluated position. A
one-ply game has a score only for the player who moved. No moves means unavailable.

`gameAnalysisEvidence.ts` replays the legal main line and checks each saved FEN.
Checkmate, insufficient material, stalemate, the fifty-move clock and threefold
repetition override conflicting/missing engine evidence using that history.
Report calculation is read-only: saved PGNs, annotations and evaluations are
not rewritten. Later incomplete/invalid history does not become fabricated zero.
Finite-score judgements use uncapped winning percentages at 5/10/15-point loss
thresholds; mate transitions preserve the 700/999 cp exceptions. Analysis adds
no played-move annotation to the root and tolerates empty earlier engine results.

The pure numerical module is `src/utils/gameAccuracy.ts`; the native score API,
both native report views and generated move judgements share it. Existing
brilliant/sacrifice annotations remain a separate classification after basic
error checks. Formula compatibility does not imply equal results from engines
using different budgets.

The phone's EloGuard playing-strength model is separately calibrated, with its
own move exclusions, windows and coefficients. This milestone does not change
that model or relabel its aggregates as canonical report accuracy. A canonical
phone game report remains tracked in the parity gap ledger.

The specification and provenance were established in Novelty's
`docs/GAME_ACCURACY.md` using immutable primary references:

- [Lichess accuracy definition](https://github.com/lichess-org/lila/blob/27ffc8b5f296d180e7a648d6bfdad27eef3f86a2/modules/analyse/src/main/AccuracyPercent.scala)
- [Judgement rules](https://github.com/lichess-org/lila/blob/27ffc8b5f296d180e7a648d6bfdad27eef3f86a2/modules/tree/src/main/Advice.scala)

Verification on 2026-10-24: 45 focused numerical, report, tree-annotation,
account and actual Mantine component checks, full TypeScript, scoped lint and
frontend build. The standalone desktop artifact was subsequently rebuilt from
clean source `cc3e71d2`, with its analysis module identity checked in the binary.
Native-window interaction is unverified. Phone EloGuard remains separate.
