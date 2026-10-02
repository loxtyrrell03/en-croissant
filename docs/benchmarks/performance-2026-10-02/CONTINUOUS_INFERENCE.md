# Continuous period inference

Version `bayes-continuous-v3` corrects numerical inference for the existing constant-period Davidson/Gaussian model. It does not fit or change the statistical coefficients. Period performance and a zero-drift chronological history share this solver; the nonzero-drift history remains a separate, incomplete numerical improvement task.

## Calculation

The solver keeps an unnormalised log posterior on a support mesh and retains exact sufficient result counts plus chronological games. It expands the domain using only evidence already observed, evaluating new nodes from the original prior and past likelihoods. It never reconstructs discarded tails by fitting a Gaussian to a truncated posterior. Future games do not choose earlier domains or change earlier emitted points.

Reporting integrates a local cubic interpolant of the **log density**, using Gaussian quadrature and continuous quantiles. A fine/coarse summary comparison, actual midpoint density discrepancies and local peak width trigger refinement; comparing two quadrature orders on the same polynomial alone would miss interpolation error. Refined nodes are evaluated from the true accumulated likelihood. Cropped reporting windows do not replace the retained support mesh or exact evidence, so contrary results can recover a previously unlikely region.

Predictive probabilities integrate each candidate outcome against the resolved pre-game posterior. Independent testing caught coarse-mesh prediction despite a refined displayed estimate, and a narrow draw likelihood incorrectly treated as negligible. Both cases now have direct SciPy reference regressions. Exact likelihood arrays are cached only within one invocation, with a 4 MiB bound; exact refined-node values have a 4,096-entry bound.

Opponent integration uses 15 or 41 normal quadrature nodes according to dimensionless logit spread. The verified spread is at most 2.1, including the online defaults, provisional opponents and tested SD 350/classical fixtures. Larger spreads throw an explicit unsupported numerical-range error rather than silently returning an arbitrary capped approximation. Sharp known-opponent models are tested separately. This is not a claim of arbitrary-parameter accuracy. Support and refinement resource bounds also fail explicitly.

The continuous likelihood is log-concave: log-softmax with affine logits is jointly concave, multiplying by the opponent's Gaussian preserves log-concavity, and marginalization preserves it. Multiplication with the player's Gaussian prior and further likelihoods retains that property. This motivates the contiguous integration neighborhood; finite quadrature remains a numerical approximation subject to the stated tests and parameter scope.

## Independent acceptance

`check-performance-continuous.mjs` checks the frozen 15 SciPy references, 13 translations between coarse nodes, three sharp direct-likelihood cases, predictive probabilities, domain expansion/reversal, exact chronological prefixes and graph/headline equality. The final receipt is `continuous-v3-refined-predictive-result.json`; earlier passing and failing receipts are retained. Maximum tested summary error is about 0.00002682 rating point, below the 0.001 gate. The sharp predictive probe agrees within about 1.04e-11 probability. The helper suite adds the unseen narrow draw and unsupported uncertainty regressions.

Examples of corrected discrepancies:

| Synthetic evidence | Previous numerical result | Continuous reference |
| --- | ---: | ---: |
| 5,000 balanced results centred at 1812, known opponent | Mean 1811.83179; SD 5.05879 | Mean 1812; SD 5.15075 |
| 5,000 results with opponent SD 350 | Mean 2440.06285 | Mean 2447.52841 |
| 5,000 wins against rating 4000, prior SD 150 | Mean 4999.23368 on the old fixed domain | Mean 5430.91721 under the untruncated prior |

Values above 4000 in stress cases expose numerical domain bias; they do not establish meaningful extrapolation of an online provider's rating scale.

The panel now uses the final cumulative-period graph point as its headline, eliminating a duplicate pass. On the same machine, 20 paired 5,000-game measurements after two warmups gave panel-computation p95 4.271 seconds for v2 versus 3.801 seconds for v3 (ratio 0.890). The period graph itself is slower because it performs more accurate integration; reusing it reduces total work. `latency-v3-result.json` retains every timing and source hash. This measures computation, excluding browser rendering/network, and does not establish physical-phone responsiveness.

## Remaining limits

Nonzero-drift history still uses the earlier grid/convolution. Independent spectral Gaussian references in `drift-reference.json` show interval endpoint errors up to 1.389 rating points in ordinary fixtures, while a wide-prior/inactivity analytic case exposes much larger boundary bias. `drift-v3-result.json` deliberately reports failure of the continuous-history gates. `DRIFT_AUDIT.md` records the short-gap artificial-mode problem and the required support-safe repair; a finer grid alone is insufficient.

No real-data predictive, calibration or latent-strength recovery experiment has yet justified replacing the provisional model assumptions. Source admission is separate, and Tournament TPR is a distinct convention documented in `CALCULATOR_SCOPE.md`.

Shared source/tests are carried to Novelty and both En Croissant source targets, with each native panel's existing interface preserved. Rendered synthetic desktop/narrow checks exercise comparison, graph switching and the drawn endpoint as well as its readout. Installed apps, hosted phone services and customer releases are separate delivery boundaries and were not changed by this milestone.
