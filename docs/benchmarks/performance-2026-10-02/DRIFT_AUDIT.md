# Chronological diffusion: remaining numerical work

Read-only audit, 2026-10-02. This is a proposal and diagnostic evidence, not a delivered dynamic solver. The constant-period and zero-drift v3 acceptance is a separate milestone.

## What the existing reference establishes

`drift-reference.json` contains six synthetic histories independently propagated with Fourier Gaussian heat evolution on [-2000, 6000), 61-node opponent integration, and converged 0.125/0.25-point summaries. Boundary and negative-roundoff diagnostics are negligible for these ordinary fixtures. The method is not a valid rare-tail recovery oracle: Fourier roundoff can seed probabilities that later surprising evidence amplifies.

The dynamic application branch still stores log probabilities on [-1000, 5000]. Its summaries interpret grid masses as uniform bins. For short gaps it uses a three-point kernel with side mass v/(2h²), and for larger gaps a sampled Gaussian truncated at five standard deviations.

There are three distinct errors:

1. Histogram quantiles dominate the visible interval error: up to 1.39 rating points in the existing 1,000-game one-second fixture.
2. The three-point short-gap kernel has the correct variance but is not continuous Gaussian diffusion. Its fourth moment is vh² rather than 3v². Its error changes at the v=h² branch boundary; halving h need not improve a particular fixture monotonically.
3. A five-standard-deviation Gaussian cutoff still measurably changes long-gap tails. Finer grids do not remove this cutoff bias.

The short-gap kernel also ceases to be log-concave when v > 2h²/3: its centre weight becomes smaller than either side weight. For the daily/h=5 case, v/h² is about 0.887, giving weights approximately [0.444, 0.113, 0.444]. A sufficiently concentrated input can therefore acquire artificial multiple modes, whereas exact Gaussian convolution preserves log-concavity. Choosing h=2 only relocates this hazard to other gap/model combinations; it does not remove it.

## Isolation experiments

These variants were built in memory with the existing compiler; no model/helper source or runtime was edited. Numbers below are maximum absolute errors over every point against the frozen reference, in rating points.

| Diagnostic variant | Daily 30: largest summary error | Year gaps 10: largest summary error | One-second 1,000: largest summary error |
| --- | ---: | ---: | ---: |
| Continuous summaries, h=10, existing diffusion | 0.0016501 | 0.0013864 | 0.0002592 |
| Continuous summaries, h=5, existing diffusion | 0.0020543 | 0.0016063 | 0.0000530 |
| Continuous summaries, h=10, eight-SD cutoff | 0.0016501 | 0.0000014 | 0.0002592 |
| Continuous summaries, h=2, eight-SD cutoff | 0.00000001 | 0.000000003 | 0.0000085 |

The h=2/eight-SD variant also stays below 0.0000007 on the minute-gap and session-gap fixtures. Representative execution times were 41–416 ms per fixture. Passing these fixtures does not establish an arbitrary-drift or arbitrary-model guarantee.

A separate 5,000-game, one-second, known-opponent run makes the residual short-gap error more visible. Independent Fourier h=0.5/0.25 runs agree on final mean and SD to roughly 4e-11; their endpoint convergence is only about 0.00057, so they are not a new endpoint oracle at the original 1e-5 reference precision. The converged SD is 5.1920205952. The h=2/eight-SD application variant gives 5.1915630948 (error 0.0004575), and h=1 gives 5.1919057120 (error 0.0001149). This approximately fourfold improvement is evidence of the remaining second-order short-gap discretization error. It should not be hidden by declaring h=2 universally sufficient.

## The fixed domain also changes the estimate

An independently solvable Gaussian case demonstrates the boundary defect without trusting Fourier tail arithmetic. Start at rating 4000 with prior SD 350, use drift SD 90/year, and apply two effectively uninformative wins separated by 20 years. A large positive white advantage makes each win likelihood numerically exactly one throughout the relevant distribution; the results therefore cannot change its mean or variance.

The exact final distribution is Normal(4000, 350² + 20×90²):

| Quantity | Exact Gaussian | Current dynamic branch |
| --- | ---: | ---: |
| Mean | 4000 | 3962.19874435 |
| SD | 533.38541412 | 495.43181377 |
| 2.5% endpoint | 2954.58379844 | 2947.49570902 |
| 97.5% endpoint | 5045.41620156 | 4855.96818000 |

The final edge mass is 0.0013111, but the UI does not use that diagnostic. The prior itself is already truncated before diffusion. A finer grid and better summary alone cannot repair this.

## Recommended implementation boundaries

- Reuse continuous log-density summaries for dynamic states and predictions. State propagation and its error control remain separate work.
- Replace or control the short-gap approximation. A positive-weight quadrature of the previous continuous log density at Gaussian-shifted positions avoids negative-probability stencils; compare actual refined evaluations, not two quadrature orders of the same inaccurate interpolant. Larger gaps can use adequately supported convolution. Retain all evidence in log form.
- An eight-SD kernel is a useful measured improvement, but treat its tail bound as an explicit numerical tolerance and verify widening. Do not make that engineering constant an accuracy claim for arbitrary repeated histories.
- Make support depend only on the prior and already observed history. Inspect slopes and mass near both boundaries before and after propagation/update. Test wider domains and finer meshes until declared summary/prediction tolerances are met.
- Expanding a dynamic grid requires more than extending the current interpolant. Preserve the completed-game prefix and replay it on the enlarged domain from the original Gaussian prior; previous truncation has otherwise already changed the state. Chronological likelihood/diffusion steps cannot be replaced by unordered result counts. Retain previously emitted points so later evidence never rewrites an earlier displayed prefix.
- Bound per-call caches and report numerical nonconvergence explicitly. A silent fixed-bound fallback would reintroduce the defect.

## Required independent checks

1. All six ordinary reference histories: every mean, SD, endpoint, pre-result mean, and predictive probability.
2. Gaussian propagation with effectively constant likelihood: upper/lower boundary cases, several variances, split versus unsplit elapsed time, and starting means between mesh nodes. These have analytic answers.
3. Gaps just below/above v=h² for several h values, concentrated Gaussians near v=0.9h², and split versus unsplit diffusion intervals, plus one-second histories up to the supported 5,000-game limit.
4. Past-only support expansion, followed by opposite evidence returning the posterior into the old domain; prefix points must be identical when future games are appended.
5. Rare-tail dynamic recovery against an independent log-domain continuous or high-precision convolution oracle on widened domains. Do not use the Fourier oracle for this test.
6. A short-gap limit approaching zero drift should converge to the independently accepted constant model, including intervals and predictions, not only the mean.
7. A 5,000-game timing/memory check with varied opponents and mixed short/long gaps, separately from correctness runs.

No dynamic solver change, delivery, restart, or empirical calibration is claimed by this audit.
