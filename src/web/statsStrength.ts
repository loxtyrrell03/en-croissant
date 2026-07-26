// EloGuard playing-strength model — exact port of EloGuard lib/review-core.js
// (rating estimation, anchored strength/performance, multi-game aggregation)
// plus the content.js clock features and a chessops-based game replay.
//
// Every fitted constant below is verbatim from review-core.js: the model was
// calibrated on 30,506 lichess player-sides and validated against chess.com
// games, so do not "fix" any number here without re-running that calibration.
import { isNormal, makeUci, type Move } from "chessops";
import { castlingSide, Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { kingCastlesTo, squareRank } from "chessops/util";
import { getOpeningBook, matchBook } from "./statsOpeningBook";

export type StrengthPool = "bullet" | "blitz" | "rapid" | "classical";
export type StrengthPhase = "opening" | "middlegame" | "endgame";
export type EvalScore = { cp?: number; mate?: number }; // WHITE POV always
export type GamePhaseStats = {
    accuracy: number | null;
    acpl: number | null;
    scoredCount: number;
    complexity: number | null;
};
export type GameQualityStats = {
    accuracy: number | null;
    acpl: number | null;
    scoredCount: number;
    complexity: number | null;
    bookMoves: number | null;
    blunderRate: number | null;
    fastRate: number | null;
    scramble: number | null;
    analysisDepth: number | null;
};
export type MoveLabelCounts = { inaccuracy: number; mistake: number; blunder: number };

export type AnalyzedGameEntry = {
    v: 2;
    ts: number;
    key: string;
    end: number; // game end epoch seconds
    source: string;
    url: string | null;
    timeControl: { base: number; inc: number } | null;
    color: "w" | "b";
    opponent: string | null;
    opp: number | null;
    result: "win" | "draw" | "loss";
    plies: number;
    eco: string | null;
    openingName: string | null;
    stats: GameQualityStats;
    phases: Partial<Record<StrengthPhase, GamePhaseStats>>;
    counts: MoveLabelCounts;
    phaseBlunders: Record<StrengthPhase, number>;
};

export type StrengthEstimate = { rating: number; uncertainty: number; pool: StrengthPool };
export type AnchoredStrength = {
    strength: number;
    delta: number;
    baseline: number;
    uncertainty: number;
    lambda: number;
    pool: StrengthPool;
};
export type AnchoredPerformance = {
    strength: number;
    delta: number;
    baseline: number;
    uncertainty: number;
    pool: StrengthPool;
};
export type GamePerformance = { perf: number; delta: number; baseline: number; pool: StrengthPool };

export type PoolProfile = {
    pool: StrengthPool;
    games: number;
    accuracy: number | null;
    estimate: StrengthEstimate | null; // rating-free
    aggFeature: number | null; // 0.6/0.4 blended quality feature for anchoring
    effMoves: number;
};
export type PhaseProfile = {
    phase: StrengthPhase;
    moves: number;
    accuracy: number | null;
    estimate: { rating: number; uncertainty: number } | null;
    aggFeature: number | null;
    effMoves: number;
};
export type RecentGameProfile = { entry: AnalyzedGameEntry; estimate: StrengthEstimate | null };
export type StrengthProfile = {
    pools: Partial<Record<StrengthPool, PoolProfile>>;
    phases: Partial<Record<StrengthPhase, PhaseProfile>>;
    recent: RecentGameProfile[]; // newest first, max 12
    primaryPool: StrengthPool | null;
    totalGames: number;
};

type StatsTimeControl = { base: number; inc: number } | string | null;
// estimateRating/gamePerformance accept a GameQualityStats optionally carrying
// per-phase buckets — exactly what review-core adjustedStats reads for the
// opening-vs-overall accuracy delta feature.
type StrengthStatsInput = {
    accuracy: number | null;
    acpl: number | null;
    scoredCount: number;
    complexity: number | null;
    bookMoves?: number | null;
    blunderRate?: number | null;
    fastRate?: number | null;
    scramble?: number | null;
    analysisDepth?: number | null;
    phases?: Partial<Record<StrengthPhase, GamePhaseStats>>;
};

const CP_CEIL = 1000; // clamp evals to +/- 10 pawns for win% + ACPL

// Median game accuracy / ACPL by LICHESS rating at T~600s (review-core.js:54-66).
const ACC_ANCHORS: [number, number][] = [
    [650, 65.3],
    [750, 70.3],
    [850, 72.7],
    [950, 72.8],
    [1050, 75.5],
    [1150, 76.6],
    [1250, 76.8],
    [1350, 79.5],
    [1450, 79.7],
    [1550, 80.4],
    [1650, 81.1],
    [1750, 81.2],
    [1850, 82.6],
    [1950, 83.1],
    [2050, 83.6],
    [2150, 85.2],
    [2250, 87.4],
    [2350, 88.7],
    [2550, 91.3],
    [2800, 94.3],
];
const ACPL_ANCHORS: [number, number][] = [
    [650, 109.4],
    [750, 90.5],
    [850, 85.9],
    [950, 83.3],
    [1050, 76.7],
    [1150, 68.7],
    [1250, 66.6],
    [1350, 61.7],
    [1450, 59.8],
    [1550, 55.9],
    [1650, 54.6],
    [1750, 54.5],
    [1850, 51.8],
    [1950, 48],
    [2050, 45.8],
    [2150, 41.5],
    [2250, 35],
    [2350, 30.2],
    [2550, 23.5],
    [2800, 17.5],
];

const TIME_CLASS_DEFAULT_SECONDS: Record<string, number> = {
    bullet: 60,
    blitz: 180,
    rapid: 600,
    classical: 7200,
};
const TIME_ACC_SLOPE = 1.264;
const TIME_ACPL_EXP = 0.08;
const COMPLEXITY_COEF = 5.217;
const CLASS_ADJUST: Record<StrengthPool, number> = {
    bullet: 59,
    blitz: 4,
    rapid: -108,
    classical: -58,
};

// lichess -> chess.com conversion per pool (chessgoals.com survey anchors).
const POOL_CONVERT: Record<StrengthPool, [number, number][]> = {
    bullet: [
        [975, 500],
        [1115, 800],
        [1770, 1500],
        [2000, 1800],
        [2195, 2000],
        [2490, 2300],
    ],
    blitz: [
        [1030, 500],
        [1200, 800],
        [1500, 1500],
        [1800, 1800],
        [2100, 2000],
        [2400, 2300],
    ],
    rapid: [
        [1205, 500],
        [1400, 800],
        [1930, 1500],
        [2085, 1800],
        [2185, 2000],
        [2400, 2300],
    ],
    classical: [
        [1205, 500],
        [1400, 800],
        [1930, 1500],
        [2085, 1800],
        [2185, 2000],
        [2400, 2300],
    ],
};

const EXTRA_FEATURE = {
    bookCoef: 227.23,
    bookMean: 2.33,
    bookCap: 16,
    blunderCoef: -5611.1,
    blunderMean: 0.0482,
    opDeltaCoef: 46.36,
    opDeltaMean: 6.07,
    fastCoef: 376.6,
    fastMean: 0.465,
    scrambleCoef: 1129.3,
    scrambleMean: 0.061,
};

const DEPTH_ADJUST = { accBase: -1.71, accPerCx: -0.78, lnAcplBase: 0.068, lnAcplPerCx: 0.05 };

const CALIBRATION = {
    meanFeature: 1537,
    meanActual: 1630,
    cov: 174985,
    varSignal: 246906,
    varNoise: 465520,
    varRating: 227228,
    slopeMax: 0.709,
    meanMoves: 30.7,
    modelFloor: 150,
};

const VALIDATION_OFFSET: Record<StrengthPool, number> = {
    bullet: 107,
    blitz: -227,
    rapid: 215,
    classical: 215,
};

const PHASES: StrengthPhase[] = ["opening", "middlegame", "endgame"];
const PHASE_RATING_OFFSET: Record<StrengthPhase, number> = {
    opening: -54,
    middlegame: 0,
    endgame: 29,
};

const SIGMA_FORM = 150; // plausible true spread of medium-term form (Elo)
const GAME_PERF_CREDIT = 0.4;
const GAME_PERF_CAP = 750;

// ---- time-control model ----------------------------------------------------

function effectiveGameSeconds(timeControl: StatsTimeControl): number {
    if (!timeControl) return 600;
    if (typeof timeControl === "string") {
        return TIME_CLASS_DEFAULT_SECONDS[timeControl] || 600;
    }
    const base = Math.max(15, timeControl.base || 0);
    return base + 40 * (timeControl.inc || 0);
}

export function timeClassOf(timeControl: StatsTimeControl): StrengthPool {
    const t = effectiveGameSeconds(timeControl);
    if (t < 180) return "bullet";
    if (t < 600) return "blitz";
    if (t < 5400) return "rapid";
    return "classical";
}

function timeSkillAdjust(timeControl: StatsTimeControl) {
    const t = effectiveGameSeconds(timeControl);
    return {
        accOffset: Math.max(-3.5, Math.min(3.5, TIME_ACC_SLOPE * Math.log(600 / t))),
        acplMult: Math.max(0.75, Math.min(1.25, Math.pow(t / 600, TIME_ACPL_EXP))),
    };
}

function lichessToChessCom(pool: StrengthPool, lichessRating: number): number {
    const table = POOL_CONVERT[pool] || POOL_CONVERT.rapid;
    let lo = table[0];
    let hi = table[table.length - 1];
    for (let i = 1; i < table.length; i++) {
        if (lichessRating <= table[i][0]) {
            lo = table[i - 1];
            hi = table[i];
            break;
        }
        lo = table[i - 1];
        hi = table[i];
    }
    const t = (lichessRating - lo[0]) / (hi[0] - lo[0]);
    return lo[1] + t * (hi[1] - lo[1]); // extrapolates linearly beyond the ends
}

function conversionSlope(pool: StrengthPool, lichessRating: number): number {
    return (
        (lichessToChessCom(pool, lichessRating + 50) -
            lichessToChessCom(pool, lichessRating - 50)) /
        100
    );
}

function chessComToLichess(pool: StrengthPool, chessComRating: number): number {
    const table = POOL_CONVERT[pool] || POOL_CONVERT.rapid;
    let lo = table[0];
    let hi = table[table.length - 1];
    for (let i = 1; i < table.length; i++) {
        if (chessComRating <= table[i][1]) {
            lo = table[i - 1];
            hi = table[i];
            break;
        }
        lo = table[i - 1];
        hi = table[i];
    }
    const t = (chessComRating - lo[1]) / (hi[1] - lo[1]);
    return lo[0] + t * (hi[0] - lo[0]);
}

// ---- eval helpers ----------------------------------------------------------

function scoreToCp(score: EvalScore | null | undefined): number {
    if (!score) return 0;
    if (typeof score.mate === "number") {
        if (score.mate === 0) return 0; // shouldn't happen for non-terminal
        return score.mate > 0 ? CP_CEIL : -CP_CEIL;
    }
    return Math.max(-CP_CEIL, Math.min(CP_CEIL, score.cp || 0));
}

function winPctWhite(score: EvalScore | null | undefined): number {
    if (score && typeof score.mate === "number" && score.mate !== 0) {
        return score.mate > 0 ? 100 : 0;
    }
    const cp = scoreToCp(score);
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function winPctFor(score: EvalScore | null | undefined, color: "w" | "b"): number {
    const w = winPctWhite(score);
    return color === "w" ? w : 100 - w;
}

function moveAccuracy(drop: number): number {
    if (drop <= 0) return 100;
    const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669 + 1;
    return Math.max(0, Math.min(100, raw));
}

function stdev(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
    return Math.sqrt(variance);
}

// Weight of the move at ply k: volatility (stdev) of the win% sequence in a
// trailing window — errors in sharp positions matter more than in dead-equal ones.
function volatilityWeights(winPcts: number[]): number[] {
    const n = Math.max(winPcts.length - 1, 1);
    const windowSize = Math.max(2, Math.min(8, Math.ceil(n / 10)));
    const weights: number[] = [];
    for (let k = 0; k < winPcts.length - 1; k++) {
        const from = Math.max(0, k + 2 - windowSize);
        const win = winPcts.slice(from, k + 2);
        weights.push(Math.max(0.5, Math.min(12, stdev(win))));
    }
    return weights;
}

function gameAccuracy(accuracies: number[], weights: number[]): number | null {
    if (!accuracies.length) return null;
    let wSum = 0;
    let wTotal = 0;
    let hSum = 0;
    for (let i = 0; i < accuracies.length; i++) {
        const w = weights[i] || 1;
        wSum += accuracies[i] * w;
        wTotal += w;
        hSum += 1 / Math.max(accuracies[i], 1);
    }
    const weighted = wSum / wTotal;
    const harmonic = accuracies.length / hSum;
    return Math.max(0, Math.min(100, (weighted + harmonic) / 2));
}

// ---- game phases -----------------------------------------------------------

function majorMinorCount(fen: string): number {
    const placement = fen.split(" ")[0];
    let count = 0;
    for (const ch of placement) if (/[nbrq]/i.test(ch)) count++;
    return count;
}

// Phase of the move played from position fens[i]. Monotonic state machine:
// middlegame once pieces start coming off or the opening runs long; endgame
// at <= 6 majors+minors on the board.
function assignPhases(fens: string[], bookPlies: number): StrengthPhase[] {
    const phases: StrengthPhase[] = [];
    let phase: StrengthPhase = "opening";
    const openingLimit = Math.max(bookPlies, 20);
    for (let i = 0; i < fens.length - 1; i++) {
        const count = majorMinorCount(fens[i]);
        if (count <= 6) phase = "endgame";
        else if (phase === "opening" && (count <= 10 || i >= openingLimit)) phase = "middlegame";
        phases.push(phase);
    }
    return phases;
}

// ---- rating estimation -----------------------------------------------------

function invertAccuracy(acc: number): number {
    const a = ACC_ANCHORS;
    if (acc <= a[0][1]) return a[0][0];
    if (acc >= a[a.length - 1][1]) return a[a.length - 1][0];
    for (let i = 1; i < a.length; i++) {
        if (acc <= a[i][1]) {
            const t = (acc - a[i - 1][1]) / (a[i][1] - a[i - 1][1]);
            return a[i - 1][0] + t * (a[i][0] - a[i - 1][0]);
        }
    }
    return a[a.length - 1][0];
}

function invertAcpl(acpl: number): number {
    const a = ACPL_ANCHORS;
    const x = Math.log(Math.max(acpl, 1));
    if (acpl >= a[0][1]) return a[0][0];
    if (acpl <= a[a.length - 1][1]) return a[a.length - 1][0];
    for (let i = 1; i < a.length; i++) {
        if (acpl >= a[i][1]) {
            const hi = Math.log(a[i - 1][1]);
            const lo = Math.log(a[i][1]);
            const t = (hi - x) / (hi - lo);
            return a[i - 1][0] + t * (a[i][0] - a[i - 1][0]);
        }
    }
    return a[a.length - 1][0];
}

function depthScale(analysisDepth: number | null | undefined): number {
    if (typeof analysisDepth !== "number") return 0; // unknown/deep: no correction
    return Math.max(0, Math.min(1, (22 - analysisDepth) / 10));
}

type AdjustedFeatures = {
    acc: number;
    lnAcpl: number;
    book?: number;
    blunder?: number;
    opDelta?: number;
    fast?: number;
    scramble?: number;
    moves?: number;
};

// Time- and sharpness-adjusted measurements: the aggregatable quantities.
// (Aggregate THESE across games, then invert once — averaging post-inversion
// features through the flat middle of the curve would amplify noise.)
function adjustedStats(
    stats: StrengthStatsInput | GamePhaseStats | null | undefined,
    timeControl: StatsTimeControl,
): AdjustedFeatures | null {
    if (!stats || stats.accuracy === null || !stats.scoredCount) return null;
    const accuracy = stats.accuracy;
    const input = stats as StrengthStatsInput;
    const adjust = timeSkillAdjust(timeControl);
    const complexityAdj = Math.max(
        -8,
        Math.min(8, ((input.complexity || 4.5) - 4.5) * COMPLEXITY_COEF),
    );
    // Opening-vs-overall accuracy delta. With phase data: 0 when the opening
    // sample is tiny (matching the fit's treatment). Without phase data at
    // all (phase-only estimates, unknown inputs): neutral (= the mean).
    let opDelta = EXTRA_FEATURE.opDeltaMean;
    if (input.phases) {
        opDelta = 0;
        const op = input.phases.opening;
        if (op && op.accuracy !== null && op.scoredCount >= 5) {
            opDelta = Math.max(-25, Math.min(25, op.accuracy - accuracy));
        }
    }
    // depth-skew correction toward the deep-analysis training scale
    const dScale = depthScale(input.analysisDepth);
    const cx = (input.complexity || 4.5) - 4.5;
    const accDepthAdj = dScale * (DEPTH_ADJUST.accBase + DEPTH_ADJUST.accPerCx * cx);
    const lnAcplDepthAdj = dScale * (DEPTH_ADJUST.lnAcplBase + DEPTH_ADJUST.lnAcplPerCx * cx);
    return {
        acc: Math.min(99.5, accuracy + adjust.accOffset + complexityAdj + accDepthAdj),
        lnAcpl: Math.log(Math.max(1, (input.acpl ?? 0) * adjust.acplMult)) + lnAcplDepthAdj,
        book: Math.min(
            typeof input.bookMoves === "number" ? input.bookMoves : EXTRA_FEATURE.bookMean,
            EXTRA_FEATURE.bookCap,
        ),
        blunder:
            typeof input.blunderRate === "number" ? input.blunderRate : EXTRA_FEATURE.blunderMean,
        opDelta,
        fast: typeof input.fastRate === "number" ? input.fastRate : EXTRA_FEATURE.fastMean,
        scramble: typeof input.scramble === "number" ? input.scramble : EXTRA_FEATURE.scrambleMean,
        moves: input.scoredCount,
    };
}

function skillFromAdjusted(adj: AdjustedFeatures): number {
    const fromAcc = invertAccuracy(adj.acc);
    const fromAcpl = invertAcpl(Math.exp(adj.lnAcpl));
    let skill = 0.6 * fromAcc + 0.4 * fromAcpl;
    const x = EXTRA_FEATURE;
    skill += x.bookCoef * ((typeof adj.book === "number" ? adj.book : x.bookMean) - x.bookMean);
    skill +=
        x.blunderCoef *
        ((typeof adj.blunder === "number" ? adj.blunder : x.blunderMean) - x.blunderMean);
    skill +=
        x.opDeltaCoef *
        ((typeof adj.opDelta === "number" ? adj.opDelta : x.opDeltaMean) - x.opDeltaMean);
    skill += x.fastCoef * ((typeof adj.fast === "number" ? adj.fast : x.fastMean) - x.fastMean);
    skill +=
        x.scrambleCoef *
        ((typeof adj.scramble === "number" ? adj.scramble : x.scrambleMean) - x.scrambleMean);
    return skill;
}

function performanceFeatureFromAdjusted(
    adj: Pick<AdjustedFeatures, "acc" | "lnAcpl"> | null,
): number | null {
    if (!adj) return null;
    return 0.6 * invertAccuracy(adj.acc) + 0.4 * invertAcpl(Math.exp(adj.lnAcpl));
}

function rawSkill(stats: StrengthStatsInput, timeControl: StatsTimeControl): number | null {
    const adj = adjustedStats(stats, timeControl);
    return adj === null ? null : skillFromAdjusted(adj);
}

function slopeFor(effMoves: number): number {
    const c = CALIBRATION;
    return Math.min(
        c.slopeMax,
        c.cov / (c.varSignal + (c.varNoise * c.meanMoves) / Math.max(effMoves, 1)),
    );
}

function finalizeRating(
    skill: number,
    pool: StrengthPool,
    effMoves: number,
    extraOffset?: number,
): StrengthEstimate {
    const c = CALIBRATION;
    const denom = c.varSignal + (c.varNoise * c.meanMoves) / Math.max(effMoves, 1);
    const lichess =
        c.meanActual +
        slopeFor(effMoves) * (skill - c.meanFeature) +
        (CLASS_ADJUST[pool] || 0) +
        (extraOffset || 0);
    const convSlope = Math.max(0.4, conversionSlope(pool, lichess));
    const converted = lichessToChessCom(pool, lichess) + (VALIDATION_OFFSET[pool] || 0);
    const rating = Math.max(100, Math.min(3200, Math.round(converted / 25) * 25));
    const residVar = Math.max(c.varRating - (c.cov * c.cov) / denom, c.modelFloor * c.modelFloor);
    // Cap the conversion-slope amplification and the display value: a ±800
    // band is honest math but useless guidance.
    const uncertainty = Math.min(
        500,
        Math.round((Math.sqrt(residVar) * Math.min(convSlope, 1.2)) / 25) * 25,
    );
    return { rating, uncertainty, pool };
}

export function estimateRating(
    stats: GameQualityStats & { phases?: Partial<Record<StrengthPhase, GamePhaseStats>> },
    timeControl: StatsTimeControl,
    phase?: StrengthPhase | null,
): StrengthEstimate | null {
    const skill = rawSkill(stats, timeControl);
    if (skill === null) return null;
    return finalizeRating(
        skill,
        timeClassOf(timeControl),
        stats.scoredCount,
        phase ? PHASE_RATING_OFFSET[phase] || 0 : 0,
    );
}

// --- baseline-anchored strength (empirical Bayes around the player's own
// rating): the rating pins the LEVEL, the measured features move it by a
// noise-shrunk performance delta.

// Expected feature level for a player of this chess.com rating in this pool.
function baselineExpectation(pool: StrengthPool, chessComRating: number) {
    const c = CALIBRATION;
    const efr = c.cov / c.varRating; // E[feature | rating] responsiveness (~0.77)
    const lichessBase = chessComToLichess(pool, chessComRating - (VALIDATION_OFFSET[pool] || 0));
    // beyond the fitted range the E[f|rating] line is extrapolated fiction
    const lichessForExp = Math.max(800, Math.min(2600, lichessBase));
    const fExpected =
        c.meanFeature + efr * (lichessForExp - (CLASS_ADJUST[pool] || 0) - c.meanActual);
    return { efr, lichessBase, fExpected };
}

export function anchoredStrength(
    aggFeature: number,
    effMoves: number,
    pool: StrengthPool,
    chessComRating: number,
    extraLichessOffset?: number,
): AnchoredStrength | null {
    if (typeof aggFeature !== "number" || typeof chessComRating !== "number") return null;
    const c = CALIBRATION;
    const { efr, lichessBase, fExpected } = baselineExpectation(pool, chessComRating);
    // performance semantics (inverse regression): full-credit delta, then
    // shrink by measurement noise vs the plausible form spread
    const rawDelta = (aggFeature - fExpected) / efr + (extraLichessOffset || 0);
    const noiseVarR = (c.varNoise * c.meanMoves) / Math.max(effMoves, 1) / (efr * efr);
    const lambda = (SIGMA_FORM * SIGMA_FORM) / (SIGMA_FORM * SIGMA_FORM + noiseVarR);
    const slope = Math.max(0.4, Math.min(1.2, conversionSlope(pool, lichessBase)));
    const delta = Math.round((Math.max(-400, Math.min(400, lambda * rawDelta)) * slope) / 5) * 5;
    const strength = Math.round((chessComRating + delta) / 5) * 5;
    const sd = Math.sqrt(1 - lambda) * SIGMA_FORM * slope;
    return {
        strength,
        delta,
        baseline: chessComRating,
        uncertainty: Math.max(25, Math.round(sd / 25) * 25),
        lambda: Number(lambda.toFixed(3)),
        pool,
    };
}

function expectedPerformanceFeature(pool: StrengthPool, chessComRating: number): number {
    const { lichessBase } = baselineExpectation(pool, chessComRating);
    const anchorTop = ACC_ANCHORS[ACC_ANCHORS.length - 1][0];
    const anchorBottom = ACC_ANCHORS[0][0];
    return Math.max(anchorBottom, Math.min(anchorTop, lichessBase - (CLASS_ADJUST[pool] || 0)));
}

export function anchoredPerformance(
    performanceFeature: number | null,
    effMoves: number,
    pool: StrengthPool,
    chessComRating: number | null,
): AnchoredPerformance | null {
    if (typeof chessComRating !== "number") return null;
    if (typeof performanceFeature !== "number") return null;
    const { lichessBase } = baselineExpectation(pool, chessComRating);
    const fExpectedCore = expectedPerformanceFeature(pool, chessComRating);
    const slope = Math.max(0.4, Math.min(1.2, conversionSlope(pool, lichessBase)));
    const rawDelta = GAME_PERF_CREDIT * (performanceFeature - fExpectedCore) * slope;
    const delta = Math.round(Math.max(-GAME_PERF_CAP, Math.min(GAME_PERF_CAP, rawDelta)) / 5) * 5;
    const strength = Math.max(100, Math.min(3200, Math.round((chessComRating + delta) / 5) * 5));
    const c = CALIBRATION;
    const noiseVar = (c.varNoise * c.meanMoves) / Math.max(effMoves || 1, 1);
    const uncertainty = Math.max(
        25,
        Math.min(500, Math.round((Math.sqrt(noiseVar) * GAME_PERF_CREDIT * slope) / 25) * 25),
    );
    return {
        strength,
        delta,
        baseline: chessComRating,
        uncertainty,
        pool,
    };
}

// Single-game performance vs baseline — "this game played like ~X".
export function gamePerformance(
    stats: GameQualityStats & { phases?: Partial<Record<StrengthPhase, GamePhaseStats>> },
    timeControl: StatsTimeControl,
    chessComRating: number | null,
): GamePerformance | null {
    const adj = adjustedStats(stats, timeControl);
    if (adj === null) return null;
    const pool = timeClassOf(timeControl);
    const anchor = anchoredPerformance(
        performanceFeatureFromAdjusted(adj),
        stats.scoredCount,
        pool,
        chessComRating,
    );
    if (!anchor) return null;
    const delta = Math.round(anchor.delta / 25) * 25;
    const perf = Math.max(
        100,
        Math.min(3200, Math.round(((chessComRating as number) + delta) / 25) * 25),
    );
    return { perf, delta, baseline: chessComRating as number, pool };
}

// ---- multi-game aggregation ------------------------------------------------

type ProfileRow = {
    e: AnalyzedGameEntry;
    decay: number;
    pool: StrengthPool;
    adj: AdjustedFeatures;
};

type WeightedValue = { value: number; weight: number };

function weightedMean<T>(
    list: T[],
    valueOf: (item: T) => number | null | undefined,
    weightOf: (item: T) => number,
): WeightedValue | null {
    let wSum = 0;
    let vSum = 0;
    for (const item of list) {
        const v = valueOf(item);
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        const w = weightOf(item);
        wSum += w;
        vSum += v * w;
    }
    return wSum ? { value: vSum / wSum, weight: wSum } : null;
}

// Average the adjusted measurements across games, invert the curve once.
function combinedSkill<T>(
    list: T[],
    adjOf: (item: T) => AdjustedFeatures | null,
    weightOf: (item: T) => number,
): { skill: number; weight: number } | null {
    const accAgg = weightedMean(list, (r) => adjOf(r)?.acc, weightOf);
    const acplAgg = weightedMean(list, (r) => adjOf(r)?.lnAcpl, weightOf);
    if (!accAgg || !acplAgg) return null;
    const agg = (field: "book" | "blunder" | "opDelta" | "fast" | "scramble") => {
        const w = weightedMean(list, (r) => adjOf(r)?.[field], weightOf);
        return w ? w.value : undefined;
    };
    return {
        skill: skillFromAdjusted({
            acc: accAgg.value,
            lnAcpl: acplAgg.value,
            book: agg("book"),
            blunder: agg("blunder"),
            opDelta: agg("opDelta"),
            fast: agg("fast"),
            scramble: agg("scramble"),
        }),
        weight: accAgg.weight,
    };
}

function combinedPerformance<T>(
    list: T[],
    adjOf: (item: T) => AdjustedFeatures | null,
    weightOf: (item: T) => number,
): { feature: number | null; weight: number } | null {
    const accAgg = weightedMean(list, (r) => adjOf(r)?.acc, weightOf);
    const acplAgg = weightedMean(list, (r) => adjOf(r)?.lnAcpl, weightOf);
    if (!accAgg || !acplAgg) return null;
    return {
        feature: performanceFeatureFromAdjusted({ acc: accAgg.value, lnAcpl: acplAgg.value }),
        weight: accAgg.weight,
    };
}

// Multi-game aggregation: each game's unshrunk skill is combined with
// weight = scoredMoves x recency decay (45-day half-life), per pool and per
// phase. Exact port of review-core aggregateProfile, reshaped into
// StrengthProfile (an empty profile stands in for the original's null).
export function aggregateProfile(
    entries: AnalyzedGameEntry[],
    nowMs: number,
    opts?: { noDecay?: boolean },
): StrengthProfile {
    const HALF_LIFE_DAYS = 45;
    const noDecay = !!(opts && opts.noDecay); // period views weight all games equally
    const rows: ProfileRow[] = (entries || [])
        .filter(
            (e) =>
                e &&
                e.stats &&
                e.stats.accuracy !== null &&
                e.stats.scoredCount >= 6 &&
                e.timeControl,
        )
        .map((e) => {
            const ageDays = Math.max(0, (nowMs - (e.ts || nowMs)) / 86400000);
            return {
                e,
                decay: noDecay ? 1 : Math.pow(0.5, ageDays / HALF_LIFE_DAYS),
                pool: timeClassOf(e.timeControl),
                adj: adjustedStats({ ...e.stats, phases: e.phases }, e.timeControl),
            };
        })
        .filter((r): r is ProfileRow => r.adj !== null);
    if (!rows.length) {
        return { pools: {}, phases: {}, recent: [], primaryPool: null, totalGames: 0 };
    }

    const pools: Partial<Record<StrengthPool, PoolProfile>> = {};
    let primaryPool: StrengthPool = "rapid";
    let primaryWeight = -1;
    for (const pool of ["bullet", "blitz", "rapid", "classical"] as StrengthPool[]) {
        const list = rows.filter((r) => r.pool === pool);
        if (!list.length) continue;
        const wOf = (r: ProfileRow) => r.e.stats.scoredCount * r.decay;
        const agg = combinedSkill(list, (r) => r.adj, wOf);
        const perfAgg = combinedPerformance(list, (r) => r.adj, wOf);
        if (!agg) continue;
        const est = finalizeRating(agg.skill, pool, agg.weight);
        pools[pool] = {
            pool,
            games: list.length,
            accuracy: weightedMean(list, (r) => r.e.stats.accuracy, wOf)?.value ?? null,
            estimate: est,
            aggFeature: perfAgg ? perfAgg.feature : null,
            effMoves: agg.weight,
        };
        if (agg.weight > primaryWeight) {
            primaryWeight = agg.weight;
            primaryPool = pool;
        }
    }

    const phases: Partial<Record<StrengthPhase, PhaseProfile>> = {};
    for (const ph of PHASES) {
        const list = rows.filter((r) => {
            const bucket = r.e.phases && r.e.phases[ph];
            return !!bucket && bucket.scoredCount >= 3 && bucket.accuracy !== null;
        });
        if (!list.length) continue;
        const wOf = (r: ProfileRow) => (r.e.phases[ph] as GamePhaseStats).scoredCount * r.decay;
        const agg = combinedSkill(list, (r) => adjustedStats(r.e.phases[ph], r.e.timeControl), wOf);
        if (!agg) continue;
        const est = finalizeRating(
            agg.skill,
            primaryPool,
            agg.weight,
            PHASE_RATING_OFFSET[ph] || 0,
        );
        phases[ph] = {
            phase: ph,
            moves: list.reduce((a, r) => a + (r.e.phases[ph] as GamePhaseStats).scoredCount, 0),
            accuracy:
                weightedMean(list, (r) => (r.e.phases[ph] as GamePhaseStats).accuracy, wOf)
                    ?.value ?? null,
            estimate: { rating: est.rating, uncertainty: est.uncertainty },
            // The FULL aggregated skill feature: review-core anchors phases via
            // anchoredStrength(p.feature, ...), not the quality-only blend.
            aggFeature: agg.skill,
            effMoves: agg.weight,
        };
    }

    const recent: RecentGameProfile[] = rows
        .slice()
        .sort((a, b) => (b.e.ts || 0) - (a.e.ts || 0))
        .slice(0, 12)
        .map((r) => ({
            entry: r.e,
            // Same single-game estimator the review card uses, keeping views consistent.
            estimate: finalizeRating(skillFromAdjusted(r.adj), r.pool, r.e.stats.scoredCount),
        }));

    return {
        pools,
        phases,
        recent,
        primaryPool,
        totalGames: rows.length,
    };
}

// ---- game replay + per-game quality pipeline -------------------------------

type ReplayedGame = {
    fens: string[];
    legalCounts: number[];
    uciMoves: string[];
    sans: string[]; // normalized SANs (book matching needs canonical suffixes)
    terminalCheckmate: boolean;
};

// chess.js counts each promotion piece as its own legal move; mirror that so
// legalCounts (forced-move detection) matches the review-core pipeline.
function countLegalMoves(position: Chess): number {
    let count = 0;
    for (const [from, dests] of position.allDests()) {
        const promotes = position.board.get(from)?.role === "pawn";
        for (const to of dests) {
            const rank = squareRank(to);
            count += promotes && (rank === 0 || rank === 7) ? 4 : 1;
        }
    }
    return count;
}

// Engine-standard UCI: castling as the king's destination square (e1g1/e1c1),
// matching both engine bestmove output and chess.js from+to in review-core.
function standardUci(position: Chess, move: Move): string | null {
    if (!isNormal(move)) return null;
    const side = castlingSide(position, move);
    if (side) return makeUci({ from: move.from, to: kingCastlesTo(position.turn, side) });
    return makeUci(move);
}

function replayGame(sans: string[]): ReplayedGame | null {
    const position = Chess.default();
    const fens = [makeFen(position.toSetup())];
    const legalCounts = [countLegalMoves(position)];
    const uciMoves: string[] = [];
    const normalizedSans: string[] = [];
    for (const san of sans) {
        const move = parseSan(position, san);
        if (!move) return null;
        const uci = standardUci(position, move);
        if (!uci) return null;
        normalizedSans.push(makeSan(position, move));
        uciMoves.push(uci);
        position.play(move);
        fens.push(makeFen(position.toSetup()));
        legalCounts.push(countLegalMoves(position));
    }
    return {
        fens,
        legalCounts,
        uciMoves,
        sans: normalizedSans,
        terminalCheckmate: position.isCheckmate(),
    };
}

// Replays a SAN list with chessops; null on illegal/unparseable moves.
export function replayGamePositions(
    sans: string[],
): { fens: string[]; legalCounts: number[]; uciMoves: string[] } | null {
    const replay = replayGame(sans);
    if (!replay) return null;
    return { fens: replay.fens, legalCounts: replay.legalCounts, uciMoves: replay.uciMoves };
}

// Time-management features for one side — exact port of EloGuard
// content.js:8181-8199 (mirrors the calibration pipeline).
export function clockFeaturesForSide(
    sans: string[],
    clocks: (number | null)[],
    tc: { base: number; inc: number },
    bookPlies: number,
    color: "w" | "b",
): { fastRate: number | null; scramble: number | null } {
    const threshold = Math.max(0.8, tc.base * 0.015);
    const offset = color === "w" ? 0 : 1;
    let prev: number | null = tc.base;
    let considered = 0;
    let fast = 0;
    let scramble = 0;
    for (let i = offset; i < sans.length; i += 2) {
        const clk = clocks[i];
        if (clk === null || clk === undefined) {
            prev = null;
            continue;
        }
        if (prev !== null && i >= bookPlies) {
            considered++;
            if (prev - clk + tc.inc <= threshold) fast++;
            if (clk < tc.base * 0.12) scramble++;
        }
        prev = clk;
    }
    return considered >= 8
        ? { fastRate: fast / considered, scramble: scramble / considered }
        : { fastRate: null, scramble: null };
}

type PhaseBucket = {
    accs: number[];
    accWeights: number[];
    losses: number[];
    complexitySum: number;
};

function newBucket(): PhaseBucket {
    return { accs: [], accWeights: [], losses: [], complexitySum: 0 };
}

function bucketStats(bucket: PhaseBucket): GamePhaseStats {
    const n = bucket.accs.length;
    return {
        accuracy: n ? gameAccuracy(bucket.accs, bucket.accWeights) : null,
        acpl: n ? bucket.losses.reduce((a, b) => a + b, 0) / n : null,
        scoredCount: n,
        complexity: n ? bucket.complexitySum / n : 4.5,
    };
}

// Full per-game quality pipeline for one side (buildReview equivalent).
// evals[i] = eval of the position AFTER i plies (evals.length === sans.length + 1),
// always White POV. bestMoves[i] = engine best move (UCI) in position i, or null.
export async function buildGameQualityStats(input: {
    sans: string[];
    evals: (EvalScore | null)[];
    bestMoves?: (string | null)[];
    color: "w" | "b";
    timeControl: { base: number; inc: number } | null;
    clocks: (number | null)[]; // per-ply remaining clock seconds, aligned with sans
    analysisDepth: number | null;
}): Promise<{
    stats: GameQualityStats;
    phases: Partial<Record<StrengthPhase, GamePhaseStats>>;
    counts: MoveLabelCounts;
    phaseBlunders: Record<StrengthPhase, number>;
    plies: number;
} | null> {
    const { sans, evals, bestMoves, color, timeControl, clocks, analysisDepth } = input;
    if (!sans.length) return null;
    const replay = replayGame(sans);
    if (!replay) return null;
    const { fens, legalCounts, uciMoves, terminalCheckmate } = replay;
    const book = await getOpeningBook();
    const bookPlies = matchBook(replay.sans, book).plies;

    const n = sans.length;
    const scores: (EvalScore | null)[] = [];
    for (let i = 0; i <= n; i++) scores.push(evals[i] ?? null);
    // Fill terminal eval if the engine skipped the final position (buildReview parity).
    if (!scores[n]) {
        if (terminalCheckmate) {
            const lastMover = (n - 1) % 2 === 0 ? "w" : "b";
            scores[n] = { mate: lastMover === "w" ? 1 : -1 };
        } else {
            scores[n] = { cp: 0 };
        }
    }

    // Use the nearest real eval for positions the engine skipped (book/forced),
    // rather than a fabricated dead-equal point that would distort the
    // volatility weights, complexity, and rating estimation downstream.
    const fallbackScoreNear = (idx: number): EvalScore => {
        const exact = scores[idx];
        if (exact) return exact;
        for (let d = 1; d <= n; d++) {
            const after = idx + d <= n ? scores[idx + d] : null;
            if (after) return after;
            const before = idx - d >= 0 ? scores[idx - d] : null;
            if (before) return before;
        }
        return { cp: 0 };
    };

    const winPcts: number[] = [];
    for (let i = 0; i <= n; i++) winPcts.push(winPctWhite(fallbackScoreNear(i)));
    const weights = volatilityWeights(winPcts);
    const movePhases = assignPhases(fens, bookPlies);

    const side = newBucket();
    const phaseBuckets: Record<StrengthPhase, PhaseBucket> = {
        opening: newBucket(),
        middlegame: newBucket(),
        endgame: newBucket(),
    };
    const counts: MoveLabelCounts = { inaccuracy: 0, mistake: 0, blunder: 0 };
    const phaseBlunders: Record<StrengthPhase, number> = { opening: 0, middlegame: 0, endgame: 0 };
    let bookCount = 0;
    let blunders = 0;

    for (let i = 0; i < n; i++) {
        const moverColor: "w" | "b" = i % 2 === 0 ? "w" : "b";
        const isBook = i < bookPlies;
        const isForced = legalCounts[i] === 1;
        const posBefore = scores[i];
        const posAfter = scores[i + 1];
        if (!posBefore || !posAfter) {
            // Book/forced moves without evals still count as book moves; other
            // unevaluated plies are skipped entirely (buildReview parity).
            if (isBook && moverColor === color) bookCount += 1;
            continue;
        }
        if (isBook || isForced) {
            if (isBook && moverColor === color) bookCount += 1;
            continue;
        }
        if (moverColor !== color) continue;

        const before = winPctFor(posBefore, moverColor);
        const after = winPctFor(posAfter, moverColor);
        const rawDrop = Math.max(0, before - after);
        // The pre-move search sometimes prefers a move that its own post-move
        // search refutes. A small disagreement on the engine's chosen move is
        // noise — score it as a clean best move; a large one means the deeper
        // post-move search knows better.
        const best = bestMoves?.[i] ?? null;
        const playedIsBest = best !== null && best === uciMoves[i] && rawDrop <= 6;
        const drop = playedIsBest ? 0 : rawDrop;

        const acc = moveAccuracy(drop);
        const cpBefore = moverColor === "w" ? scoreToCp(posBefore) : -scoreToCp(posBefore);
        const cpAfter = moverColor === "w" ? scoreToCp(posAfter) : -scoreToCp(posAfter);
        const cpLoss = playedIsBest ? 0 : Math.max(0, Math.min(CP_CEIL, cpBefore - cpAfter));

        const phase = movePhases[i];
        if (drop >= 20) {
            blunders += 1;
            counts.blunder += 1;
            phaseBlunders[phase] += 1;
        } else if (drop > 10) {
            counts.mistake += 1;
        } else if (drop > 5) {
            counts.inaccuracy += 1;
        }

        side.accs.push(acc);
        side.accWeights.push(weights[i] || 1);
        side.losses.push(cpLoss);
        side.complexitySum += weights[i] || 1;
        const phaseBucket = phaseBuckets[phase];
        phaseBucket.accs.push(acc);
        phaseBucket.accWeights.push(weights[i] || 1);
        phaseBucket.losses.push(cpLoss);
        phaseBucket.complexitySum += weights[i] || 1;
    }

    let fastRate: number | null = null;
    let scramble: number | null = null;
    if (timeControl) {
        const clockFeatures = clockFeaturesForSide(sans, clocks, timeControl, bookPlies, color);
        fastRate = clockFeatures.fastRate;
        scramble = clockFeatures.scramble;
    }

    const base = bucketStats(side);
    const stats: GameQualityStats = {
        accuracy: base.accuracy,
        acpl: base.acpl,
        scoredCount: base.scoredCount,
        complexity: base.complexity,
        bookMoves: bookCount,
        blunderRate: base.scoredCount ? blunders / base.scoredCount : 0,
        fastRate,
        scramble,
        analysisDepth,
    };
    const phases: Partial<Record<StrengthPhase, GamePhaseStats>> = {
        opening: bucketStats(phaseBuckets.opening),
        middlegame: bucketStats(phaseBuckets.middlegame),
        endgame: bucketStats(phaseBuckets.endgame),
    };

    return { stats, phases, counts, phaseBlunders, plies: n };
}
