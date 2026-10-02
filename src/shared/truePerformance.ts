/** Original, dependency-free result model shared with En Croissant.
 * Bayes updates on a rating grid; posterior mean minimises posterior squared
 * error. Predictive probabilities integrate both players' uncertainty. This is
 * numerical inference under an explicit model, not a universal optimum.
 */
import { continuousLogSummary, logMidpointError, normalQuadrature } from "./performanceNumerics";
import { gaussianLogConvolution } from "./performanceDynamics";

export const TRUE_PERFORMANCE_VERSION = "bayes-continuous-v4-dual-domain";
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

/** Stable proper Davidson likelihood, including its strength-dependent draw term. */
export function outcomeProbabilities(
    rating: number,
    opponent: number,
    white: boolean,
    model = ONLINE_MODEL,
): [number, number, number] {
    const log = logOutcomeProbabilities(rating, opponent, white, model);
    return [Math.exp(log[0]), Math.exp(log[1]), Math.exp(log[2])];
}
function logOutcomeProbabilities(
    rating: number,
    opponent: number,
    white: boolean,
    model: PerformanceModel,
): [number, number, number] {
    const z =
        (Math.LN10 * (rating - opponent + (white ? 1 : -1) * model.whiteAdvantage)) / model.divisor;
    const draw = model.logDraw + (model.drawSlope * ((rating + opponent) / 2 - 2200)) / 400 + z / 2;
    const max = Math.max(z, draw, 0);
    const logSum = Math.log(Math.exp(z - max) + Math.exp(draw - max) + Math.exp(-max));
    return [z - max - logSum, draw - max - logSum, -max - logSum];
}
function logAdd(a: number, b: number) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const max = Math.max(a, b);
    return max + Math.log1p(Math.exp(Math.min(a, b) - max));
}
function logLikelihood(
    r: number,
    game: PerformanceGame,
    model: PerformanceModel,
): [number, number, number] {
    const sum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const sd = game.opponentSd ?? model.opponentSd;
    if (sd === 0) return logOutcomeProbabilities(r, game.opponentRating!, game.white, model);
    const slope = Math.LN10 / model.divisor;
    const opponentDrawSlope = model.drawSlope / 800 - slope / 2;
    const [nodes, weights] = normalQuadrature(sd * (Math.max(-slope, opponentDrawSlope, 0) - Math.min(-slope, opponentDrawSlope, 0)));
    const probability: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < nodes.length; i++) {
        const opponent = game.opponentRating! + nodes[i] * sd;
        const z = slope * (r - opponent + (game.white ? 1 : -1) * model.whiteAdvantage);
        const d = model.logDraw + model.drawSlope * ((r + opponent) / 2 - 2200) / 400 + z / 2;
        const max = Math.max(z, d, 0), a = Math.exp(z - max), b = Math.exp(d - max), c = Math.exp(-max);
        const weight = weights[i] / (a + b + c);
        probability[0] += weight * a; probability[1] += weight * b; probability[2] += weight * c;
    }
    if (probability.every(p => p > 1e-280)) return probability.map(Math.log) as [number, number, number];
    // The fast probability sum is safe in ordinary ranges; retain log sums for
    // extreme custom models where even one outcome would otherwise underflow.
    for (let i = 0; i < nodes.length; i++) {
        const p = logOutcomeProbabilities(r, game.opponentRating! + nodes[i] * sd, game.white, model);
        for (let k = 0; k < 3; k++) sum[k] = logAdd(sum[k], Math.log(weights[i]) + p[k]);
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
/** Past-only constant-strength inference. The support mesh retains every log
 * value; discarded integration tails can always recover from the exact counts. */
class PeriodPosterior {
    private xs: number[];
    private logs: number[];
    private readonly h: number;
    private readonly groups = new Map<string, { game: PerformanceGame; counts: [number, number, number] }>();
    private readonly games: PerformanceGame[] = [];
    private readonly likelihoods = new Map<string, Float64Array>();
    private cacheBytes = 0;
    private readonly exactNodes = new Map<number, { value: number; through: number }>();
    private current: StrengthEstimate | null = null;
    private reporting: { xs: number[]; logs: number[]; logNormalizer: number } | null = null;

    constructor(private readonly initialMean: number, private readonly model: PerformanceModel) {
        grid(model); // Validate the public model, including its requested maximum spacing.
        this.h = Math.min(model.step, 10) / 2;
        const radius = Math.max(10 * model.priorSd + 4 * this.h, 24 * this.h);
        const low = 2 * Math.floor((initialMean - radius) / (2 * this.h));
        const high = 2 * Math.ceil((initialMean + radius) / (2 * this.h));
        if (high - low > 20000) throw new Error("Performance prior requires an unsupported integration range");
        this.xs = Array.from({ length: high - low + 1 }, (_, i) => (low + i) * this.h);
        this.logs = this.xs.map(x => -0.5 * ((x - initialMean) / model.priorSd) ** 2);
    }

    private key(game: PerformanceGame) {
        return `${game.opponentRating}:${game.opponentSd ?? this.model.opponentSd}:${Number(game.white)}`;
    }

    private likelihood(game: PerformanceGame) {
        const key = this.key(game), cached = this.likelihoods.get(key);
        if (cached) { this.likelihoods.delete(key); this.likelihoods.set(key, cached); return cached; }
        const values = new Float64Array(this.xs.length * 3);
        for (let i = 0; i < this.xs.length; i++) values.set(logLikelihood(this.xs[i], game, this.model), 3 * i);
        // A single invocation owns at most 4 MiB of exact-key likelihood arrays.
        const limit = 4 * 1024 * 1024;
        while (this.cacheBytes + values.byteLength > limit && this.likelihoods.size) {
            const oldest = this.likelihoods.keys().next().value!;
            this.cacheBytes -= this.likelihoods.get(oldest)!.byteLength; this.likelihoods.delete(oldest);
        }
        if (values.byteLength <= limit) { this.likelihoods.set(key, values); this.cacheBytes += values.byteLength; }
        return values;
    }

    private exact(x: number): number {
        const cached = this.exactNodes.get(x);
        let value: number;
        if (cached) {
            value = cached.value;
            for (let i = cached.through; i < this.games.length; i++) {
                const game = this.games[i], outcome = game.score === 1 ? 0 : game.score === .5 ? 1 : 2;
                value += logLikelihood(x, game, this.model)[outcome];
            }
            this.exactNodes.delete(x);
        } else {
            value = -0.5 * ((x - this.initialMean) / this.model.priorSd) ** 2;
            for (const { game, counts } of this.groups.values()) {
                const log = logLikelihood(x, game, this.model);
                for (let i = 0; i < 3; i++) if (counts[i]) value += counts[i] * log[i];
            }
        }
        if (this.exactNodes.size >= 4096) this.exactNodes.delete(this.exactNodes.keys().next().value!);
        this.exactNodes.set(x, { value, through: this.games.length });
        return value;
    }

    private expand() {
        for (let attempt = 0; attempt < 30; attempt++) {
            let peak = -Infinity;
            for (const value of this.logs) peak = Math.max(peak, value);
            const n = this.logs.length;
            const left = this.logs[2] <= this.logs[1] || this.logs[0] > peak - 45;
            const right = this.logs[n - 3] <= this.logs[n - 2] || this.logs[n - 1] > peak - 45;
            if (!left && !right) return;
            const extension = 2 * Math.ceil((n - 1) / 4);
            if (n + extension * (Number(left) + Number(right)) > 20001)
                throw new Error("Performance evidence requires an unsupported integration range");
            const low = this.xs[0], high = this.xs[n - 1];
            const leftX = left ? Array.from({ length: extension }, (_, i) => low - (extension - i) * this.h) : [];
            const rightX = right ? Array.from({ length: extension }, (_, i) => high + (i + 1) * this.h) : [];
            this.xs = [...leftX, ...this.xs, ...rightX];
            this.logs = [...leftX.map(x => this.exact(x)), ...this.logs, ...rightX.map(x => this.exact(x))];
            this.likelihoods.clear(); this.cacheBytes = 0;
        }
        throw new Error("Performance integration range did not converge");
    }

    estimate(): StrengthEstimate {
        if (this.current) return this.current;
        this.expand();
        const resolved = this.resolve(this.xs, this.logs, x => this.exact(x));
        const fine = resolved.summary;
        this.reporting = { xs: resolved.xs, logs: resolved.logs, logNormalizer: fine.logNormalizer };
        this.current = { mean: fine.mean, sd: fine.sd, low: fine.low, high: fine.high, edgeMass: fine.edgeMass };
        return this.current;
    }

    private resolve(xs: number[], logs: number[], exact: (x: number) => number) {
        for (let attempt = 0; attempt < 20; attempt++) {
            const fine = continuousLogSummary(xs, logs);
            const coarse = continuousLogSummary(xs.filter((_, i) => i % 2 === 0), logs.filter((_, i) => i % 2 === 0));
            const difference = Math.max(...(["mean", "sd", "low", "high"] as const).map(key => Math.abs(fine[key] - coarse[key])));
            if (difference < 0.00008 && logMidpointError(logs) < 0.00005 && fine.modeSd >= (xs[1] - xs[0]) * .3) {
                return { summary: fine, xs, logs };
            }
            // Refine only the reporting window. Every new midpoint is evaluated
            // from actual accumulated likelihoods, never from the interpolant.
            let peak = -Infinity, mode = 0;
            for (let i = 0; i < logs.length; i++) if (logs[i] > peak) { peak = logs[i]; mode = i; }
            let left = mode, right = mode;
            while (left > 0 && logs[left] > peak - 45) left--;
            while (right < logs.length - 1 && logs[right] > peak - 45) right++;
            left = Math.max(0, left - 6); right = Math.min(logs.length - 1, right + 6);
            const nextX: number[] = [], nextLog: number[] = [];
            if ((right - left) * 2 + 1 > 1_000_001)
                throw new Error("Performance model requires an unsupported local integration resolution");
            for (let i = left; i < right; i++) {
                nextX.push(xs[i], (xs[i] + xs[i + 1]) / 2);
                nextLog.push(logs[i], exact((xs[i] + xs[i + 1]) / 2));
            }
            nextX.push(xs[right]); nextLog.push(logs[right]); xs = nextX; logs = nextLog;
        }
        throw new Error("Performance numerical integration did not converge");
    }

    add(game: PerformanceGame, prediction: boolean): [number, number, number] {
        const likelihood = this.likelihood(game), outcome = game.score === 1 ? 0 : game.score === .5 ? 1 : 2;
        const predictive: [number, number, number] = [0, 0, 0];
        if (prediction) {
            const reporting = this.reporting!;
            const candidateLikelihood = reporting.xs === this.xs ? likelihood : (() => {
                const values = new Float64Array(reporting.xs.length * 3);
                for (let i = 0; i < reporting.xs.length; i++) values.set(logLikelihood(reporting.xs[i], game, this.model), 3 * i);
                return values;
            })();
            const evidences = [0, 1, 2].map(result => {
                const logs = reporting.logs.map((value, i) => value + candidateLikelihood[3 * i + result]);
                const initial = continuousLogSummary(reporting.xs, logs);
                // Negligible outcomes need an absolute probability bound, not a
                // precise conditional strength estimate in a remote prior tail.
                if (initial.logNormalizer - reporting.logNormalizer < -30
                    && logMidpointError(logs) < 0.00005
                    && initial.modeSd >= (reporting.xs[1] - reporting.xs[0]) * .3) return initial.logNormalizer;
                return this.resolve(reporting.xs, logs, x => this.exact(x) + logLikelihood(x, game, this.model)[result]).summary.logNormalizer;
            });
            const max = Math.max(...evidences), values = evidences.map(value => Math.exp(value - max));
            const total = values.reduce((a, b) => a + b, 0);
            for (let i = 0; i < 3; i++) predictive[i] = values[i] / total;
        }
        for (let i = 0; i < this.logs.length; i++) this.logs[i] += likelihood[3 * i + outcome];
        const key = this.key(game);
        let group = this.groups.get(key);
        if (!group) { group = { game, counts: [0, 0, 0] }; this.groups.set(key, group); }
        group.counts[outcome]++; this.games.push(game); this.current = null;
        return predictive;
    }
}

function constantHistory(games: PerformanceGame[], model: PerformanceModel, collect: boolean) {
    const posterior = new PeriodPosterior(games[0].rating!, model), points: StrengthPoint[] = [];
    let estimate = posterior.estimate();
    for (const game of games) {
        const before = estimate.mean, predictive = posterior.add(game, collect);
        estimate = posterior.estimate();
        if (collect) points.push({ ...estimate, id: game.id, at: game.at, before, rating: game.rating, predictive });
    }
    return { estimate, points };
}

class HistoryMeshRequest extends Error {
    constructor(readonly kind: "expand" | "refine", readonly left = true, readonly right = true) {
        super(`Chronological performance needs ${kind}`);
    }
}

/** Unlike a constant period, drift cannot be reconstructed from game counts.
 * Mesh changes replay the chronological evidence from the original prior.
 * Previously returned points are deliberately never replaced by that replay. */
function dynamicLikelihood(game: PerformanceGame, model: PerformanceModel) {
    const sd = game.opponentSd ?? model.opponentSd, slope = Math.LN10 / model.divisor;
    if (sd === 0) return (r: number) => logLikelihood(r, game, model);
    const os = model.drawSlope / 800 - slope / 2;
    const [nodes, weights] = normalQuadrature(sd * (Math.max(-slope, os, 0) - Math.min(-slope, os, 0)));
    const wins = nodes.map(x => Math.exp(-slope * sd * x)), draws = nodes.map(x => Math.exp(os * sd * x));
    return (r: number): [number, number, number] => {
        const z = slope * (r - game.opponentRating! + (game.white ? 1 : -1) * model.whiteAdvantage);
        const d = model.logDraw + model.drawSlope * ((r + game.opponentRating!) / 2 - 2200) / 400 + z / 2;
        if (Math.abs(z) > 500 || Math.abs(d) > 500) return logLikelihood(r, game, model);
        const a = Math.exp(z), b = Math.exp(d);
        let win = 0, draw = 0, loss = 0;
        for (let i = 0; i < nodes.length; i++) {
            const w = a * wins[i], q = b * draws[i], weight = weights[i] / (w + q + 1);
            win += weight * w; draw += weight * q; loss += weight;
        }
        if (Math.min(win, draw, loss) <= 1e-280 || !Number.isFinite(win + draw + loss)) return logLikelihood(r, game, model);
        return [Math.log(win), Math.log(draw), Math.log(loss)];
    };
}
interface DynamicLikelihoodCache {
    entries: Map<string, { low: number; h: number; values: Float64Array }>;
    bytes: number;
}
class DynamicPosterior {
    private h: number;
    private low: number;
    private high: number;
    private xs: number[] = [];
    private logs: number[] = [];
    private last: number;
    private readonly past: PerformanceGame[] = [];

    constructor(private readonly mean: number, private readonly model: PerformanceModel, private readonly start: number, factor = 1, initialStep = 10, private readonly shared: DynamicLikelihoodCache = { entries: new Map(), bytes: 0 }) {
        this.h = Math.min(model.step, initialStep);
        const radius = factor * Math.max(10 * model.priorSd + 8 * this.h, 24 * this.h);
        this.low = 2 * this.h * Math.floor((mean - radius) / (2 * this.h));
        this.high = 2 * this.h * Math.ceil((mean + radius) / (2 * this.h));
        this.last = start; this.reset();
    }

    spacing() { return this.h; }

    private reset() {
        const count = Math.round((this.high - this.low) / this.h) + 1;
        if (count > 24001) throw new Error("Chronological performance requires an unsupported integration mesh");
        this.xs = Array.from({ length: count }, (_, i) => this.low + i * this.h);
        this.logs = this.xs.map(x => -.5 * ((x - this.mean) / this.model.priorSd) ** 2);
        this.last = this.start;
    }

    private likelihood(game: PerformanceGame) {
        const key = `${game.opponentRating}:${game.opponentSd ?? this.model.opponentSd}:${Number(game.white)}`;
        const cached = this.shared.entries.get(key);
        const offset = cached ? (this.low - cached.low) / this.h : 0;
        if (cached?.h === this.h && Number.isInteger(offset) && offset >= 0 && 3 * (offset + this.xs.length) <= cached.values.length) {
            this.shared.entries.delete(key); this.shared.entries.set(key, cached);
            return cached.values.subarray(3 * offset, 3 * (offset + this.xs.length));
        }
        const values = new Float64Array(this.xs.length * 3), evaluate = dynamicLikelihood(game, this.model);
        for (let i = 0; i < this.xs.length; i++) values.set(evaluate(this.xs[i]), 3 * i);
        if (cached) { this.shared.entries.delete(key); this.shared.bytes -= cached.values.byteLength; }
        while (this.shared.bytes + values.byteLength > 8 * 1024 * 1024 && this.shared.entries.size) {
            const oldest = this.shared.entries.keys().next().value!;
            this.shared.bytes -= this.shared.entries.get(oldest)!.values.byteLength; this.shared.entries.delete(oldest);
        }
        if (values.byteLength <= 8 * 1024 * 1024) {
            this.shared.entries.set(key, { low: this.low, h: this.h, values }); this.shared.bytes += values.byteLength;
        }
        return values;
    }

    private bounds(logs: number[]) {
        let peak = -Infinity;
        for (const value of logs) peak = Math.max(peak, value);
        const n = logs.length;
        let left = logs[0] > peak - 45 || logs[2] <= logs[1];
        let right = logs[n - 1] > peak - 45 || logs[n - 3] <= logs[n - 2];
        if (left || right) throw new HistoryMeshRequest("expand", left, right);
    }

    private summarise(logs: number[], fine = continuousLogSummary(this.xs, logs)) {
        const coarse = continuousLogSummary(this.xs.filter((_, i) => i % 2 === 0), logs.filter((_, i) => i % 2 === 0));
        const difference = Math.max(...(["mean", "sd", "low", "high"] as const).map(key => Math.abs(fine[key] - coarse[key])));
        if (difference > .00008 || logMidpointError(logs) > .00005 || fine.modeSd < .3 * this.h)
            throw new HistoryMeshRequest("refine");
        return fine;
    }

    private step(game: PerformanceGame, capture?: (forecast: Pick<StrengthPoint, "before" | "predictive">) => void): StrengthPoint {
        const variance = this.model.driftSdYear ** 2 * (game.at - this.last) / (365.25 * 86400);
        const propagated = gaussianLogConvolution(this.xs, this.logs, variance);
        this.bounds(propagated.logs);
        const before = this.summarise(propagated.logs);
        const likelihood = this.likelihood(game), result = game.score === 1 ? 0 : game.score === .5 ? 1 : 2;
        const candidates = [0, 1, 2].map(outcome => propagated.logs.map((value, i) => value + likelihood[3 * i + outcome]));
        const summaries = candidates.map((logs) => {
            const first = continuousLogSummary(this.xs, logs);
            // Resolve all material predictive outcomes before selecting the
            // observed result, so the numerical pre-game forecast uses no result.
            if (first.logNormalizer - before.logNormalizer > -30) {
                this.bounds(logs);
                return this.summarise(logs, first);
            }
            if (logMidpointError(logs) > .00005 || first.modeSd < .3 * this.h) throw new HistoryMeshRequest("refine");
            return first;
        });
        const maxEvidence = Math.max(...summaries.map(s => s.logNormalizer));
        const evidence = summaries.map(s => Math.exp(s.logNormalizer - maxEvidence));
        const total = evidence.reduce((a, b) => a + b, 0);
        const forecast = { before: before.mean, predictive: evidence.map(value => value / total) as [number, number, number] };
        // Freeze the forecast before resolving a possibly negligible observed
        // outcome. Its later mesh replay must not change the pre-game forecast.
        capture?.(forecast);
        const selectedLogs = candidates[result];
        this.bounds(selectedLogs);
        const selected = summaries[result].logNormalizer - before.logNormalizer > -30
            ? summaries[result] : this.summarise(selectedLogs, summaries[result]);
        let peak = -Infinity;
        for (const value of selectedLogs) peak = Math.max(peak, value);
        this.logs = selectedLogs.map(value => value - peak);
        this.last = game.at;
        return { mean: selected.mean, sd: selected.sd, low: selected.low, high: selected.high, edgeMass: selected.edgeMass,
            ...forecast,
            id: game.id, at: game.at, rating: game.rating };
    }

    add(game: PerformanceGame): StrengthPoint {
        let replay = false;
        let forecast: Pick<StrengthPoint, "before" | "predictive"> | undefined;
        for (let attempt = 0; attempt < 18; attempt++) {
            try {
                let point: StrengthPoint;
                if (replay) {
                    this.reset();
                    for (const old of this.past) this.step(old);
                }
                point = this.step(game, value => { forecast ??= value; });
                this.past.push(game); return { ...point, ...forecast };
            } catch (error) {
                if (!(error instanceof HistoryMeshRequest)) throw error;
                if (error.kind === "refine") this.h /= 2;
                else {
                    const extension = 2 * this.h * Math.ceil((this.high - this.low) / (4 * this.h));
                    if (error.left) this.low -= extension;
                    if (error.right) this.high += extension;
                }
                replay = true;
            }
        }
        throw new Error("Chronological performance domain or resolution did not converge");
    }
}
const DYNAMIC_DOMAIN_SCALE = 1;
class CheckedDynamicPosterior {
    private factor = DYNAMIC_DOMAIN_SCALE;
    private resolution = 10;
    private readonly cache: DynamicLikelihoodCache = { entries: new Map(), bytes: 0 };
    private small: DynamicPosterior;
    private wide: DynamicPosterior;
    private readonly past: PerformanceGame[] = [];
    constructor(private readonly mean: number, private readonly model: PerformanceModel, private readonly start: number) {
        this.small = new DynamicPosterior(mean, model, start, this.factor, this.resolution, this.cache);
        this.wide = new DynamicPosterior(mean, model, start, 2 * this.factor, this.resolution, this.cache);
    }
    add(game: PerformanceGame): StrengthPoint {
        let forecast: Pick<StrengthPoint, "before" | "predictive"> | undefined;
        for (let attempt = 0; attempt < 8; attempt++) {
            const wide = this.wide.add(game), small = this.small.add(game);
            const predictionDifference = Math.max(Math.abs(small.before - wide.before) / .00008,
                ...small.predictive.map((p, k) => Math.abs(p - wide.predictive[k]) / 1e-8));
            if (predictionDifference <= 1) forecast ??= { before: wide.before, predictive: wide.predictive };
            const posteriorDifference = Math.max(...(["mean", "sd", "low", "high"] as const)
                .map(key => Math.abs(small[key] - wide[key])));
            if (predictionDifference <= 1 && posteriorDifference <= .00008) {
                this.past.push(game); return { ...wide, ...forecast };
            }
            if (this.small.spacing() !== this.wide.spacing()) this.resolution = Math.min(this.small.spacing(), this.wide.spacing());
            else this.factor *= 2;
            this.small = new DynamicPosterior(this.mean, this.model, this.start, this.factor, this.resolution, this.cache);
            this.wide = new DynamicPosterior(this.mean, this.model, this.start, 2 * this.factor, this.resolution, this.cache);
            for (const old of this.past) { this.wide.add(old); this.small.add(old); }
        }
        throw new Error("Chronological performance domain convergence did not resolve");
    }
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
    grid(model);
    const games = preparePerformanceGames(input, asOf, gameType);
    const pool = games[0]?.pool ?? null;
    if (games.some((g) => g.pool !== pool))
        throw new Error("Choose one account and time control for performance estimates");
    // Never seed an earlier position with a later known rating.
    const first = games.findIndex((g) => finiteRating(g.rating));
    if (first < 0) return { games: [], points: [], excluded: input.length, model, pool };
    const usable = games.slice(first),
        points: StrengthPoint[] = [];
    if (model.driftSdYear === 0)
        return { games: usable, points: constantHistory(usable, model, true).points, excluded: input.length - usable.length, model, pool };
    const posterior = new CheckedDynamicPosterior(usable[0].rating!, model, usable[0].at);
    for (const game of usable) {
        points.push(posterior.add(game));
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
    return constantHistory(games, model, false).estimate;
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
