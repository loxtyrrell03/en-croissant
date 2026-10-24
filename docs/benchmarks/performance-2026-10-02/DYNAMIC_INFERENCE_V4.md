# Continuous chronological inference

`bayes-continuous-v4-dual-domain` is a numerical correction to the existing chronological Davidson/Gaussian model. It preserves the accepted v3 constant-period solver and all online coefficients. It does not establish improved real-world prediction or calibrated latent-strength intervals.

## Method and evidence

The dynamic solver propagates a continuous cubic interpolation of the log density through a Gaussian transition. Gaussian importance integration retains the full log-density correction at every node; it does not replace the posterior with a fitted Gaussian. For small cubic corrections, exact truncated-normal moments evaluate a bounded Taylor expansion. Larger corrections use successively higher positive quadrature rules and adaptive cell integration.

Two independently initialized support ranges evolve from the actual prior. Every game's summaries and predictive probabilities must agree within 0.00008 rating point and 1e-8 probability; local fine/coarse summaries, log-midpoint consistency and peak width also control resolution. A discrepancy expands the range or coordinates a finer mesh and replays the observed prefix from the original prior. Previously returned points remain unchanged. Forecasts are fixed before an extremely unlikely observed outcome can require extra refinement, so the current result cannot choose its own pre-game forecast.

The exterior quadratic continuation is a numerical guard, not a rigorous bound on all possible omitted history. Agreement between ranges is a convergence test, supplemented by independent truth references and a predeclared third-range battery. It is not a universal integration certificate.

The independent nine-case analytic/full-log reference suite passes at every prefix: maximum mean error 0.000003715 rating point, endpoint error 0.000003536 and predictive error 9.23e-10. References include concentrated distributions, equivalent elapsed-time partitions, twenty-year boundary crossings, nearly zero drift and recovery after hundreds of highly surprising results. Rare-tail references use positive log-domain convolution; FFT roundoff is not treated as a valid oracle in those cases. All six ordinary drift references also pass, with maximum summary error 0.00006473 point and predictive error 2.924e-8. The unchanged period solver passes all 15 frozen references, 13 translated cases and three sharp cases again on the promoted source.

The frozen third-range battery passes nine histories containing 1,960 games, with 11,534 traversals and 54 exact current-result invariance checks. All reported summaries and forecasts are bit-identical when both initial ranges are doubled. The fast likelihood path agrees with the stable logarithmic implementation over 1,134 outcome values within 7.11e-15 log units, including a finite draw log likelihood below -960 whose ordinary probability underflows. See `DUAL_DOMAIN_INDEPENDENT_AUDIT.md` and its immutable receipts for scope, hashes and commands.

Likelihood caches are local to one history invocation and hold at most 8 MiB of numeric arrays; object/map overhead and temporary integration arrays are additional. There is no persistent cache, account-data migration or shared mutable model state. The period solver retains its separate 4 MiB likelihood cache.

## Bounded support and retained failures

The finite 24,001-node mesh and bounded replay/integration attempts reject unresolved calculations explicitly. A custom divisor 0.05 with known opponents exceeds that dynamic mesh capacity, including a first game with no elapsed drift. Its zero-drift period counterpart still matches the independent narrow-draw oracle. This failure remains in `dual-domain-likelihood-v1-result.json`; it is not an all-pass receipt. The standard panel has no custom-model controls and uses divisor 400 with opponent SD 60 or 150. The custom failure is therefore not reachable through the ordinary provider adapters, but arbitrary input histories are not guaranteed to fit the resource bounds.

The earlier Gaussian-envelope design was rejected after a 69-second exploratory 5,000-game run. Its source, tests and failure evidence remain in `failed-gaussian-envelopes/` and `FAILED_DYNAMICS_GAUSSIAN_ENVELOPES.md`. A subsequent interval-risk prototype also remained research-only. No acceptance threshold was weakened to discard an inconvenient case.

## Runtime and product boundaries

The required controlled benchmark uses the same 5,000 games, two warmups and twenty paired, alternating-order repetitions. On the one-second-gap fixture, v3 total panel computation has p95 3.821 seconds and v4 8.330 seconds (2.180 times); history alone rises from 1.568 to 6.098 seconds. Period computation is unchanged. These are same-machine calculation timings, excluding browser/network and not physical-phone measurements. The 1.25-times protocol gate applies to a proposed statistical model; this numerical correction instead requires explicit disclosure of its cost and responsive background calculation.

Each additional gap fixture also has two warmups and twenty paired repetitions:

| Gap pattern | v3 panel p95 | v4 panel p95 | Ratio | v4 history p95 |
| --- | ---: | ---: | ---: | ---: |
| One second | 3.821 s | 8.330 s | 2.180 | 6.098 s |
| One hour | 3.755 s | 7.310 s | 1.947 | 5.195 s |
| Mixed minutes/days/fortnights | 3.801 s | 10.921 s | 2.873 | 8.687 s |

`latency-v4-{seconds,hours,mixed}-result.json` retains every timing, exact source graph and fixture hash. These runs were separated from numerical tests and other task-owned benchmarks. Heap snapshots at the end of the entire Node benchmark are process snapshots, not peak per-call or physical-phone memory measurements. Do not substitute the implementer's earlier exploratory fixtures for these controlled comparisons. Final product checks and delivery state are recorded with the milestone decision.

## Statistical limits remain

All online constants remain provisional. The completed public-prefix likelihood trial found promising conditional-result predictors but lacked the independent longitudinal and calendar evidence required for production promotion. Its selected candidates remain research-only. Better numerical integration cannot repair an incorrect statistical assumption: persistent opponent error and session dependence can make the model's intervals too narrow. The repeated-opponent special-case derivation is a separate research reference, not app behavior.

The supported claim is accurate numerical evaluation on the declared domain and tested cases, with explicit failure outside supported bounds. No finite experiment establishes the most accurate possible chess model.

Canonical research scripts and archived rejected implementations are retained in the Novelty repository. Sibling source checkouts carry the shared kernel, regression fixtures and compact acceptance documentation; their copies do not imply separate empirical fitting or a different statistical model.

The subsequent background integration is verified across all five source checkouts. See ASYNC_INTEGRATION.md and final-product-verification.json for exact source hashes, real-worker cancellation/retry checks, full licence inclusion and the source-only delivery boundary. The existing panel remains responsive during the more expensive computation.
