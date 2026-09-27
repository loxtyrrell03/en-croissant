import { describe, it, expect } from "vitest";
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
describe("Bayesian result model", () => {
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
it("counts completed games with missing ratings in results, but not the estimate", () => {
    const games = sample(5); games[3] = {...games[3], opponentRating:null};
    const selected = selectResultPeriod(games, "all", Infinity);
    expect(selected).toHaveLength(5);
    expect(periodPerformanceHistory(selected)).toHaveLength(4);
    expect(periodPerformanceHistory(selected).at(-1)?.mean).toBeCloseTo(periodPerformance(selected)!.mean, 10);
});
