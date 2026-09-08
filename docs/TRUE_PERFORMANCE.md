# True performance stats

## Design contract

Design precedes implementation: see the three `docs/design/TRUE_PERFORMANCE_*.svg` prototypes. Data in prototypes is illustrative. Use Outpost's theme tokens and a native responsive treatment on the phone. EloGuard's stats provide the rough information hierarchy: account/pool selection, period or last-N selection, headline performance, rating history, colour results and recent games. No EloGuard assets or estimator code are copied into Outpost.

Account/provider and time-control pools remain separate. Account, time control and period use dropdowns. Current strength uses chronological prior history; period performance describes only selected games. A single game shows its result and posterior update, never a precisely measured standalone strength. Chart uncertainty is model uncertainty, never empirically verified truth coverage. Empty/error/loading/history-limit states are explicit. Outpost and En Croissant desktop load public rated-game histories for linked accounts; the phone uses its existing PGN-preserving stats transport. These result-based stats never start engine analysis.

## Mathematical objective

Improve consistency and numerical correctness before claiming predictive improvement. Remove arbitrary surprise/reliability weights; integrate opponent uncertainty; use a proper win/draw/loss likelihood with all rating-dependent terms included; propagate chronological strength distributions rather than treating one MAP value as certain; prevent future games and future ratings leaking into earlier points. Optimisation is conditional on an explicit model and numerical tolerance, not universal optimality.

The original classical report's fitted coefficients and post-hoc future-performance interval inflation are not calibrated for online pools. Any new constants must be disclosed and tested; do not silently describe online estimates as FIDE-equivalent. Preserve raw account rating and score alongside estimates. Independent predictive validation is distinct from mathematical/numerical tests.

## Model and interpretation

For strength `r`, opponent strength `o`, and colour sign `c`, define

```
z = ln(10) * (r - o + c * whiteAdvantage) / divisor
d = logDraw + drawSlope * ((r + o)/2 - 2200)/400 + z/2
P(win), P(draw), P(loss) = softmax(z, d, 0)
L_i(r) = integral P(observed result_i | r, o) Normal(o; opponentRating_i, opponentSd_i^2) do
```

The chronological filter diffuses the previous posterior by a zero-mean Gaussian with variance `driftSdYear^2 * elapsedYears`, then multiplies by `L_i(r)` and normalises. It starts once from the earliest usable **pre-game** rating. Later official ratings are drawn for comparison but never reused as independent priors, because they already incorporate games in the history. The displayed strength is the posterior mean: it minimises posterior expected squared rating error under this model. Outcome forecasts integrate over both players' uncertainty before observing the result. The entire strength-dependent draw term is retained; no approximate Newton derivative or surprise multiplier is used.

Period performance assumes one constant strength over the selected games: `posterior(r) proportional to Normal(r; firstPreGameRating, priorSd^2) * product L_i(r)`. Its posterior mean is the same squared-error-optimal estimate under that period model. At least three usable rated games are required. This is a regularised result-performance estimate, not a claim that ability remained constant for a year.

Production inference uses a 10-point grid from -1000 to 5000 and five-node Gauss-Hermite opponent integration. Small-gap diffusion preserves sub-cell variance; larger gaps use a Gaussian convolution. Model ranges are central 95% posterior quantiles. The online assumptions are divisor 400, white advantage 0, draw factor 0.2, level-dependent draw slope 0, prior SD 150, opponent SD 60 (150 for an explicitly provisional Lichess opponent), and annual drift SD 90. These constants are **provisional, not fitted online parameters**. The report's classical coefficient set is retained only as an explicit research model, not selected for online accounts.

In everyday terms: begin with the rating before the first game, ask how plausible each result would be at different strengths, and update the whole range of plausible strengths. A few games leave more uncertainty; sustained results provide more information. Recent strength can move with time. The period figure answers how well the selected batch was played; the running figure answers what the history suggests after its latest game.

## Data and delivery

- Chess.com pre-game ratings come from PGN Elo headers. Lichess game rating is pre-game; its ratingDiff is never added to an estimator prior. Unrated, unfinished, undated, future, missing-opponent and duplicate games cannot enter inference. Missing account ratings are never filled from a later profile.
- Public histories are limited to the latest 5,000 available games in a single pool; the phone additionally bounds discovery to ten years. The displayed coverage states these limits. All history means loaded history, not a promise of complete lifetime coverage.
- Outpost/desktop snapshots have a six-hour browser cache, manual refresh, cancellation, visible request errors and canonical provider URLs. A failed refresh preserves the previous snapshot. No Library or original analysis archive is rewritten.
- The original dependency-free shared modules are maintained identically across the two repositories. En Croissant's existing engine-based Strength tab is a separate measurement and retains its native behaviour.

## Verification and limits

`scripts/verify-performance-reference.py` independently integrates an asymmetric ten-game fixture on a 0.5-point grid with 61 opponent nodes: posterior mean 1576.834105637099, SD 95.40198440150883. Production inference agrees to better than 0.001 rating point on the mean and SD. Additional tests cover finer-grid convergence, proper outcome probabilities, colour reflection, chronology/no future leakage, duplicate/pool boundaries, unknown initial ratings and inactivity uncertainty. Three independent fixture references also exercise the phone adapter.

Dedicated headless React fixtures mount the actual Outpost Home/Accounts and phone StatsWorkspace at desktop and narrow widths, with deterministic provider responses. They check dropdown changes, last-N filtering, provider/time-control switching, chart interaction, overflow and help bounds. They do not establish physical iPhone touch behaviour.

No new untouched online predictive backtest has been completed. Neither globally optimal parameters, improved forecast accuracy, nor 95% real-world truth coverage is claimed. The original report also measures intervals against noisy future performance, so that coverage must not be relabelled as coverage of latent true strength. The next research milestone is provider/time-control-specific fitting followed by a player-disjoint chronological holdout comparison using proper scoring rules and interval calibration.
