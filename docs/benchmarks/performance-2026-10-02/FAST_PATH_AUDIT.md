# Frozen numerical fast-path audit

Read-only mathematical review, 2026-10-02. No empirical outcomes, fitting, production source edits or builds were performed for this audit. This is finite numerical evidence, not an all-history error enclosure or a claim of calibrated strength uncertainty.

Reviewed snapshots under `C:/Users/Lox/Desktop/repo/outpost-chess/tmp/performance-20261002/dual-domain/`:

| File | SHA-256 |
| --- | --- |
| performanceDynamics.ts | 22a2e7ea307d8cbab13dd3151c6723d8a2d0b0f7d9d408df65436b883b43605d |
| truePerformance.ts | 93d9a5339d63a8b4afc519f5129516758d4d58b3e9bd18270ee168a0aebac493 |

## Cubic correction and truncated moments

Let `x = mode + scale*z`. After extracting `peak - z²/2`, the product of the interpolated density and Gaussian transition has cubic correction `C(z)=c0+c1*z+c2*z²+c3*z³`. The implemented coefficients follow by expanding the cell polynomial around its midpoint and the transition around `mode`. The final log normalization `peak + log(scale/sqrt(variance)) + log(integral)` is correct because the moments already include the standard-normal density.

The moment recurrence is correct: `M0=Phi(b)-Phi(a)`, `M1=phi(a)-phi(b)` and `Mn=a^(n-1)*phi(a)-b^(n-1)*phi(b)+(n-1)*M(n-2)`. The squared-cubic coefficients and subsequent polynomial multiplication/factorials implement the Taylor polynomial of `exp(C)` through the selected degree. Grid-aligned cuts prevent one cell's cubic from being integrated across another cell's polynomial. Outside the trusted interpolation cells, `polynomial()` supplies the same quadratic continuation used by `value()`, with third derivative zero.

The triangle bound `B=sum |ck|*radius^k` bounds `|C|` over each cell. Conditional on exact coefficient/moment arithmetic, a degree-n expansion has relative remainder at most `exp(2B)*B^(n+1)/(n+1)!`. The selected thresholds imply:

| Maximum correction B | Degree | Relative Taylor remainder bound |
| --- | ---: | ---: |
| below 1e-6 | 1 | below 5.00002e-13 |
| below 0.0005 | 2 | below 2.08542e-11 |
| below 0.003 | 3 | below 3.39532e-12 |
| at most 0.01 | 4 | below 8.50168e-13 |

Thus the largest analytic truncation bound is about 2.09e-11 per accepted convolution value, below the general quadrature comparison tolerance of 2e-10. This does not bound floating-point cancellation, interpolation error, accumulated history error or exterior-model error. The two omitted-tail tests also depend on concavity; the cubic interpolant is not an explicitly constrained concave spline. Interior `derivatives()` clips positive curvature for mode search/scale selection, while `polynomial()` retains the actual cubic curvature for its correction. That distinction is consistent with a Gaussian integration proposal, but it must not be described as a rigorous concavity certificate.

At cell boundaries, adjacent cubics share values but are not generally C1. The integration cuts account for their separate polynomials; the separate mode/resolution/domain guards and independent reference cases remain necessary. Taylor bounds alone cannot justify the entire filter.

## Normal tails and cancellation

The six rational coefficient arrays, explicit leading-one denominators, `x/sqrt(2)` conversion and branch boundaries agree with the pinned upstream Cephes implementation. The helper calls the positive-tail function only with nonnegative arguments in this path; integration limits remain within approximately twelve standard deviations, so far-tail underflow is outside the shortcut's intended domain.

A small in-memory probe of the actual frozen functions checked 15 points, including both rational branch boundaries, against Python's independent `math.erfc`. Maximum absolute tail error was 2.78e-17 and maximum relative error 1.56e-15. Twenty-four narrow-interval probes used a midpoint-density expansion; maximum absolute mass error was 6.16e-17 and none were negative. This was a subsecond scalar check, not a benchmark.

Subtracting nearly equal tails does lose relative precision. For `[8, 8.000000000000002]`, the returned mass was about 1.37065e-29 versus a reference about 8.97464e-30: roughly 53% relative error but only 4.74e-30 absolute error. Higher moments also contain cancellation. These cells contribute negligible mass in the inspected use; do not advertise arbitrary relative accuracy for tiny truncated moments. The aggregate Taylor check is not a floating-point error enclosure, and broad convolution/reference comparisons remain required.

## Factored original likelihood

For opponent displacement `sd*x`, the win logit changes by `-slope*sd*x`; the draw logit changes by `(drawSlope/800-slope/2)*sd*x`. Therefore precomputing those exponentials and multiplying by the rating-dependent logits is algebraically the same opponent-quadrature likelihood, including the strength-dependent draw term. It does not substitute a Gaussian posterior or discard latent opponent uncertainty.

The verified quadrature spread is at most 2.1 and its largest node has magnitude 11.615. Each precomputed exponent is consequently within about +/-24.4. Combined with the shortcut's +/-500 logit gate, intermediate exponentials/products remain far from double overflow. The code returns to the original stabilized log likelihood when logits exceed the gate, an integrated probability approaches underflow, or the sum is nonfinite. Known-opponent inputs also retain the original path. Exact-arithmetic equivalence does not imply bit-identical arithmetic: the separately owned original-path comparisons must cover defaults, provisional opponents, draw slopes, threshold boundaries and downstream estimates before acceptance.

## Attribution and narrow delivery integration

The coefficient source is [SciPy xsf ndtr.h](https://github.com/scipy/xsf/blob/8400c4928b83d8d6ee0228807bb24a435216e281/include/xsf/cephes/ndtr.h), with the [BSD-3-Clause license](https://github.com/scipy/xsf/blob/8400c4928b83d8d6ee0228807bb24a435216e281/LICENSE). Upstream commit `8400c4928b83d8d6ee0228807bb24a435216e281` was resolved on 2026-10-02. Exact upstream UTF-8 SHA-256 values are `92a6c47c10fe8a27b77847e09809387a01993a6b10f3229797bce25bb7019a22` for ndtr.h and `632f86f8bd24a264ac49c002f39866f407a38e8cbd8a6568df7596cc7fbe0048` for LICENSE. The retained Cephes header names Stephen L. Moshier and copyright years 1984, 1987, 1988 and 1992.

`CEPHES_XSF_LICENSE.txt` contains that notice and the full upstream BSD license. Identical `src/shared/performanceDynamics.LICENSE.txt` assets are supplied to all five maintained source targets. This records adaptation provenance; it does not change the likelihood or the inference constants.

Recommended integration, owned separately from this audit:

1. Import `./performanceDynamics.LICENSE.txt?url&no-inline` in the shared panel and expose a small Third-party licence link within its existing About estimates details. Both inspected Vite runtimes and client declarations support this query. The no-inline flag gives an emitted text asset rather than a short data URL.
2. Add the full retained notice/license as a `/*! ... */` legal comment in the numerical helper after the frozen benchmark, then record new source hashes. Verify actual minifier retention; the linked full license asset is the explicit delivery mechanism.
3. Preserve Novelty primary's existing aggregate notices and En Croissant's unrelated license work. Novelty's current frontend verifier has a package-parent/tslib-specific embedded-source schema; blindly inserting this local adaptation would be incorrect. A later aggregate-notice integration should add a separate reviewed local-source record rather than weakening existing package checks.
4. The En phone Vite build uses `publicDir:false`. Its approved publisher subsequently calls `Copy-EnCroissantPhonePublicShell`, which copies public files except web-library, so a public notice would reach that publisher but not a standalone Vite home build. The imported shared asset works in both paths and requires no public-directory changes.
5. After numerical CPU checks finish, verify the emitted license bytes and link in each target's actual frontend artifact. Both Tauri configs use their built frontend dist as bundled assets, so the imported notice should accompany desktop binaries; confirm that artifact boundary before claiming installer coverage. A browser fixture with `copyPublicDir:false` is not installation proof. No build, installer or hosted-phone verification is claimed here.

No mathematical defect was found in the inspected coefficient expansion, moment recurrence or likelihood factorization. The meaningful remaining checks are independent full convolution/history comparisons, accumulation and boundary stresses, declared resource limits, and final license-artifact inclusion. Existing dual-domain convergence limits, timestamp semantics and statistical calibration limitations remain unchanged.
