/** Original, dependency-free result model shared with En Croissant.
 * Bayes updates on a rating grid; posterior mean minimises posterior squared
 * error. Predictive probabilities integrate both players' uncertainty. This is
 * numerical inference under an explicit model, not a universal optimum.
 */
export const TRUE_PERFORMANCE_VERSION = "bayes-grid-v1";
export interface PerformanceGame {
    id: string;
    pool: string;
    at: number; // Unix seconds, completed games only
    rating: number | null; // PRE-GAME account rating, never a present-day profile
    opponentRating: number | null;
    opponentSd?: number;
    score: 0 | 0.5 | 1;
    white: boolean;
    opponent: string;
    rated: boolean;
    url?: string;
    opening?: string;
}
export interface PerformanceModel {
    divisor: number;
    whiteAdvantage: number;
    logDraw: number;
    drawSlope: number;
    priorSd: number;
    opponentSd: number;
    driftSdYear: number;
    step: number;
}
// Online defaults are transparent modelling assumptions, NOT fitted FIDE values.
export const ONLINE_MODEL: PerformanceModel = {
    divisor: 400,
    whiteAdvantage: 0,
    logDraw: Math.log(0.2),
    drawSlope: 0,
    priorSd: 150,
    opponentSd: 60,
    driftSdYear: 90,
    step: 10,
};
export const CLASSICAL_RESEARCH_MODEL: PerformanceModel = {
    divisor: 515.0649349802578,
    whiteAdvantage: 41.66589900576382,
    logDraw: -0.5997864078272523,
    drawSlope: 0.22517300423037162,
    priorSd: 110,
    opponentSd: 60,
    driftSdYear: 90,
    step: 10,
};
export interface StrengthEstimate {
    mean: number;
    sd: number;
    low: number;
    high: number;
    edgeMass: number;
}
export interface StrengthPoint extends StrengthEstimate {
    id: string;
    at: number;
    before: number;
    rating: number | null;
    predictive: [number, number, number]; // win, draw, loss before result
}
export interface StrengthHistory {
    games: PerformanceGame[];
    points: StrengthPoint[];
    excluded: number;
    model: PerformanceModel;
    pool: string | null;
}
const MIN_R = -1000,
    MAX_R = 5000;
const finiteRating = (v: number | null): v is number =>
    v !== null && Number.isFinite(v) && v >= 0 && v <= 4000;
const GH = [-2.8569700138728056, -1.355626179974266, 0, 1.355626179974266, 2.8569700138728056];
const GW = [
    0.0112574113277207, 0.2220759220056126, 0.5333333333333333, 0.2220759220056126,
    0.0112574113277207,
];

/** Stable proper Davidson likelihood, including its strength-dependent draw term. */
export function outcomeProbabilities(
    rating: number,
    opponent: number,
    white: boolean,
    model = ONLINE_MODEL,
): [number, number, number] {
    const z =
        (Math.LN10 * (rating - opponent + (white ? 1 : -1) * model.whiteAdvantage)) / model.divisor;
    const draw = model.logDraw + (model.drawSlope * ((rating + opponent) / 2 - 2200)) / 400 + z / 2;
    const max = Math.max(z, draw, 0);
    const a = Math.exp(z - max),
        d = Math.exp(draw - max),
        b = Math.exp(-max),
        sum = a + d + b;
    return [a / sum, d / sum, b / sum];
}
function likelihood(
    r: number,
    game: PerformanceGame,
    model: PerformanceModel,
): [number, number, number] {
    const sum: [number, number, number] = [0, 0, 0];
    const sd = game.opponentSd ?? model.opponentSd;
    for (let i = 0; i < GH.length; i++) {
        const p = outcomeProbabilities(r, game.opponentRating! + GH[i] * sd, game.white, model);
        for (let k = 0; k < 3; k++) sum[k] += GW[i] * p[k];
    }
    return sum;
}
function grid(model: PerformanceModel) {
    if (
        !Number.isFinite(model.step) ||
        model.step < 1 ||
        model.step > 25 ||
        !Number.isFinite(model.priorSd) ||
        model.priorSd <= 0 ||
        !Number.isFinite(model.divisor) ||
        model.divisor <= 0 ||
        !Number.isFinite(model.opponentSd) ||
        model.opponentSd < 0 ||
        !Number.isFinite(model.driftSdYear) ||
        model.driftSdYear < 0 ||
        !Number.isFinite(model.whiteAdvantage) ||
        !Number.isFinite(model.logDraw) ||
        !Number.isFinite(model.drawSlope)
    )
        throw new Error("Invalid performance model");
    return Array.from(
        { length: Math.floor((MAX_R - MIN_R) / model.step) + 1 },
        (_, i) => MIN_R + i * model.step,
    );
}
function normalise(p: number[]) {
    const sum = p.reduce((s, v) => s + v, 0);
    if (!(sum > 0) || !Number.isFinite(sum))
        throw new Error("Performance posterior could not be normalised");
    return p.map((v) => v / sum);
}
function prior(xs: number[], mean: number, sd: number) {
    return normalise(xs.map((x) => Math.exp(-0.5 * ((x - mean) / sd) ** 2)));
}
function summary(xs: number[], p: number[]): StrengthEstimate {
    const mean = p.reduce((s, v, i) => s + v * xs[i], 0);
    const variance = p.reduce((s, v, i) => s + v * (xs[i] - mean) ** 2, 0);
    const quantile = (q: number) => {
        let c = 0;
        for (let i = 0; i < p.length; i++) {
            const last = c;
            c += p[i];
            if (c >= q) return xs[i] + ((q - last) / p[i] - 0.5) * (xs[1] - xs[0]);
        }
        return xs[xs.length - 1];
    };
    return {
        mean,
        sd: Math.sqrt(variance),
        low: quantile(0.025),
        high: quantile(0.975),
        edgeMass: p[0] + p[p.length - 1],
    };
}
function diffuse(p: number[], variance: number, step: number) {
    if (variance <= 0) return p;
    // Sub-cell diffusion preserves variance rather than losing short time gaps.
    let kernel: number[];
    if (variance < step * step) {
        const side = variance / (2 * step * step);
        kernel = [side, 1 - 2 * side, side];
    } else {
        const radius = Math.min(p.length - 1, Math.ceil((5 * Math.sqrt(variance)) / step));
        kernel = normalise(
            Array.from({ length: radius * 2 + 1 }, (_, i) =>
                Math.exp((-0.5 * ((i - radius) * step) ** 2) / variance),
            ),
        );
    }
    const radius = (kernel.length - 1) / 2,
        out = p.map(() => 0);
    for (let i = 0; i < p.length; i++)
        if (p[i] > 1e-15)
            for (let j = 0; j < kernel.length; j++) {
                const k = i + j - radius;
                if (k >= 0 && k < p.length) out[k] += p[i] * kernel[j];
            }
    return normalise(out);
}
function update(xs: number[], p: number[], game: PerformanceGame, model: PerformanceModel) {
    const predictive: [number, number, number] = [0, 0, 0],
        next = p.map(() => 0);
    const result = game.score === 1 ? 0 : game.score === 0.5 ? 1 : 2;
    for (let i = 0; i < xs.length; i++)
        if (p[i] > 1e-15) {
            const probs = likelihood(xs[i], game, model);
            next[i] = p[i] * probs[result];
            for (let k = 0; k < 3; k++) predictive[k] += p[i] * probs[k];
        }
    return { posterior: normalise(next), predictive };
}
export type PerformanceGameType = "rated" | "unrated" | "both";
export function matchesGameType(rated: boolean, gameType: PerformanceGameType) {
    return gameType === "both" || rated === (gameType === "rated");
}
export function preparePerformanceGames(input: readonly PerformanceGame[], asOf = Infinity, gameType: PerformanceGameType = "rated") {
    const seen = new Set<string>();
    return input
        .filter((g) => {
            if (
                !matchesGameType(g.rated, gameType) ||
                !Number.isFinite(g.at) ||
                g.at <= 0 ||
                g.at > asOf ||
                !finiteRating(g.opponentRating) ||
                ![0, 0.5, 1].includes(g.score) ||
                !g.pool ||
                !g.id ||
                (g.opponentSd !== undefined && (!Number.isFinite(g.opponentSd) || g.opponentSd < 0))
            )
                return false;
            const key = `${g.pool}:${g.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
export function strengthHistory(
    input: readonly PerformanceGame[],
    asOf = Infinity,
    model = ONLINE_MODEL,
    gameType: PerformanceGameType = "rated",
): StrengthHistory {
    const games = preparePerformanceGames(input, asOf, gameType),
        xs = grid(model);
    const pool = games[0]?.pool ?? null;
    if (games.some((g) => g.pool !== pool))
        throw new Error("Choose one account and time control for performance estimates");
    // Never seed an earlier position with a later known rating.
    const first = games.findIndex((g) => finiteRating(g.rating));
    if (first < 0) return { games: [], points: [], excluded: input.length, model, pool };
    const usable = games.slice(first),
        points: StrengthPoint[] = [];
    let p = prior(xs, usable[0].rating!, model.priorSd),
        last = usable[0].at;
    for (const game of usable) {
        p = diffuse(p, (model.driftSdYear ** 2 * (game.at - last)) / (365.25 * 86400), model.step);
        const before = summary(xs, p).mean;
        const updated = update(xs, p, game, model);
        p = updated.posterior;
        points.push({
            ...summary(xs, p),
            id: game.id,
            at: game.at,
            before,
            rating: game.rating,
            predictive: updated.predictive,
        });
        last = game.at;
    }
    return { games: usable, points, excluded: input.length - usable.length, model, pool };
}
/** A constant performance during the selected games, with one pre-period prior.
 * Each selected game contributes once; there is no arbitrary recency weighting.
 */
export function periodPerformance(
    input: readonly PerformanceGame[],
    model = ONLINE_MODEL,
    gameType: PerformanceGameType = "rated",
): StrengthEstimate | null {
    const games = preparePerformanceGames(input, Infinity, gameType);
    if (games.length < 3 || !finiteRating(games[0].rating)) return null;
    if (games.some((g) => g.pool !== games[0].pool)) throw new Error("Mixed rating pools");
    const xs = grid(model);
    let p = prior(xs, games[0].rating, model.priorSd);
    for (const game of games) p = update(xs, p, game, model).posterior;
    return summary(xs, p);
}
export type PerformancePeriod = "7d" | "30d" | "90d" | "1y" | "all" | "20g" | "50g" | "100g";
export const PERFORMANCE_PERIODS: [PerformancePeriod, string][] = [
    ["7d", "7 days"],
    ["30d", "30 days"],
    ["90d", "90 days"],
    ["1y", "1 year"],
    ["all", "All loaded games"],
    ["20g", "Last 20 games"],
    ["50g", "Last 50 games"],
    ["100g", "Last 100 games"],
];
export function selectPerformancePeriod(
    games: readonly PerformanceGame[],
    period: PerformancePeriod,
    asOf: number,
    gameType: PerformanceGameType = "rated",
) {
    const ordered = preparePerformanceGames(games, asOf, gameType);
    if (period === "all") return ordered;
    if (period.endsWith("g")) return ordered.slice(-parseInt(period));
    const days = period === "1y" ? 365 : parseInt(period);
    return ordered.filter((g) => g.at >= asOf - days * 86400);
}


/** Completed results stay visible even when rating evidence is missing. */
export function selectResultPeriod(input: readonly PerformanceGame[], period: PerformancePeriod, asOf: number, gameType: PerformanceGameType = "rated") {
    const seen = new Set<string>();
    const ordered = input.filter(g => {
        if (!g.id || !g.pool || !Number.isFinite(g.at) || g.at <= 0 || g.at > asOf || ![0, 0.5, 1].includes(g.score) || !matchesGameType(g.rated, gameType)) return false;
        const key = `${g.pool}:${g.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a,b) => a.at-b.at || a.id.localeCompare(b.id));
    if (period === "all") return ordered;
    if (period.endsWith("g")) return ordered.slice(-parseInt(period));
    const days = period === "1y" ? 365 : parseInt(period);
    return ordered.filter(g => g.at >= asOf-days*86400);
}

/** One pass through the selected sample; the final point equals periodPerformance. */
export function periodPerformanceHistory(input: readonly PerformanceGame[], asOf = Infinity, gameType: PerformanceGameType = "rated"): StrengthPoint[] {
    const games = preparePerformanceGames(input, asOf, gameType);
    if (games.length < 3 || !finiteRating(games[0].rating)) return [];
    return strengthHistory(games, asOf, { ...ONLINE_MODEL, driftSdYear: 0 }, gameType).points;
}
