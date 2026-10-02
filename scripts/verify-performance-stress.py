"""Independent numerical stress reference for constant-period performance.

Run: python scripts/verify-performance-stress.py
Requires NumPy and SciPy; writes only the compact benchmark JSON named below.
No account histories, profiles, downloads, or runtime services are used.

REFERENCE: game multiplicities are accumulated in log space; SciPy adaptive
continuous integration computes posterior moments and quantiles. Opponent
uncertainty uses 81/161 probabilists' Gauss-Hermite nodes, independently checked
against adaptive normal integration. This does not import the TypeScript solver.
LEGACY DIAGNOSTIC: separately emulates the old 10-point/5-node solver, both with
its explicit 1e-15 pruning and with only floating-point underflow. That emulation
is an error demonstrator, never the reference answer.

Cases describe chronological blocks. Every expanded game has the same initial
account rating (priorMean); only result order changes between permutations.
"""
from __future__ import annotations

import argparse
from collections import Counter
from functools import lru_cache
import json
from pathlib import Path

import numpy as np
from scipy.integrate import quad
from scipy.optimize import brentq, minimize_scalar
from scipy.special import logsumexp, roots_hermitenorm

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/benchmarks/performance-2026-10-02/numerical-reference.json"
ONLINE = dict(divisor=400.0, whiteAdvantage=0.0, logDraw=float(np.log(.2)), drawSlope=0.0,
              priorSd=150.0, opponentSd=60.0, driftSdYear=0.0, step=10.0)
CLASSICAL = dict(ONLINE, divisor=515.0649349802578, whiteAdvantage=41.66589900576382,
                 logDraw=-.5997864078272523, drawSlope=.22517300423037162, priorSd=110.0)


def game(score, opponent=1500, sd=60, white=True):
    return dict(score=score, opponentRating=opponent, opponentSd=sd, white=white)


def block(repeat, *pattern):
    return dict(repeat=repeat, pattern=list(pattern))


def case(name, prior, blocks, model=None):
    return dict(id=name, priorMean=prior, model=model or ONLINE, blocks=blocks)


W, L, D = game(1), game(0), game(.5)
CASES = [
    case("ordinary-ten", 1500, [block(1, *[game(s, r) for s, r in
         zip([1, 0, .5, 1, 1, 0, 1, 1, 0, 1], [1480,1520,1495,1470,1510,1530,1490,1505,1520,1500])])]),
    case("wins-5000", 1500, [block(5000, W)]),
    case("losses-then-wins-5000", 1500, [block(2500, L), block(2500, W)]),
    case("wins-then-losses-5000", 1500, [block(2500, W), block(2500, L)]),
    case("alternating-5000", 1500, [block(2500, L, W)]),
    case("subcell-1812-no-opponent-uncertainty-5000", 1812,
         [block(2500, game(0, 1812, 0), game(1, 1812, 0))]),
    case("halfcell-1815-no-opponent-uncertainty-5000", 1815,
         [block(2500, game(0, 1815, 0), game(1, 1815, 0))]),
    case("mismatched-low-prior", 400, [block(200, game(1, 2200))]),
    case("mismatched-high-prior", 3200, [block(200, game(0, 1400))]),
    case("provisional-opponents-5000", 1800, [block(1000, game(1, 2000, 150), game(1, 2000, 150),
         game(.5, 2000, 150), game(0, 2000, 150), game(0, 2000, 150))]),
    case("high-uncertainty-opponents-5000", 1800, [block(1000, game(1, 2200, 350), game(1, 2200, 350),
         game(1, 2200, 350), game(.5, 2200, 350), game(0, 2200, 350))]),
    case("classical-colour-and-draw-slope", 1900, [block(200, game(1, 2200, 350, True),
         game(.5, 2000, 150, False), game(0, 1800, 60, False))], CLASSICAL),
    case("upper-grid-boundary-5000", 4000, [block(5000, game(1, 4000, 150))]),
    case("lower-grid-boundary-5000", 0, [block(5000, game(0, 0, 150))]),
    case("broad-prior-upper-boundary-5000", 4000, [block(5000, game(1, 4000, 350))], dict(ONLINE, priorSd=350.0)),
]


def expand(spec):
    return [g for b in spec["blocks"] for _ in range(b["repeat"]) for g in b["pattern"]]


def groups(spec):
    return Counter((g["score"], g["opponentRating"], g["opponentSd"], g["white"]) for g in expand(spec))


@lru_cache(None)
def quadrature(n):
    nodes, weights = roots_hermitenorm(n)
    return nodes, weights / np.sqrt(2 * np.pi)


def probabilities(rating, opponents, white, model):
    z = np.log(10) * (rating - opponents + (1 if white else -1) * model["whiteAdvantage"]) / model["divisor"]
    d = model["logDraw"] + model["drawSlope"] * ((rating + opponents) / 2 - 2200) / 400 + z / 2
    logits = np.stack([z, d, np.zeros_like(z)], axis=-1)
    return np.exp(logits - logsumexp(logits, axis=-1, keepdims=True))


def marginal(rating, opponent, sd, white, model, nodes):
    x, w = quadrature(nodes)
    return w @ probabilities(rating, opponent + sd * x, white, model)


def adaptive_marginal(rating, opponent, sd, white, model):
    def one(index):
        return quad(lambda x: float(probabilities(rating, np.array(opponent + sd * x), white, model)[index])
                    * np.exp(-x * x / 2) / np.sqrt(2 * np.pi), -12, 12,
                    epsabs=2e-13, epsrel=2e-13, limit=180)[0]
    return np.array([one(i) for i in range(3)])


def continuous_reference(spec, nodes=161, bounds=(-1000.0, 5000.0)):
    model = spec["model"]
    counts = groups(spec)
    def logdensity(x):
        value = -.5 * ((x - spec["priorMean"]) / model["priorSd"]) ** 2
        for (score, opponent, sd, white), count in counts.items():
            index = 0 if score == 1 else 1 if score == .5 else 2
            value += count * np.log(marginal(x, opponent, sd, white, model, nodes)[index])
        return float(value)
    low, high = bounds
    fit = minimize_scalar(lambda x: -logdensity(x), bounds=bounds, method="bounded",
                          options={"xatol": 1e-7})
    mode = float(min([low, high, float(fit.x)], key=lambda x: -logdensity(x)))
    peak = logdensity(mode)
    # Center and split integration so narrow posteriors cannot be skipped.
    h = .05
    curvature = (logdensity(mode + h) - 2 * peak + logdensity(mode - h)) / h ** 2
    scale = min(model["priorSd"], 1 / np.sqrt(max(1e-12, -curvature)))
    a, b = (low - mode) / scale, (high - mode) / scale
    def density(t):
        return float(np.exp(logdensity(mode + scale * t) - peak))
    def integrate(fn, end=b):
        breaks = sorted(set([a, end] + [x for x in [-16, -8, -4, 0, 4, 8, 16] if a < x < end]))
        return sum(quad(fn, left, right, epsabs=2e-12, epsrel=2e-12, limit=160)[0]
                   for left, right in zip(breaks, breaks[1:]))
    normalizer = integrate(density)
    mt = integrate(lambda t: t * density(t)) / normalizer
    variance = integrate(lambda t: (t - mt) ** 2 * density(t)) / normalizer
    def quantile(q):
        t = brentq(lambda t: integrate(density, t) / normalizer - q, a, b, xtol=2e-11)
        return mode + scale * t
    return dict(mean=mode + scale * mt, sd=scale * np.sqrt(variance),
                low=quantile(.025), high=quantile(.975), mode=mode)


def legacy_grid(spec, prune=True, nodes=5, step=10):
    model = spec["model"]
    xs = np.arange(-1000, 5000 + .1, step, dtype=float)
    p = np.exp(-.5 * ((xs - spec["priorMean"]) / model["priorSd"]) ** 2)
    p /= p.sum()
    cache = {}
    for g in expand(spec):
        key = (g["score"], g["opponentRating"], g["opponentSd"], g["white"])
        if key not in cache:
            ix = 0 if g["score"] == 1 else 1 if g["score"] == .5 else 2
            cache[key] = np.array([marginal(x, key[1], key[2], key[3], model, nodes)[ix] for x in xs])
        p = np.where(p > 1e-15, p, 0) if prune else p
        p *= cache[key]
        p /= p.sum()
    mean = float(p @ xs)
    return dict(mean=mean, sd=float(np.sqrt(p @ (xs - mean) ** 2)),
                survivingCells=int(np.count_nonzero(p)), edgeMass=float(p[0] + p[-1]))


def exact_log_grid(spec, nodes=161, step=10):
    model = spec["model"]
    xs = np.arange(-1000, 5000 + .1, step, dtype=float)
    logp = -.5 * ((xs - spec["priorMean"]) / model["priorSd"]) ** 2
    for (score, opponent, sd, white), count in groups(spec).items():
        ix = 0 if score == 1 else 1 if score == .5 else 2
        logp += count * np.log([marginal(x, opponent, sd, white, model, nodes)[ix] for x in xs])
    p = np.exp(logp - logsumexp(logp))
    mean = float(xs @ p)
    return dict(mean=mean, sd=float(np.sqrt(p @ (xs - mean) ** 2)), edgeMass=float(p[0] + p[-1]))


def integration_audit():
    result = []
    for model_name, model in [("online", ONLINE), ("classical", CLASSICAL)]:
        for sd in [60, 150, 350]:
            worst = {n: dict(absoluteError=0.0) for n in [5, 9, 15, 25, 41, 81, 161]}
            for opponent in [0, 2000, 4000]:
                for delta in [-1200, -600, -200, 0, 200, 600, 1200]:
                    rating = opponent + delta
                    expected = adaptive_marginal(rating, opponent, sd, True, model)
                    for n in worst:
                        actual = marginal(rating, opponent, sd, True, model, n)
                        error = float(np.max(abs(actual - expected)))
                        if error > worst[n]["absoluteError"]:
                            worst[n] = dict(absoluteError=error, rating=rating, opponent=opponent)
            result.append(dict(model=model_name, opponentSd=sd, nodes=worst))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    rows = []
    for spec in CASES:
        ref = continuous_reference(spec)
        coarse_ref = continuous_reference(spec, nodes=81)
        convergence = {key: abs(ref[key] - coarse_ref[key]) for key in ["mean", "sd", "low", "high"]}
        assert max(convergence.values()) < 1e-5, f"Opponent integration did not converge: {spec['id']}"
        row = dict(**spec, gameCount=len(expand(spec)), reference=ref,
                   convergence81To161=convergence,
                   legacyPruned=legacy_grid(spec), legacyUnpruned=legacy_grid(spec, prune=False),
                   logGrid5Node10=exact_log_grid(spec, nodes=5),
                   logGrid10=exact_log_grid(spec), logGrid2=exact_log_grid(spec, step=2))
        if "boundary" in spec["id"]:
            row["unboundedReference"] = continuous_reference(spec, bounds=(-10000., 14000.))
        rows.append(row)
        print(f'{spec["id"]}: reference={ref["mean"]:.9f}; pruned={row["legacyPruned"]["mean"]:.9f}; '
              f'underflow-only={row["legacyUnpruned"]["mean"]:.9f}', flush=True)
    order_cases = [row for row in rows if row["id"] in
                   ["losses-then-wins-5000", "wins-then-losses-5000", "alternating-5000"]]
    assert all(abs(row["reference"]["mean"] - 1500) < 1e-7 for row in order_cases)
    assert all(abs(row["logGrid5Node10"]["mean"] - 1500) < 1e-7 for row in order_cases)
    output = dict(schemaVersion=1, scope="Numerical inference accuracy conditional on the fixed Davidson/Gaussian model; not predictive validation.",
                  referenceMethod="SciPy adaptive continuous outer integration of a log-space multiplicity posterior; 161-node normal opponent integration, converged from 81 and checked against adaptive integration.",
                  priorConvention="Every expanded game uses priorMean as rating; period inference seeds it once. Block order defines chronological order. All cases use one synthetic pool and rated games.",
                  boundedReferenceDomain=[-1000, 5000], unboundedReferenceDomain=[-10000, 14000],
                  unboundedReferenceMeaning="A wide-domain approximation to the untruncated normal prior; the listed finite bounds are numerically immaterial for these cases.",
                  precisionGoalRatingPoints=1e-5, cases=rows, likelihoodIntegration=integration_audit())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
