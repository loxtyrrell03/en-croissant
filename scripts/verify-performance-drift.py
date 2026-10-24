"""Independent continuous Gaussian-diffusion reference for ordinary histories.

Fourier heat evolution on a wide periodic domain, checked at two resolutions.
Fixtures keep posterior mass far from the boundary; this is NOT a reference
for rare tail recovery, for which the separate log-space stress oracle applies.
No application solver, profile, download or source dataset is used.
"""
from __future__ import annotations

import argparse
from functools import lru_cache
import json
from pathlib import Path
import numpy as np
from scipy.special import roots_hermitenorm
from scipy.integrate import cumulative_simpson

ROOT = Path(__file__).resolve().parents[1]
MODEL = dict(divisor=400., whiteAdvantage=0., logDraw=float(np.log(.2)), drawSlope=0.,
             priorSd=150., opponentSd=60., driftSdYear=90., step=10.)
YEAR = 365.25 * 86400


def fixture(name, n, gap, *, same_opponent=False, opponent_sd=60, model=None):
    return dict(id=name, priorMean=1812., model=model or MODEL,
                games=[dict(gapSeconds=0 if i == 0 else gap(i) if callable(gap) else gap,
                            opponentRating=1812. if same_opponent else 1750. + i * 4,
                            opponentSd=opponent_sd, score=[1, .5, 0, 1, 0][i % 5], white=i % 2 == 0)
                       for i in range(n)])


CASES = [
    fixture('daily-30', 30, 86400),
    fixture('minute-gaps-60', 60, 60, same_opponent=True, opponent_sd=0),
    fixture('one-second-gaps-1000', 1000, 1, same_opponent=True, opponent_sd=0),
    fixture('year-gaps-10', 10, YEAR, same_opponent=True),
    fixture('session-gaps-40', 40, lambda i: 8 * 3600 if i % 10 == 0 else 180),
    fixture('zero-drift-30', 30, 86400, model=dict(MODEL, driftSdYear=0.)),
]


def solve(spec, step):
    xs = np.arange(-2000., 6000., step)
    model = spec['model']
    nodes, weights = roots_hermitenorm(61)
    weights /= np.sqrt(2 * np.pi)
    p = np.exp(-.5 * ((xs - spec['priorMean']) / model['priorSd']) ** 2)
    p /= p.sum()
    frequencies = 2 * np.pi * np.fft.rfftfreq(len(xs), d=step)
    max_removed = 0.
    max_edge = 0.
    @lru_cache(maxsize=32)
    def likelihood(opponent, sd, white):
        # Build one result row at a time to bound transient array memory.
        if sd == 0:
            offsets, ws = np.array([0.]), np.array([1.])
        else:
            offsets, ws = nodes * sd, weights
        z = np.log(10) * (xs[:, None] - opponent - offsets[None, :]
                          + (1 if white else -1) * model['whiteAdvantage']) / model['divisor']
        d = model['logDraw'] + model['drawSlope'] * ((xs[:, None] + opponent + offsets[None, :]) / 2 - 2200) / 400 + z / 2
        norm = np.logaddexp(np.logaddexp(z, d), 0.)
        return np.stack([np.exp(z - norm) @ ws, np.exp(d - norm) @ ws, np.exp(-norm) @ ws], axis=1)
    def summary():
        mean = float(xs @ p)
        sd = float(np.sqrt((xs - mean) ** 2 @ p))
        cdf = cumulative_simpson(p, x=xs, initial=0)
        cdf /= cdf[-1]
        def quantile(q):
            i = int(np.searchsorted(cdf, q))
            ids = range(i - 2, i + 2)
            value = 0.
            for j in ids:
                weight = 1.
                for k in ids:
                    if j != k:
                        weight *= (q - cdf[k]) / (cdf[j] - cdf[k])
                value += weight * xs[j]
            return float(value)
        return dict(mean=mean, sd=sd, low=quantile(.025), high=quantile(.975))
    points = []
    for game in spec['games']:
        variance = model['driftSdYear'] ** 2 * game['gapSeconds'] / YEAR
        if variance:
            propagated = np.fft.irfft(np.fft.rfft(p) * np.exp(-.5 * variance * frequencies ** 2), n=len(xs))
            removed = float(-propagated[propagated < 0].sum())
            assert removed < 1e-12, 'Material Fourier roundoff; reference is not valid'
            max_removed = max(max_removed, removed)
            p = np.maximum(propagated, 0.)
            p /= p.sum()
        before = summary()['mean']
        probs = likelihood(game['opponentRating'], game['opponentSd'], game['white'])
        predictive = p @ probs
        idx = 0 if game['score'] == 1 else 1 if game['score'] == .5 else 2
        p *= probs[:, idx]
        p /= p.sum()
        edge = float(p[:int(100 / step)].sum() + p[-int(100 / step):].sum())
        max_edge = max(max_edge, edge)
        assert edge < 1e-12, 'Periodic domain boundary is material'
        points.append(dict(**summary(), before=before, predictive=predictive.tolist()))
    return points, dict(maxNegativeMassRemoved=max_removed, maxBoundary100PointMass=max_edge)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/'docs/benchmarks/performance-2026-10-02/drift-reference.json')
    args = parser.parse_args()
    cases = []
    for spec in CASES:
        fine, diagnostics = solve(spec, .125)
        coarse, _ = solve(spec, .25)
        differences = {key: max(abs(a[key] - b[key]) for a, b in zip(fine, coarse)) for key in ['mean', 'sd', 'low', 'high', 'before']}
        differences['predictive'] = max(max(abs(a-b) for a,b in zip(x['predictive'],y['predictive'])) for x,y in zip(fine,coarse))
        assert max(differences[k] for k in ['mean', 'sd', 'before']) < 1e-7, (spec['id'], differences)
        assert max(differences[k] for k in ['low', 'high']) < 1e-5, (spec['id'], differences)
        assert differences['predictive'] < 1e-9, (spec['id'], differences)
        cases.append(dict(**spec, points=fine, convergence=differences, diagnostics=diagnostics))
        print(spec['id'], json.dumps(dict(last=fine[-1], convergence=differences)), flush=True)
    output = dict(scope='Numerical chronological inference on bounded ordinary fixtures; not an empirical benchmark or a tail-support test.',
                  method='61-node opponent integration; spectral Gaussian heat evolution; Simpson CDF with local inverse cubic; 0.125-point grid converged from 0.25; domain [-2000,6000).',
                  cases=cases)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False)+'\n', encoding='utf8')


if __name__ == '__main__':
    main()
