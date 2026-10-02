import { describe, expect, it } from "vitest";
import { continuousLogSummary, logMidpointError, normalQuadrature } from "./performanceNumerics";
import { ONLINE_MODEL, strengthHistory } from "./truePerformance";

describe("continuous performance integration", () => {
    it.each([5.15075217798, 0.05])("integrates a Gaussian between mesh nodes at sd %s", sd => {
        const mean = 1812.375;
        const xs = Array.from({ length: 81 }, (_, i) => 1610 + 5 * i);
        const logs = xs.map(x => -0.5 * ((x - mean) / sd) ** 2 - 12000);
        const result = continuousLogSummary(xs, logs);
        expect(result.mean).toBeCloseTo(mean, 7);
        expect(result.sd).toBeCloseTo(sd, 7);
        expect(result.low).toBeCloseTo(mean - 1.959963984540054 * sd, 6);
        expect(result.high).toBeCloseTo(mean + 1.959963984540054 * sd, 6);
        expect(result.edgeMass).toBeLessThan(1e-12);
    });

    it("checks actual midpoint values rather than self-consistency of one polynomial", () => {
        const xs = Array.from({ length: 81 }, (_, i) => i - 40);
        const quadratic = xs.map(x => -x * x / 80);
        expect(logMidpointError(quadratic)).toBeLessThan(1e-14);
        const perturbed = quadratic.map((value, i) => value + (i % 2 ? .01 : 0));
        expect(logMidpointError(perturbed)).toBeGreaterThan(.009);
    });

    it.each([0.3, 0.86, 2.01])("normal quadrature integrates normal moments at spread %s", spread => {
        const [nodes, weights] = normalQuadrature(spread);
        expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 13);
        expect(nodes.reduce((sum, x, i) => sum + weights[i] * x, 0)).toBeCloseTo(0, 13);
        expect(nodes.reduce((sum, x, i) => sum + weights[i] * x * x, 0)).toBeCloseTo(1, 12);
        expect(nodes.reduce((sum, x, i) => sum + weights[i] * x ** 4, 0)).toBeCloseTo(3, 12);
    });

    it("rejects unresolved opponent uncertainty instead of silently using a capped quadrature", () => {
        expect(() => normalQuadrature(3)).toThrow("verified numerical integration range");
    });

    it("does not mistake an unseen narrow draw likelihood for negligible probability", () => {
        const game = { id: "narrow-draw", pool: "synthetic", at: 1700000000, rating: 1800,
            opponentRating: 1802.5, opponentSd: 0, white: true, score: 0 as const, opponent: "Synthetic", rated: true };
        const predictive = strengthHistory([game], Infinity,
            { ...ONLINE_MODEL, divisor: .05, driftSdYear: 0 }).points[0].predictive;
        // Independent SciPy adaptive integration, split around the narrow draw
        // peak in opponent-centered coordinates; no production interpolant.
        const expected = [.4933342003274413, .00003413958588906416, .5066316600866696];
        for (let i = 0; i < 3; i++) expect(Math.abs(predictive[i] - expected[i])).toBeLessThan(1e-7);
    }, 15000);
});
