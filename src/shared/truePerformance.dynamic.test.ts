import { describe, expect, it } from "vitest";
import reference from "../../docs/benchmarks/performance-2026-10-02/dynamic-extension-reference.json";
import { ONLINE_MODEL, strengthHistory, type PerformanceGame } from "./truePerformance";

type ReferenceCase = (typeof reference.cases)[number];
const summaryFields = ["mean", "sd", "low", "high", "before"] as const;

function gamesFor(spec: ReferenceCase): PerformanceGame[] {
    let at = 1700000000;
    return spec.games.map((game, i) => ({
        ...game,
        score: game.score as 0 | 0.5 | 1,
        id: String(i).padStart(6, "0"),
        pool: "synthetic:blitz",
        at: at += game.gapSeconds,
        rating: spec.priorMean,
        opponent: "Synthetic opponent",
        rated: true,
    }));
}

describe("independent continuous dynamic references", () => {
    // Seven analytic Gaussian cases plus two positive, log-domain full-convolution
    // references. The generator has independent grid/domain convergence checks.
    for (const spec of reference.cases) {
        it(`matches the unbounded reference: ${spec.id}`, () => {
            const points = strengthHistory(gamesFor(spec), Infinity, spec.model).points;
            expect(points).toHaveLength(spec.points.length);
            for (let i = 0; i < points.length; i++) {
                for (const field of summaryFields) {
                    expect(Math.abs(points[i][field] - spec.points[i][field]), `${spec.id} point ${i} ${field}`)
                        .toBeLessThan(0.001);
                }
                for (let k = 0; k < 3; k++) {
                    expect(Math.abs(points[i].predictive[k] - spec.points[i].predictive[k]), `${spec.id} point ${i} outcome ${k}`)
                        .toBeLessThan(1e-6);
                }
                expect(points[i].predictive.every(p => Number.isFinite(p) && p >= 0 && p <= 1)).toBe(true);
                expect(points[i].predictive.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
            }
        }, 120000);
    }

    it("preserves old points when future evidence requires distant posterior support", () => {
        const spec = reference.cases.find(item => item.id === "rare-tail-drift-reversal")!;
        const games = gamesFor(spec);
        const prefix = strengthHistory(games.slice(0, 20), Infinity, spec.model).points;
        const complete = strengthHistory(games, Infinity, spec.model).points;
        expect(complete.slice(0, 20)).toEqual(prefix);
        const cutoff = games[19].at;
        expect(strengthHistory(games, cutoff, spec.model).points)
            .toEqual(strengthHistory(games.filter(game => game.at <= cutoff), Infinity, spec.model).points);
    }, 120000);

    it("depends on total elapsed time when intervening observations contain no information", () => {
        const cases = reference.cases.filter(item => [
            "gaussian-concentrated-4h", "gaussian-concentrated-two-2h", "gaussian-concentrated-four-1h",
        ].includes(item.id));
        const ends = cases.map(spec => strengthHistory(gamesFor(spec), Infinity, spec.model).points.at(-1)!);
        for (const field of summaryFields) {
            expect(Math.max(...ends.map(point => point[field])) - Math.min(...ends.map(point => point[field])))
                .toBeLessThan(0.001);
        }
    });

    it("approaches the accepted constant-strength posterior as drift tends to zero", () => {
        const spec = reference.cases.find(item => item.id === "rare-tail-drift-reversal")!;
        const games = gamesFor(spec).slice(0, 100).map((game, i) => ({ ...game, at: 1700000000 + 60 * i }));
        const near = strengthHistory(games, Infinity, { ...spec.model, driftSdYear: 1e-6 }).points;
        const zero = strengthHistory(games, Infinity, { ...spec.model, driftSdYear: 0 }).points;
        for (let i = 0; i < near.length; i++) {
            for (const field of summaryFields) expect(Math.abs(near[i][field] - zero[i][field])).toBeLessThan(0.001);
            for (let k = 0; k < 3; k++) expect(Math.abs(near[i].predictive[k] - zero[i].predictive[k])).toBeLessThan(1e-6);
        }
    }, 120000);

    it("updates from observed draws whose predictive probabilities underflow", () => {
        const mean = 4000, sd = 50, slope = Math.LN10 / 20;
        const model = { ...ONLINE_MODEL, priorSd: sd, opponentSd: 1, divisor: 20,
            logDraw: -730.25, drawSlope: 0, driftSdYear: 90 };
        const games: PerformanceGame[] = Array.from({ length: 3 }, (_, i) => ({
            id: String(i), pool: "synthetic:blitz", at: 1700000000,
            rating: mean, opponentRating: 0, opponentSd: 1, score: .5,
            white: true, opponent: "Synthetic opponent", rated: true,
        }));
        const points = strengthHistory(games, Infinity, model).points;
        expect(points).toHaveLength(3);
        // Throughout the material Gaussian support, the win term dominates
        // the Davidson denominator to machine precision. Each draw therefore
        // multiplies the prior by exp(-slope * rating / 2), up to a constant.
        // Gaussian opponent integration changes only that constant. With no
        // elapsed time, each update shifts the mean and leaves variance intact.
        const shift = slope * sd * sd / 2, halfWidth = 1.959963984540054 * sd;
        for (let i = 0; i < points.length; i++) {
            const point = points[i], expectedMean = mean - (i + 1) * shift;
            for (const field of summaryFields) expect(Number.isFinite(point[field])).toBe(true);
            expect(Math.abs(point.mean - expectedMean)).toBeLessThan(.001);
            expect(Math.abs(point.before - (mean - i * shift))).toBeLessThan(.001);
            expect(Math.abs(point.sd - sd)).toBeLessThan(.001);
            expect(Math.abs(point.low - (expectedMean - halfWidth))).toBeLessThan(.001);
            expect(Math.abs(point.high - (expectedMean + halfWidth))).toBeLessThan(.001);
            expect(point.predictive.every(p => Number.isFinite(p) && p >= 0 && p <= 1)).toBe(true);
            expect(point.predictive.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
        }
    });

    it.each([
        { name: "rare sharp observed draw", centre: 1802.375, opponent: 2202.375, divisor: 5 },
        { name: "remote observed win requiring more support", centre: 0, opponent: 4000, divisor: 10 },
    ])("does not use the current result to choose its forecast: $name", ({ centre, opponent, divisor }) => {
        const model = { ...ONLINE_MODEL, priorSd: 50, opponentSd: 0, divisor };
        const first: PerformanceGame = { id: "first", pool: "synthetic:blitz", at: 1700000000,
            rating: centre, opponentRating: 0, opponentSd: 0, score: 1, white: true,
            opponent: "Known synthetic opponent", rated: true };
        const forecasts = ([1, .5, 0] as const).map(score => strengthHistory([
            first, { ...first, id: "current", at: first.at + 4 * 3600, opponentRating: opponent, score },
        ], Infinity, model).points[1]);
        for (const point of forecasts.slice(1)) {
            expect(point.before).toBe(forecasts[0].before);
            expect(point.predictive).toEqual(forecasts[0].predictive);
        }
        expect(forecasts[0].predictive[1]).toBeLessThan(Math.exp(-30));
    }, 120000);
});
