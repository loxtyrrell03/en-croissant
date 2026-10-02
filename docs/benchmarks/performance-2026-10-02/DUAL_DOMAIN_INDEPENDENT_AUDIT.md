# Dual-domain candidate: independent numerical audit

This is finite numerical verification of the frozen experimental candidate, not
an empirical accuracy claim or a universal exterior-error certificate. Product
promotion, latency, UI handling and delivery are separate decisions.

The tested source is the three-file snapshot at
`C:/Users/Lox/Desktop/repo/outpost-chess/tmp/performance-20261002/dual-domain`:

| File | SHA-256 |
| --- | --- |
| truePerformance.ts | 93d9a5339d63a8b4afc519f5129516758d4d58b3e9bd18270ee168a0aebac493 |
| performanceDynamics.ts | 22a2e7ea307d8cbab13dd3151c6723d8a2d0b0f7d9d408df65436b883b43605d |
| performanceNumerics.ts | 072a89ec50bd918fec9b1898620d763675e62243f39b7f02b5fe93793cb27422 |

## Independent truth and chronology

`dual-domain-dynamic-v1-result.json` passes all nine frozen analytic/full-log
reference cases and the method-independent chronology checks. Across every
reference prefix, the maximum errors are 0.000003715 rating points for the mean,
0.000000229 for SD, 0.000003536 for either 95% endpoint, 0.000003597 for the
pre-game mean, and 0.000000000923 for an outcome probability. These retain the
predeclared 0.001-point and 0.000001-probability gates.

The references include a concentrated Gaussian followed by a four-hour gap,
equivalent gap partitions, wide boundary-crossing Gaussian propagation, nearly
zero drift, and two rare-tail histories integrated in positive log space. The
rare-tail oracle does not use FFT convolution, probability flooring, a five-SD
transition window, or the production interpolant. Future evidence leaves
previously emitted points unchanged. Two specially constructed rare observed
outcomes also leave the same pre-game forecast bit-identical when the current
score is changed between win, draw and loss.

The old Gaussian-envelope audit is explicitly inapplicable to this candidate.
Its implementation and method-specific tests remain preserved as research
evidence; passing the present checks does not retroactively validate that
method's latency or turn interpolation error into a certified bound.

## Predeclared third-support comparison

`dual-domain-third-support-v1-result.json` passes the frozen battery
`dual-domain-battery-v1.json` (SHA-256
`a0319b9e98bdbd25f6585b14a7caface6e1a26b57637cf560f8f4e07031cf5bd`,
xorshift32 seed 1656758695). It contains nine histories, 1,960 input games and
11,534 total game traversals including the repeated forecast audits.

The second bundle changes only the unique internal declaration
`const DYNAMIC_DOMAIN_SCALE = 1;` to `2`. It therefore compares the candidate's
paired initial radii with a third, wider support while retaining its mesh,
likelihood, summaries and tolerances. Raw, transformed and bundled hashes are
retained in the receipt. Every prefix's mean, SD, endpoints, pre-game mean and
prediction is bit-identical between variants; whole-history hashes can differ
because edge-mass diagnostics depend on the support. All 54 current-score
mutation checks are bit-identical. Agreement is a support-convergence test,
not an independent truth oracle.

The cases cover one-second, hourly, session and mixed gaps; a 1,000-game balanced
repeat opponent; shuffled opponents at ratings 0 and 4,000; fractional prior
centres; prior/opponent SD 350 where supported; and the ordinary online and
classical research coefficient sets. The fixture records earlier synthetic
exposure and was frozen before this candidate's battery outputs were seen.

## Additional likelihood audit and retained limitation

`dual-domain-likelihood-v1-result.json` is deliberately **not an all-pass
receipt**. The dynamic fast likelihood agrees with the stable logarithmic
implementation over 1,134 outcome values: maximum log difference is
7.11e-15 and maximum probability difference 3.34e-16. The extreme draw check
(`opponentSd=1`, `divisor=20`, `logDraw=-730.25`, rating 4000/opponent 0)
preserves the finite draw log likelihood -960.5068524562449 exactly, even though
its ordinary probability underflows. This is equivalence verification, not an
independent derivation of both implementations.

The previously independent narrow-draw oracle uses prior mean 1800/SD 150,
known opponent 1802.5 and divisor 0.05. With zero drift its first-game forecast
matches within 1.09e-12. With positive drift the first game explicitly rejects
the required mesh as unsupported. This is retained as a custom-model capacity
limitation; neither the gate nor the source was relaxed to hide it.

That particular custom configuration is unreachable through the current
standard panel: it passes no model override, the ordinary divisor is 400, and
the provider normalizers use opponent SD 60 or 150 for provisional Lichess
opponents. The loader caps at 5,000 games. No standard-input regression was
identified in these batteries. This does not prove that arbitrary custom
models, timestamps, or unbounded history lengths fit the finite mesh cap.

## Reproduction

From the feature checkout, pass the frozen source path above with
`/truePerformance.ts` appended and a **new** output receipt to each command:

```text
node scripts/check-performance-dynamic-extensions.mjs --source SOURCE --method dual-domain --output NEW_RECEIPT --require-accuracy
node scripts/check-performance-domain-battery.mjs --source SOURCE --output NEW_RECEIPT --require-accuracy
node scripts/check-performance-dynamic-likelihood.mjs --source SOURCE --output NEW_RECEIPT --require-accuracy
```

The final command is expected to fail its overall gate on this frozen snapshot
while saving the explicit custom-model rejection. Receipts must not be
overwritten. No owner data, app runtime, serving copy or installed release was
changed by this audit.
