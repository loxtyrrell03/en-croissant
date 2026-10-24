"""Independent reference: NumPy, 0.5-point grid, 61-node opponent integration.

Run with Python + NumPy. Does not import or reproduce the production grid solver.
These are numerical checks, not an empirical accuracy benchmark.
"""
import json
import numpy as np

nodes, weights = np.polynomial.hermite.hermgauss(61)
opponents = np.array([1480, 1520, 1495, 1470, 1510, 1530, 1490, 1505, 1520, 1500])
outcomes = [0, 2, 1, 0, 0, 2, 0, 0, 2, 0]  # win, loss, draw etc.
ratings = np.arange(-1000, 5000.5, 0.5)
log_p = -0.5 * ((ratings - 1500) / 150) ** 2
for opponent, outcome in zip(opponents, outcomes):
    delta = np.log(10) * (ratings[:, None] - opponent - np.sqrt(2) * 60 * nodes) / 400
    logits = np.stack([delta, np.log(0.2) + delta / 2, np.zeros_like(delta)])
    likelihoods = np.exp(logits - logits.max(axis=0))
    likelihoods /= likelihoods.sum(axis=0)
    marginal = likelihoods[outcome] @ (weights / np.sqrt(np.pi))
    log_p += np.log(marginal)
posterior = np.exp(log_p - log_p.max())
posterior /= posterior.sum()
mean = float(ratings @ posterior)
sd = float(np.sqrt(((ratings - mean) ** 2) @ posterior))
print(json.dumps({"mean": mean, "sd": sd, "opponentQuadrature": 61, "gridStep": 0.5}, indent=2))
assert abs(mean - 1576.834105637099) < 1e-8
assert abs(sd - 95.40198440150883) < 1e-8
