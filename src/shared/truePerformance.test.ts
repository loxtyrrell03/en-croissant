import { describe, it, expect } from "vitest";
import continuousReference from "../../docs/benchmarks/performance-2026-10-02/numerical-reference.json";
import {
    strengthHistory,
    periodPerformanceHistory,
    selectResultPeriod,
    periodPerformance,
    outcomeProbabilities,
    ONLINE_MODEL,
    CLASSICAL_RESEARCH_MODEL,
    selectPerformancePeriod,
    type PerformanceGame,
} from "./truePerformance";
const sample = (n = 30): PerformanceGame[] =>
    Array.from({ length: n }, (_, i) => ({
        id: String(i).padStart(4, "0"),
        pool: "chesscom:test:blitz",
        at: 1700000000 + i * 86400,
        rating: 1800,
        opponentRating: 1750 + i * 4,
        score: ([1, 0.5, 0, 1, 1] as const)[i % 5],
        white: i % 2 === 0,
        opponent: "rival",
        rated: true,
    }));
function referenceGames(spec: (typeof continuousReference.cases)[number]): PerformanceGame[] {
    const games: PerformanceGame[] = [];
    for (const block of spec.blocks) for (let repeat = 0; repeat < block.repeat; repeat++) {
        for (const game of block.pattern) {
            const i = games.length;
            games.push({ ...game, score: game.score as 0 | 0.5 | 1, id: String(i).padStart(6, "0"),
                pool: "synthetic:blitz", at: 1700000000 + i, rating: spec.priorMean,
                opponent: "Synthetic opponent", rated: true });
        }
    }
    return games;
}
describe("Bayesian result model", () => {
    it("gives the same period posterior after reordering a long run of identical evidence", () => {
        const lossesFirst = sample(200).map((g, i) => ({
            ...g, rating: 1500, opponentRating: 1800, score: i < 100 ? 0 as const : 1 as const,
        }));
        const winsFirst = lossesFirst.map((g) => ({ ...g, score: (1 - g.score) as 0 | 1 }));
        const model = { ...ONLINE_MODEL, opponentSd: 0, driftSdYear: 0 };
        const a = periodPerformance(lossesFirst, model)!, b = periodPerformance(winsFirst, model)!;
        expect(a.mean).toBeCloseTo(b.mean, 8);
        expect(a.sd).toBeCloseTo(b.sd, 8);
        expect(a.low).toBeCloseTo(b.low, 8);
        expect(a.high).toBeCloseTo(b.high, 8);
        // Independent SciPy continuous_reference, known opponents (not a grid target).
        expect(Math.abs(a.mean - 1791.3614164542003)).toBeLessThan(0.001);
        expect(strengthHistory(lossesFirst, Infinity, model).points.at(-1)?.mean).toBeCloseTo(a.mean, 9);
    });
    it("allows strong accumulated evidence to recover a previously negligible prior tail", () => {
        const games = sample(100).map((g) => ({
            ...g, rating: 1500, opponentRating: 2500, score: 1 as const,
        }));
        const model = { ...ONLINE_MODEL, opponentSd: 0 };
        // Independent SciPy continuous_reference on [-10000, 14000].
        expect(Math.abs(periodPerformance(games, model)!.mean - 2914.4828598108725)).toBeLessThan(0.001);
    });
    it("retains prior and result evidence even when their probabilities underflow", () => {
        const games = sample(3).map((g) => ({
            ...g, rating: 0, opponentRating: 4000, score: 1 as const,
        }));
        const estimate = periodPerformance(games, { ...ONLINE_MODEL, divisor: 1, opponentSd: 0, priorSd: 50 })!;
        expect(estimate.mean).toBeGreaterThan(3900);
        expect(Number.isFinite(estimate.sd)).toBe(true);
        expect(estimate.edgeMass).toBeLessThan(1e-8);
    });
    it("preserves recoverable tails through nonzero chronological diffusion", () => {
        const games = sample(200).map((g, i) => ({
            ...g, rating: 1500, opponentRating: 1800, score: i < 100 ? 0 as const : 1 as const,
        }));
        const model = { ...ONLINE_MODEL, opponentSd: 0, driftSdYear: 1e-4 };
        const point = strengthHistory(games, Infinity, model).points.at(-1)!;
        expect(point.mean).toBeCloseTo(periodPerformance(games, model)!.mean, 5);
        expect(point.predictive.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    });
    it("matches an independent 61-node, half-point-grid reference", () => {
        const opponents = [1480, 1520, 1495, 1470, 1510, 1530, 1490, 1505, 1520, 1500];
        const scores = [1, 0, 0.5, 1, 1, 0, 1, 1, 0, 1] as const;
        const estimate = periodPerformance(sample(10).map((g, i) => ({ ...g, rating: 1500, opponentRating: opponents[i], score: scores[i] })))!;
        expect(estimate.mean).toBeCloseTo(1576.834105637099, 3);
        expect(estimate.sd).toBeCloseTo(95.40198440150883, 3);
    });
    it("normalises proper three-outcome likelihoods at extreme ratings and with rating-dependent draws", () => {
        for (const m of [ONLINE_MODEL, CLASSICAL_RESEARCH_MODEL])
            for (const r of [-1000, 1900, 5000]) {
                const p = outcomeProbabilities(r, 1900, true, m);
                expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
                expect(p.every((v) => v > 0)).toBe(true);
            }
    });
    it("is invariant under colour/rating reflection when no colour/level effect is assumed", () => {
        const a = outcomeProbabilities(1900, 1800, true),
            b = outcomeProbabilities(1800, 1900, false);
        expect(a[0]).toBeCloseTo(b[2], 12);
        expect(a[1]).toBeCloseTo(b[1], 12);
    });
    it("agrees with a five-times-finer numerical posterior", () => {
        const a = periodPerformance(sample())!,
            b = periodPerformance(sample(), { ...ONLINE_MODEL, step: 2 })!;
        expect(Math.abs(a.mean - b.mean)).toBeLessThan(0.15);
        expect(Math.abs(a.low - b.low)).toBeLessThan(0.5);
        expect(a.edgeMass).toBeLessThan(1e-8);
    });
    it("keeps all earlier predictions identical after future results and ratings are appended", () => {
        const games = sample(),
            a = strengthHistory(games.slice(0, 20)),
            b = strengthHistory([
                ...games,
                { ...games[0], id: "future", at: 1900000000, rating: 3500 },
            ]);
        expect(b.points.slice(0, 20)).toEqual(a.points);
        expect(strengthHistory(games, games[19].at).points).toEqual(a.points);
    });
    it("uses each game once, excludes unrated/future/bad data, and rejects mixed pools", () => {
        const g = sample(5);
        const a = strengthHistory([
            ...g,
            g[0],
            { ...g[0], id: "casual", rated: false },
            { ...g[0], id: "bad", opponentRating: null },
        ]);
        expect(a.games).toHaveLength(5);
        expect(a.excluded).toBe(3);
        expect(() => strengthHistory([...g, { ...g[0], pool: "lichess:test:blitz" }])).toThrow(
            "one account",
        );
    });
    it("wins raise strength, losses lower it, and draws do not mean half a win probability", () => {
        const g = sample(1)[0];
        const a = strengthHistory([{ ...g, score: 1 }]).points[0],
            b = strengthHistory([{ ...g, score: 0 }]).points[0];
        expect(a.mean).toBeGreaterThan(a.before);
        expect(b.mean).toBeLessThan(b.before);
        expect(a.predictive.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
    });
    it("uses chronological last-N and does not seed an early game with a future rating", () => {
        const g = sample();
        expect(selectPerformancePeriod(g.toReversed(), "20g", Infinity)).toHaveLength(20);
        const h = strengthHistory(g.map((v, i) => ({ ...v, rating: i < 3 ? null : v.rating })));
        expect(h.points[0].id).toBe("0003");
        expect(h.excluded).toBe(3);
        expect(periodPerformance(g.slice(0, 2))).toBeNull();
    });
    it("inactivity increases predictive uncertainty without introducing directional drift", () => {
        const g = sample(3);
        const quick = strengthHistory(g).points[2],
            slow = strengthHistory([...g.slice(0, 2), { ...g[2], at: g[2].at + 365 * 86400 }])
                .points[2];
        expect(slow.sd).toBeGreaterThan(quick.sd);
    });
});

it("uses the requested game type through both strength and period estimates", () => {
    const games = Array.from({length: 6}, (_, i) => ({id: String(i), pool: "alice:blitz", at: 1700000000 + i, rating: 1800, opponentRating: 1800, score: 1 as const, white: true, opponent: "Bob", rated: i < 3}));
    expect(strengthHistory(games).games.length).toBe(3);
    const casual = strengthHistory(games, Infinity, undefined, "unrated");
    expect(casual.games.map(g => g.id)).toEqual(["3", "4", "5"]);
    expect(casual.points.length).toBe(3);
    expect(selectPerformancePeriod(casual.games, "20g", 1700000010, "unrated").length).toBe(3);
    expect(periodPerformance(casual.games, undefined, "unrated")).not.toBeNull();
    expect(strengthHistory(games, Infinity, undefined, "both").points.length).toBe(6);
});

it("the graph ends at the selected-game headline without borrowing earlier games", () => {
    const games = sample(40), selected = games.slice(-20);
    const points = periodPerformanceHistory(selected);
    expect(points).toHaveLength(20);
    expect(points.at(-1)?.mean).toBeCloseTo(periodPerformance(selected)!.mean, 10);
});

describe("continuous period inference", () => {
    it.each(continuousReference.cases)("matches all four independent continuous summaries: $id", (spec) => {
        const estimate = periodPerformance(referenceGames(spec), spec.model)!;
        const expected = spec.unboundedReference ?? spec.reference;
        for (const key of ["mean", "sd", "low", "high"] as const)
            expect(Math.abs(estimate[key] - expected[key]), `${spec.id} ${key}`).toBeLessThan(0.001);
    }, 30000);

    it("keeps narrow intervals independent of a rating's position between mesh nodes", () => {
        const fixture = continuousReference.cases.find(c => c.id === "subcell-1812-no-opponent-uncertainty-5000")!;
        const expected = fixture.reference;
        for (const center of [1800, 1800.125, 1801, 1802, 1803, 1804, 1805, 1806, 1807, 1808, 1809, 1809.875, 1810]) {
            const games = referenceGames(fixture).map(g => ({ ...g, rating: center, opponentRating: center }));
            const estimate = periodPerformance(games, fixture.model)!;
            expect(Math.abs(estimate.mean - center)).toBeLessThan(0.001);
            expect(Math.abs(estimate.sd - expected.sd)).toBeLessThan(0.001);
            expect(Math.abs(estimate.low - (expected.low + center - 1812))).toBeLessThan(0.001);
            expect(Math.abs(estimate.high - (expected.high + center - 1812))).toBeLessThan(0.001);
        }
    }, 30000);

    it("resolves a sharp posterior between coarse nodes without smearing the interval", () => {
        const center = 1803.375;
        const games = sample(200).map((g, i) => ({ ...g, rating: center, opponentRating: center,
            opponentSd: 0, score: i % 2 ? 0 as const : 1 as const }));
        const model = { ...ONLINE_MODEL, divisor: 2, opponentSd: 0, driftSdYear: 0 };
        const a = periodPerformance(games, model)!;
        const b = periodPerformance(games, { ...model, step: 1 })!;
        // SciPy adaptive integration, independently cross-checked by Simpson in the acceptance script.
        const expected = { mean: 1803.375, sd: 0.1291390418171221,
            low: 1803.1218079560026, high: 1803.6281920439976 };
        for (const key of ["mean", "sd", "low", "high"] as const) {
            expect(Math.abs(a[key] - expected[key])).toBeLessThan(0.001);
            expect(Math.abs(a[key] - b[key])).toBeLessThan(0.001);
        }
    });

    it("integrates zero-drift predictions over the resolved posterior, not the coarse support mesh", () => {
        const center = 1803.375;
        const games = sample(201).map((g, i) => ({ ...g, rating: center,
            opponentRating: i < 200 ? center : center + 0.2, opponentSd: 0,
            score: i % 2 ? 1 as const : 0 as const }));
        const model = { ...ONLINE_MODEL, divisor: 2, opponentSd: 0, driftSdYear: 0 };
        const point = strengthHistory(games, Infinity, model).points.at(-1)!;
        // Direct SciPy integration of the exact 200-game posterior times each next-result likelihood.
        const expected = [0.403039035233027, 0.09014366172295583, 0.5068173030440171];
        for (let k = 0; k < 3; k++) expect(Math.abs(point.predictive[k] - expected[k])).toBeLessThan(1e-6);
    });

    it("keeps zero-drift prefix points identical when later evidence expands the domain", () => {
        const spec = continuousReference.cases.find(c => c.id === "upper-grid-boundary-5000")!;
        const games = referenceGames(spec).slice(0, 1500);
        const early = strengthHistory(games.slice(0, 20), Infinity, spec.model).points;
        const later = strengthHistory(games, Infinity, spec.model).points;
        expect(later.slice(0, 20)).toEqual(early);
        expect(later.at(-1)!.mean).toBeGreaterThan(5000);
        const headline = periodPerformance(games, spec.model)!;
        for (const key of ["mean", "sd", "low", "high"] as const)
            expect(Math.abs(later.at(-1)![key] - headline[key])).toBeLessThan(0.001);
    }, 30000);

    it("can reverse a boundary-crossing streak without permanently discarding the original domain", () => {
        const spec = continuousReference.cases.find(c => c.id === "upper-grid-boundary-5000")!;
        const games = referenceGames(spec).map((g, i) => ({ ...g, score: i < 2500 ? 1 as const : 0 as const }));
        const reversed = games.map(g => ({ ...g, score: (1 - g.score) as 0 | 1 }));
        const a = periodPerformance(games, spec.model)!, b = periodPerformance(reversed, spec.model)!;
        expect(Math.abs(a.mean - 4000)).toBeLessThan(0.001);
        for (const key of ["mean", "sd", "low", "high"] as const)
            expect(Math.abs(a[key] - b[key])).toBeLessThan(0.001);
        const history = strengthHistory(games, Infinity, spec.model).points;
        expect(history[2499].mean).toBeGreaterThan(5000);
        for (const key of ["mean", "sd", "low", "high"] as const)
            expect(Math.abs(history.at(-1)![key] - a[key])).toBeLessThan(0.001);
    }, 30000);
});
it("the period graph and headline agree after a long loss and recovery sequence", () => {
    const games = sample(200).map((g, i) => ({
        ...g, rating: 1500, opponentRating: 1800, score: i < 100 ? 0 as const : 1 as const,
    }));
    const point = periodPerformanceHistory(games).at(-1)!, estimate = periodPerformance(games)!;
    expect(point.mean).toBeCloseTo(estimate.mean, 10);
    expect(point.low).toBeCloseTo(estimate.low, 10);
    expect(point.high).toBeCloseTo(estimate.high, 10);
});
it("counts completed games with missing ratings in results, but not the estimate", () => {
    const games = sample(5); games[3] = {...games[3], opponentRating:null};
    const selected = selectResultPeriod(games, "all", Infinity);
    expect(selected).toHaveLength(5);
    expect(periodPerformanceHistory(selected)).toHaveLength(4);
    expect(periodPerformanceHistory(selected).at(-1)?.mean).toBeCloseTo(periodPerformance(selected)!.mean, 10);
});
