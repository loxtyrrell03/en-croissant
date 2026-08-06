import { extractPgnMoves, gameAnalysisKey } from "./statsAnalysis";
import type {
    StatsFormSummary,
    StatsGame,
    StatsPerformance,
    StatsProviderQuality,
} from "./statsRating";
import { computeFormSummary, computePeriodPerformance } from "./statsRating";
import type {
    AnalyzedGameEntry,
    AnalyzedSideQuality,
    DecisionBucketStats,
    StrengthPhase,
} from "./statsStrength";
import { clockFeaturesForSide, qualityBenchmarkForRating } from "./statsStrength";

export type OpeningAgg = {
    key: string;
    name: string;
    eco: string | null;
    color: "w" | "b";
    games: number;
    wins: number;
    draws: number;
    losses: number;
    scorePct: number;
};

export type WeekSummary = {
    start: number;
    end: number;
    label: string;
    games: number;
    scorePct: number | null;
    perf: number | null;
    ratingEnd: number | null;
};

export type OpponentBandSummary = {
    label: string;
    min: number;
    max: number;
    containsCurrentRating: boolean;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    scorePct: number;
    expectedScorePct: number;
    /** Actual score minus Elo-expected score, in percentage points. */
    scoreDeltaPct: number;
    avgOpponentRating: number;
    analyzedGames: number;
    analysisCoveragePct: number;
    accuracySamples: number;
    acplSamples: number;
    avgAccuracy: number | null;
    avgAcpl: number | null;
    inaccuraciesPerAnalyzedGame: number | null;
    mistakesPerAnalyzedGame: number | null;
    blundersPerAnalyzedGame: number | null;
    opponentAnalyzedGames: number;
    opponentAvgAccuracy: number | null;
    opponentAvgAcpl: number | null;
    opponentInaccuraciesPerAnalyzedGame: number | null;
    opponentMistakesPerAnalyzedGame: number | null;
    opponentBlundersPerAnalyzedGame: number | null;
    providerQualityMethod: "lichess" | null;
    providerAnalyzedGames: number;
    providerMistakesPerGame: number | null;
    providerBlundersPerGame: number | null;
    opponentProviderAnalyzedGames: number;
    opponentProviderMistakesPerGame: number | null;
    opponentProviderBlundersPerGame: number | null;
};

export type OpponentSummary = {
    totalGames: number;
    ratedGames: number;
    gamesWithOpponentRating: number;
    /** Selected games with usable player and opponent ratings divided by totalGames. */
    opponentRatingCoveragePct: number | null;
    avgOpponentRating: number | null;
    medianOpponentRating: number | null;
    minOpponentRating: number | null;
    maxOpponentRating: number | null;
    /** Mean opponent rating minus the player's rating in the same game. */
    avgRatingGap: number | null;
    scorePct: number | null;
    expectedScorePct: number | null;
    /** Actual score minus Elo-expected score, in percentage points. */
    scoreDeltaPct: number | null;
    bands: OpponentBandSummary[];
};

export type QualityAggregate = {
    games: number;
    accuracySamples: number;
    acplSamples: number;
    avgAccuracy: number | null;
    avgAcpl: number | null;
    inaccuraciesPerGame: number | null;
    mistakesPerGame: number | null;
    blundersPerGame: number | null;
    errorsPer100Moves: number | null;
    cleanGamePct: number | null;
};

export type DecisionContextSummary = {
    moves: number;
    errors: number;
    errorPct: number | null;
    accuracy: number | null;
};

export type SituationalSummary = {
    games: number;
    advantage: DecisionContextSummary;
    defence: DecisionContextSummary;
    balanced: DecisionContextSummary;
    critical: DecisionContextSummary;
    fast: DecisionContextSummary;
    longThink: DecisionContextSummary;
    timeTrouble: DecisionContextSummary;
    winningChances: number;
    convertedWinningChances: number;
    conversionPct: number | null;
    losingChances: number;
    savedLosingChances: number;
    savePct: number | null;
    avgMove15EvalCp: number | null;
    avgOpeningExitWinPct: number | null;
    endgames: {
        games: number;
        better: { games: number; scorePct: number | null };
        equal: { games: number; scorePct: number | null };
        worse: { games: number; scorePct: number | null };
    };
};

export type ProviderQualitySummary = {
    provider: "chesscom" | "lichess";
    playerSamples: number;
    opponentSamples: number;
    pairedSamples: number;
    avgPlayerAccuracy: number | null;
    avgOpponentAccuracy: number | null;
    accuracyDelta: number | null;
    avgPlayerAcpl: number | null;
    avgOpponentAcpl: number | null;
    playerErrorSamples: number;
    opponentErrorSamples: number;
    playerInaccuraciesPerGame: number | null;
    playerMistakesPerGame: number | null;
    playerBlundersPerGame: number | null;
    opponentInaccuraciesPerGame: number | null;
    opponentMistakesPerGame: number | null;
    opponentBlundersPerGame: number | null;
};

export type PatternSplit = {
    key: string;
    label: string;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    scorePct: number;
};

export type ReportGameRef = Pick<
    StatsGame,
    | "source"
    | "id"
    | "url"
    | "end"
    | "rating"
    | "result"
    | "opp"
    | "oppName"
    | "color"
    | "eco"
    | "openingName"
>;

export type PeriodReport = {
    window: { start: number; end: number; label: string };
    record: { games: number; wins: number; draws: number; losses: number; scorePct: number | null };
    perf: StatsPerformance | null;
    rating: { start: number | null; end: number | null; delta: number | null };
    form: StatsFormSummary | null;
    time: {
        avgMoveSeconds: number | null;
        medianMoveSeconds: number | null;
        fastMovePct: number | null;
        scramblePct: number | null;
        timeoutLosses: number;
        timeoutLossPct: number | null;
        avgRemainingPctAtEnd: number | null;
        byPhaseSeconds: Partial<Record<StrengthPhase, number>>;
        gamesWithClocks: number;
        clockBalanceAtMove20: Record<
            "ahead" | "even" | "behind",
            { games: number; scorePct: number | null }
        >;
        clockCurve: {
            move: number;
            games: number;
            playerRemainingPct: number;
            opponentRemainingPct: number;
        }[];
    } | null;
    openings: {
        white: OpeningAgg[];
        black: OpeningAgg[];
        best: OpeningAgg | null;
        worst: OpeningAgg | null;
    };
    mistakes: {
        analyzedGames: number;
        avgAccuracy: number | null;
        avgAcpl: number | null;
        blundersPerGame: number | null;
        mistakesPerGame: number | null;
        inaccuraciesPerGame: number | null;
        byPhase: Record<StrengthPhase, { blunders: number; share: number | null }>;
        phaseQuality: Record<
            StrengthPhase,
            { moves: number; avgAccuracy: number | null; avgAcpl: number | null }
        >;
        analysisCoveragePct: number;
        player: QualityAggregate;
        pairedGames: number;
        pairedPlayer: QualityAggregate | null;
        opponents: QualityAggregate | null;
        peerBenchmark: {
            samples: number;
            ratingBandLabel: string;
            expectedAccuracy: number;
            expectedAcpl: number;
            accuracyDelta: number | null;
            acplDelta: number | null;
        } | null;
        situations: SituationalSummary | null;
        worstGames: { entry: AnalyzedGameEntry; game: ReportGameRef | null }[];
    } | null;
    providerQuality: ProviderQualitySummary | null;
    opponents: OpponentSummary;
    highlights: {
        bestWin: ReportGameRef | null;
        longestWinStreak: number;
        mostPlayedOpponent: { name: string; games: number; scorePct: number } | null;
        worstLoss: ReportGameRef | null;
        upsetWins: number;
        upsetOpportunities: number;
        upsetRatePct: number | null;
        postLossScorePct: number | null;
    };
    patterns: {
        byColor: PatternSplit[];
        byWeekday: PatternSplit[];
    };
    weekly: WeekSummary[];
};

const WEEKLY_MIN_WINDOW_DAYS = 10;
const WEEKLY_MAX_WEEKS = 320;
const OPENING_CALLOUT_MIN_GAMES = 3;
const MOST_PLAYED_MIN_GAMES = 2;
const MOVE_TIME_TOLERANCE_SECONDS = -0.75;
const WORST_GAMES_LIMIT = 3;
const OPPONENT_RATING_BAND_SIZE = 200;
const STRENGTH_PHASES: StrengthPhase[] = ["opening", "middlegame", "endgame"];
const SHORT_MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

export function computePeriodReport(input: {
    games: StatsGame[];
    analyzed: AnalyzedGameEntry[];
    windowStart: number;
    windowEnd: number;
    label: string;
    nowSec: number;
    currentRating: number | null;
}): PeriodReport {
    const { analyzed, currentRating, label, nowSec, windowEnd, windowStart } = input;
    const games = input.games
        .filter((game) => game.end >= windowStart && game.end <= windowEnd)
        .sort((a, b) => a.end - b.end);

    return {
        window: { start: windowStart, end: windowEnd, label },
        record: computeRecord(games),
        perf: computePeriodPerformance(games, {
            currentRating,
            nowSec,
            windowStart,
            windowEnd,
        }),
        rating: computeRatingSpan(games),
        form: games.length > 0 ? computeFormSummary(games, { currentRating, nowSec }) : null,
        time: computeTimeStats(games),
        openings: computeOpenings(games),
        mistakes: computeMistakes(games, analyzed, currentRating),
        providerQuality: computeProviderQuality(games),
        opponents: computeOpponents(games, analyzed, currentRating),
        highlights: computeHighlights(games),
        patterns: computePatterns(games),
        weekly: computeWeekly(games, { windowStart, windowEnd, nowSec, currentRating }),
    };
}

// Monday 00:00 local time; offsetWeeks 0 = the week containing nowSec, -1 = the
// week before it. end is the last second before the following Monday.
export function getWeekWindow(
    offsetWeeks: number,
    nowSec: number,
): { start: number; end: number; label: string } {
    const start = startOfWeekSec(nowSec, offsetWeeks);
    const nextStart = addDaysSec(start, 7);
    return {
        start,
        end: nextStart - 1,
        label: formatWeekLabel(start),
    };
}

function computeRecord(games: StatsGame[]) {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    for (const game of games) {
        if (game.result === "win") wins += 1;
        else if (game.result === "draw") draws += 1;
        else losses += 1;
    }
    return {
        games: games.length,
        wins,
        draws,
        losses,
        scorePct: games.length > 0 ? ((wins + draws * 0.5) / games.length) * 100 : null,
    };
}

function computeRatingSpan(games: StatsGame[]) {
    const rated = games.filter((game) => game.rated && Number.isFinite(game.rating));
    if (rated.length === 0) return { start: null, end: null, delta: null };
    const start = rated[0].rating;
    const end = rated[rated.length - 1].rating;
    return { start, end, delta: end - start };
}

function computeTimeStats(games: StatsGame[]): PeriodReport["time"] {
    const allSeconds: number[] = [];
    const phaseSeconds: Partial<Record<StrengthPhase, number[]>> = {};
    const fastRates: number[] = [];
    const scrambleRates: number[] = [];
    const remainingPcts: number[] = [];
    const clockBalanceScores: Record<"ahead" | "even" | "behind", number[]> = {
        ahead: [],
        even: [],
        behind: [],
    };
    const clockCheckpoints = new Map<
        number,
        { playerRemainingPct: number; opponentRemainingPct: number }[]
    >();
    let gamesWithClocks = 0;

    for (const game of games) {
        const clockInfo = collectGameClockStats(game);
        if (!clockInfo) continue;
        gamesWithClocks += 1;
        for (const move of clockInfo.moveTimes) {
            allSeconds.push(move.seconds);
            (phaseSeconds[move.phase] ??= []).push(move.seconds);
        }
        if (clockInfo.fastRate !== null) fastRates.push(clockInfo.fastRate);
        if (clockInfo.scramble !== null) scrambleRates.push(clockInfo.scramble);
        if (clockInfo.remainingPct !== null) remainingPcts.push(clockInfo.remainingPct);
        if (clockInfo.balanceAtMove20) {
            clockBalanceScores[clockInfo.balanceAtMove20].push(gameScore(game));
        }
        for (const checkpoint of clockInfo.checkpoints) {
            const rows = clockCheckpoints.get(checkpoint.move) ?? [];
            rows.push(checkpoint);
            clockCheckpoints.set(checkpoint.move, rows);
        }
    }

    const losses = games.filter((game) => game.result === "loss");
    const timeoutLosses = losses.filter((game) => game.termination === "timeout").length;

    if (gamesWithClocks === 0) return null;

    const byPhaseSeconds: Partial<Record<StrengthPhase, number>> = {};
    for (const phase of STRENGTH_PHASES) {
        const seconds = phaseSeconds[phase];
        if (seconds && seconds.length > 0) byPhaseSeconds[phase] = mean(seconds);
    }

    const clockBalanceAtMove20 = {} as Record<
        "ahead" | "even" | "behind",
        { games: number; scorePct: number | null }
    >;
    for (const state of ["ahead", "even", "behind"] as const) {
        const scores = clockBalanceScores[state];
        clockBalanceAtMove20[state] = {
            games: scores.length,
            scorePct: scores.length > 0 ? mean(scores) * 100 : null,
        };
    }
    const clockCurve = Array.from(clockCheckpoints.entries())
        .sort(([left], [right]) => left - right)
        .map(([move, rows]) => ({
            move,
            games: rows.length,
            playerRemainingPct: mean(rows.map((row) => row.playerRemainingPct)),
            opponentRemainingPct: mean(rows.map((row) => row.opponentRemainingPct)),
        }));

    return {
        avgMoveSeconds: allSeconds.length > 0 ? mean(allSeconds) : null,
        medianMoveSeconds: allSeconds.length > 0 ? median(allSeconds) : null,
        fastMovePct: fastRates.length > 0 ? mean(fastRates) * 100 : null,
        scramblePct: scrambleRates.length > 0 ? mean(scrambleRates) * 100 : null,
        timeoutLosses,
        timeoutLossPct: losses.length > 0 ? (timeoutLosses / losses.length) * 100 : null,
        avgRemainingPctAtEnd: remainingPcts.length > 0 ? mean(remainingPcts) : null,
        byPhaseSeconds,
        gamesWithClocks,
        clockBalanceAtMove20,
        clockCurve,
    };
}

function collectGameClockStats(game: StatsGame): {
    moveTimes: { phase: StrengthPhase; seconds: number }[];
    fastRate: number | null;
    scramble: number | null;
    remainingPct: number | null;
    balanceAtMove20: "ahead" | "even" | "behind" | null;
    checkpoints: {
        move: number;
        playerRemainingPct: number;
        opponentRemainingPct: number;
    }[];
} | null {
    if (!game.pgn || !game.timeControl) return null;

    const { sans, clocks } = extractPgnMoves(game.pgn);
    if (sans.length === 0) return null;

    // Per-move think time mirrors liveReplay's getMoveTimeSeconds: previous
    // same-color clock (the base time before the first own move) + increment
    // minus the current clock, discarding readings below the -0.75s tolerance.
    const { base, inc } = game.timeControl;
    const offset = game.color === "w" ? 0 : 1;
    const moveTimes: { phase: StrengthPhase; seconds: number }[] = [];
    let previous: number | null = base;
    let lastClock: number | null = null;
    for (let index = offset; index < sans.length; index += 2) {
        const clock = clocks[index];
        if (typeof clock !== "number") {
            previous = null;
            continue;
        }
        if (previous !== null) {
            const seconds = previous + inc - clock;
            if (seconds >= MOVE_TIME_TOLERANCE_SECONDS) {
                moveTimes.push({
                    phase: phaseForPly(index + 1, sans.length),
                    seconds: Math.max(0, seconds),
                });
            }
        }
        previous = clock;
        lastClock = clock;
    }
    if (moveTimes.length === 0) return null;

    // Book plies are unknown here (the opening book only feeds the analysis
    // pipeline), so clock features are computed over the whole game.
    const features = clockFeaturesForSide(sans, clocks, game.timeControl, 0, game.color);
    const checkpoints = [10, 20, 30, 40].flatMap((move) => {
        const whiteClock = clocks[move * 2 - 2];
        const blackClock = clocks[move * 2 - 1];
        if (!isFiniteOptionalNumber(whiteClock) || !isFiniteOptionalNumber(blackClock)) return [];
        const playerClock = game.color === "w" ? whiteClock : blackClock;
        const opponentClock = game.color === "w" ? blackClock : whiteClock;
        return [
            {
                move,
                playerRemainingPct: clamp((playerClock / base) * 100, 0, 100),
                opponentRemainingPct: clamp((opponentClock / base) * 100, 0, 100),
            },
        ];
    });
    const move20 = checkpoints.find((checkpoint) => checkpoint.move === 20);
    const balanceAtMove20 = move20
        ? move20.playerRemainingPct >= move20.opponentRemainingPct * 1.2
            ? "ahead"
            : move20.opponentRemainingPct >= move20.playerRemainingPct * 1.2
              ? "behind"
              : "even"
        : null;

    return {
        moveTimes,
        fastRate: features.fastRate,
        scramble: features.scramble,
        remainingPct:
            lastClock !== null && base > 0 ? clamp((lastClock / base) * 100, 0, 100) : null,
        balanceAtMove20,
        checkpoints,
    };
}

// Phase boundaries are approximated with ply thresholds because neither the
// games nor the analyzed entries carry per-ply phase boundaries: opening =
// plies 1-16; when the game reached at least 60 plies its final third counts
// as the endgame (otherwise there is no endgame bucket); everything between is
// middlegame. This tracks review-core's phase machine closely enough for
// per-phase think-time averages.
function phaseForPly(ply: number, totalPlies: number): StrengthPhase {
    if (ply <= 16) return "opening";
    if (totalPlies >= 60 && ply > Math.floor((totalPlies * 2) / 3)) return "endgame";
    return "middlegame";
}

function computeOpenings(games: StatsGame[]): PeriodReport["openings"] {
    const groups = new Map<string, OpeningAgg>();
    for (const game of games) {
        const name = openingFamilyName(game);
        const key = `${game.color}|${name}`;
        let agg = groups.get(key);
        if (!agg) {
            agg = {
                key,
                name,
                eco: game.eco,
                color: game.color,
                games: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                scorePct: 0,
            };
            groups.set(key, agg);
        }
        if (agg.eco === null && game.eco !== null) agg.eco = game.eco;
        agg.games += 1;
        if (game.result === "win") agg.wins += 1;
        else if (game.result === "draw") agg.draws += 1;
        else agg.losses += 1;
    }

    const all = Array.from(groups.values());
    for (const agg of all) {
        agg.scorePct = ((agg.wins + agg.draws * 0.5) / agg.games) * 100;
    }
    all.sort(
        (a, b) => b.games - a.games || b.scorePct - a.scorePct || a.name.localeCompare(b.name),
    );

    const qualifying = all.filter((agg) => agg.games >= OPENING_CALLOUT_MIN_GAMES);
    let best: OpeningAgg | null = null;
    let worst: OpeningAgg | null = null;
    for (const agg of qualifying) {
        if (!best || agg.scorePct > best.scorePct) best = agg;
        if (!worst || agg.scorePct < worst.scorePct) worst = agg;
    }
    // A single qualifying family is a best, not also a struggle callout.
    if (best && worst && best.key === worst.key) worst = null;

    return {
        white: all.filter((agg) => agg.color === "w"),
        black: all.filter((agg) => agg.color === "b"),
        best,
        worst,
    };
}

// Groups by opening family: the opening name truncated at the first ":" or ","
// (lichess "Sicilian Defense: Najdorf Variation" and chess.com ECOUrl-derived
// names both lead with the family), falling back to the ECO code, then to
// "Unknown opening".
function openingFamilyName(game: StatsGame): string {
    const name = game.openingName?.trim();
    if (name) {
        const family = name.split(/[:,]/, 1)[0]?.trim();
        if (family) return family;
    }
    const eco = game.eco?.trim();
    return eco || "Unknown opening";
}

function computeMistakes(
    games: StatsGame[],
    analyzed: AnalyzedGameEntry[],
    currentRating: number | null,
): PeriodReport["mistakes"] {
    const entriesByKey = new Map(analyzed.map((entry) => [entry.key, entry]));
    const matched: { entry: AnalyzedGameEntry; game: StatsGame }[] = [];
    for (const game of games) {
        const entry = entriesByKey.get(gameAnalysisKey(game));
        if (entry) matched.push({ entry, game });
    }
    if (matched.length === 0) return null;

    const accuracies = matched
        .map(({ entry }) => entry.stats.accuracy)
        .filter((value): value is number => value !== null);
    const acpls = matched
        .map(({ entry }) => entry.stats.acpl)
        .filter((value): value is number => value !== null);

    let inaccuracies = 0;
    let mistakes = 0;
    let blunders = 0;
    const phaseBlunders: Record<StrengthPhase, number> = { opening: 0, middlegame: 0, endgame: 0 };
    for (const { entry } of matched) {
        inaccuracies += entry.counts.inaccuracy;
        mistakes += entry.counts.mistake;
        blunders += entry.counts.blunder;
        for (const phase of STRENGTH_PHASES) {
            phaseBlunders[phase] += entry.phaseBlunders[phase] ?? 0;
        }
    }
    const totalPhaseBlunders =
        phaseBlunders.opening + phaseBlunders.middlegame + phaseBlunders.endgame;

    const byPhase = {} as Record<StrengthPhase, { blunders: number; share: number | null }>;
    for (const phase of STRENGTH_PHASES) {
        byPhase[phase] = {
            blunders: phaseBlunders[phase],
            // Share of all phase-attributed blunders, as a 0..1 fraction.
            share: totalPhaseBlunders > 0 ? phaseBlunders[phase] / totalPhaseBlunders : null,
        };
    }

    const phaseQuality = {} as Record<
        StrengthPhase,
        { moves: number; avgAccuracy: number | null; avgAcpl: number | null }
    >;
    for (const phase of STRENGTH_PHASES) {
        let moves = 0;
        let accuracyTotal = 0;
        let accuracyMoves = 0;
        let acplTotal = 0;
        let acplMoves = 0;
        for (const { entry } of matched) {
            const bucket = entry.phases[phase];
            if (!bucket || bucket.scoredCount <= 0) continue;
            moves += bucket.scoredCount;
            if (bucket.accuracy !== null && Number.isFinite(bucket.accuracy)) {
                accuracyTotal += bucket.accuracy * bucket.scoredCount;
                accuracyMoves += bucket.scoredCount;
            }
            if (bucket.acpl !== null && Number.isFinite(bucket.acpl)) {
                acplTotal += bucket.acpl * bucket.scoredCount;
                acplMoves += bucket.scoredCount;
            }
        }
        phaseQuality[phase] = {
            moves,
            avgAccuracy: accuracyMoves > 0 ? accuracyTotal / accuracyMoves : null,
            avgAcpl: acplMoves > 0 ? acplTotal / acplMoves : null,
        };
    }

    const player = aggregateQuality(matched.map(({ entry }) => entry));
    const pairedMatched = matched.filter(
        (
            row,
        ): row is typeof row & {
            entry: AnalyzedGameEntry & { opponentQuality: AnalyzedSideQuality };
        } => row.entry.opponentQuality !== undefined,
    );
    const pairedPlayer =
        pairedMatched.length > 0 ? aggregateQuality(pairedMatched.map(({ entry }) => entry)) : null;
    const opponentSides = pairedMatched.map(({ entry }) => entry.opponentQuality);
    const opponents = opponentSides.length > 0 ? aggregateQuality(opponentSides) : null;
    const comparisonPlayer = pairedPlayer ?? player;

    // The comparison table must use one denominator. New entries carry both
    // sides from the same engine pass; legacy entries remain useful for the
    // player's phase/history views but never get mixed into the Opp column.
    const comparisonMatched = pairedMatched.length > 0 ? pairedMatched : matched;
    const benchmarks = comparisonMatched
        .map(({ game }) =>
            qualityBenchmarkForRating({
                rating: game.rating,
                source: game.source,
                timeControl: game.timeControl,
            }),
        )
        .filter((benchmark): benchmark is NonNullable<typeof benchmark> => benchmark !== null);
    const comparisonRating =
        typeof currentRating === "number" && Number.isFinite(currentRating)
            ? currentRating
            : mean(comparisonMatched.map(({ game }) => game.rating));
    const ratingBandMin =
        Math.floor(comparisonRating / OPPONENT_RATING_BAND_SIZE) * OPPONENT_RATING_BAND_SIZE;
    const peerBenchmark =
        benchmarks.length > 0
            ? (() => {
                  const expectedAccuracy = mean(benchmarks.map((benchmark) => benchmark.accuracy));
                  const expectedAcpl = mean(benchmarks.map((benchmark) => benchmark.acpl));
                  return {
                      samples: benchmarks.length,
                      ratingBandLabel: `${ratingBandMin}-${ratingBandMin + OPPONENT_RATING_BAND_SIZE - 1}`,
                      expectedAccuracy,
                      expectedAcpl,
                      accuracyDelta:
                          comparisonPlayer.avgAccuracy !== null
                              ? comparisonPlayer.avgAccuracy - expectedAccuracy
                              : null,
                      acplDelta:
                          comparisonPlayer.avgAcpl !== null
                              ? comparisonPlayer.avgAcpl - expectedAcpl
                              : null,
                  };
              })()
            : null;

    const situations = computeSituations(matched);

    const worstGames = matched
        .filter(({ entry }) => entry.counts.blunder > 0)
        .sort(
            (a, b) =>
                b.entry.counts.blunder - a.entry.counts.blunder ||
                (a.entry.stats.accuracy ?? 100) - (b.entry.stats.accuracy ?? 100),
        )
        .slice(0, WORST_GAMES_LIMIT)
        .map(({ entry, game }) => ({ entry, game: toReportGameRef(game) }));

    return {
        analyzedGames: matched.length,
        avgAccuracy: accuracies.length > 0 ? mean(accuracies) : null,
        avgAcpl: acpls.length > 0 ? mean(acpls) : null,
        blundersPerGame: blunders / matched.length,
        mistakesPerGame: mistakes / matched.length,
        inaccuraciesPerGame: inaccuracies / matched.length,
        byPhase,
        phaseQuality,
        analysisCoveragePct: games.length > 0 ? (matched.length / games.length) * 100 : 0,
        player,
        pairedGames: pairedMatched.length,
        pairedPlayer,
        opponents,
        peerBenchmark,
        situations,
        worstGames,
    };
}

type QualitySide = Pick<AnalyzedSideQuality, "stats" | "counts">;

function aggregateQuality(sides: QualitySide[]): QualityAggregate {
    const accuracies = sides
        .map((side) => side.stats.accuracy)
        .filter((value): value is number => value !== null && Number.isFinite(value));
    const acpls = sides
        .map((side) => side.stats.acpl)
        .filter((value): value is number => value !== null && Number.isFinite(value));
    const inaccuracies = sides.reduce((sum, side) => sum + side.counts.inaccuracy, 0);
    const mistakes = sides.reduce((sum, side) => sum + side.counts.mistake, 0);
    const blunders = sides.reduce((sum, side) => sum + side.counts.blunder, 0);
    const scoredMoves = sides.reduce((sum, side) => sum + side.stats.scoredCount, 0);
    const cleanGames = sides.filter(
        (side) => side.counts.mistake === 0 && side.counts.blunder === 0,
    ).length;
    return {
        games: sides.length,
        accuracySamples: accuracies.length,
        acplSamples: acpls.length,
        avgAccuracy: accuracies.length > 0 ? mean(accuracies) : null,
        avgAcpl: acpls.length > 0 ? mean(acpls) : null,
        inaccuraciesPerGame: sides.length > 0 ? inaccuracies / sides.length : null,
        mistakesPerGame: sides.length > 0 ? mistakes / sides.length : null,
        blundersPerGame: sides.length > 0 ? blunders / sides.length : null,
        errorsPer100Moves: scoredMoves > 0 ? ((mistakes + blunders) / scoredMoves) * 100 : null,
        cleanGamePct: sides.length > 0 ? (cleanGames / sides.length) * 100 : null,
    };
}

function computeSituations(
    matched: { entry: AnalyzedGameEntry; game: StatsGame }[],
): SituationalSummary | null {
    const withAdvanced = matched.filter(
        (
            row,
        ): row is typeof row & {
            entry: AnalyzedGameEntry & { advanced: NonNullable<AnalyzedGameEntry["advanced"]> };
        } => row.entry.advanced !== undefined,
    );
    if (withAdvanced.length === 0) return null;

    const combineDecision = (
        key: keyof Pick<
            NonNullable<AnalyzedGameEntry["advanced"]>,
            "advantage" | "defence" | "balanced" | "critical" | "fast" | "longThink" | "timeTrouble"
        >,
    ): DecisionContextSummary => {
        const buckets: DecisionBucketStats[] = withAdvanced.map(({ entry }) => entry.advanced[key]);
        const moves = buckets.reduce((sum, bucket) => sum + bucket.moves, 0);
        const errors = buckets.reduce((sum, bucket) => sum + bucket.errors, 0);
        const accuracyWeight = buckets.reduce(
            (sum, bucket) => sum + (bucket.accuracy === null ? 0 : bucket.moves),
            0,
        );
        const accuracyTotal = buckets.reduce(
            (sum, bucket) => sum + (bucket.accuracy === null ? 0 : bucket.accuracy * bucket.moves),
            0,
        );
        return {
            moves,
            errors,
            errorPct: moves > 0 ? (errors / moves) * 100 : null,
            accuracy: accuracyWeight > 0 ? accuracyTotal / accuracyWeight : null,
        };
    };

    const winningRows = withAdvanced.filter(({ entry }) => entry.advanced.hadWinningPosition);
    const losingRows = withAdvanced.filter(({ entry }) => entry.advanced.hadLosingPosition);
    const convertedWinningChances = winningRows.filter(
        ({ entry }) => entry.advanced.convertedWinningPosition === true,
    ).length;
    const savedLosingChances = losingRows.filter(
        ({ entry }) => entry.advanced.savedLosingPosition === true,
    ).length;
    const move15Evals = withAdvanced
        .map(({ entry }) => entry.advanced.move15EvalCp)
        .filter((value): value is number => value !== null && Number.isFinite(value));
    const openingExitWinPcts = withAdvanced
        .map(({ entry }) => entry.advanced.openingExitWinPct)
        .filter((value): value is number => value !== null && Number.isFinite(value));
    const endgameRows = withAdvanced.filter(
        ({ entry }) =>
            entry.advanced.endgameEntryEvalCp !== null &&
            Number.isFinite(entry.advanced.endgameEntryEvalCp),
    );
    const endgameBucket = (predicate: (evaluation: number) => boolean) => {
        const rows = endgameRows.filter(({ entry }) =>
            predicate(entry.advanced.endgameEntryEvalCp as number),
        );
        return {
            games: rows.length,
            scorePct: rows.length > 0 ? mean(rows.map(({ game }) => gameScore(game))) * 100 : null,
        };
    };

    return {
        games: withAdvanced.length,
        advantage: combineDecision("advantage"),
        defence: combineDecision("defence"),
        balanced: combineDecision("balanced"),
        critical: combineDecision("critical"),
        fast: combineDecision("fast"),
        longThink: combineDecision("longThink"),
        timeTrouble: combineDecision("timeTrouble"),
        winningChances: winningRows.length,
        convertedWinningChances,
        conversionPct:
            winningRows.length > 0 ? (convertedWinningChances / winningRows.length) * 100 : null,
        losingChances: losingRows.length,
        savedLosingChances,
        savePct: losingRows.length > 0 ? (savedLosingChances / losingRows.length) * 100 : null,
        avgMove15EvalCp: move15Evals.length > 0 ? mean(move15Evals) : null,
        avgOpeningExitWinPct: openingExitWinPcts.length > 0 ? mean(openingExitWinPcts) : null,
        endgames: {
            games: endgameRows.length,
            better: endgameBucket((evaluation) => evaluation >= 100),
            equal: endgameBucket((evaluation) => evaluation > -100 && evaluation < 100),
            worse: endgameBucket((evaluation) => evaluation <= -100),
        },
    };
}

function computeProviderQuality(games: StatsGame[]): ProviderQualitySummary | null {
    const providers: ProviderQualitySummary["provider"][] = ["chesscom", "lichess"];
    const summaries = providers
        .map((provider): ProviderQualitySummary | null => {
            const playerQualities = games
                .map((game) => game.providerQuality)
                .filter(
                    (quality): quality is StatsProviderQuality => quality?.provider === provider,
                );
            const opponentQualities = games
                .map((game) => game.opponentProviderQuality)
                .filter(
                    (quality): quality is StatsProviderQuality => quality?.provider === provider,
                );
            const player = aggregateProviderQualities(playerQualities);
            const opponent = aggregateProviderQualities(opponentQualities);
            const pairs = games
                .map((game) => ({
                    player:
                        game.providerQuality?.provider === provider
                            ? game.providerQuality.accuracy
                            : null,
                    opponent:
                        game.opponentProviderQuality?.provider === provider
                            ? game.opponentProviderQuality.accuracy
                            : null,
                }))
                .filter(
                    (pair): pair is { player: number; opponent: number } =>
                        isFiniteOptionalNumber(pair.player) &&
                        isFiniteOptionalNumber(pair.opponent),
                );
            if (player.samples === 0 && opponent.samples === 0) return null;
            return {
                provider,
                playerSamples: player.accuracySamples,
                opponentSamples: opponent.accuracySamples,
                pairedSamples: pairs.length,
                avgPlayerAccuracy: player.avgAccuracy,
                avgOpponentAccuracy: opponent.avgAccuracy,
                accuracyDelta:
                    pairs.length > 0
                        ? mean(pairs.map((pair) => pair.player - pair.opponent))
                        : null,
                avgPlayerAcpl: player.avgAcpl,
                avgOpponentAcpl: opponent.avgAcpl,
                playerErrorSamples: player.errorSamples,
                opponentErrorSamples: opponent.errorSamples,
                playerInaccuraciesPerGame: player.inaccuraciesPerGame,
                playerMistakesPerGame: player.mistakesPerGame,
                playerBlundersPerGame: player.blundersPerGame,
                opponentInaccuraciesPerGame: opponent.inaccuraciesPerGame,
                opponentMistakesPerGame: opponent.mistakesPerGame,
                opponentBlundersPerGame: opponent.blundersPerGame,
            };
        })
        .filter((summary): summary is ProviderQualitySummary => summary !== null)
        .sort(
            (left, right) =>
                right.playerSamples +
                right.opponentSamples -
                (left.playerSamples + left.opponentSamples),
        );
    return summaries[0] ?? null;
}

type ProviderQualityAggregate = {
    samples: number;
    accuracySamples: number;
    avgAccuracy: number | null;
    avgAcpl: number | null;
    errorSamples: number;
    inaccuraciesPerGame: number | null;
    mistakesPerGame: number | null;
    blundersPerGame: number | null;
};

function aggregateProviderQualities(qualities: StatsProviderQuality[]): ProviderQualityAggregate {
    const accuracies = qualities.map((quality) => quality.accuracy).filter(isFiniteOptionalNumber);
    const acpls = qualities.map((quality) => quality.acpl).filter(isFiniteOptionalNumber);
    const errors = qualities.filter(hasCompleteProviderCounts);
    return {
        samples: qualities.length,
        accuracySamples: accuracies.length,
        avgAccuracy: accuracies.length > 0 ? mean(accuracies) : null,
        avgAcpl: acpls.length > 0 ? mean(acpls) : null,
        errorSamples: errors.length,
        inaccuraciesPerGame:
            errors.length > 0 ? mean(errors.map((quality) => quality.inaccuracies)) : null,
        mistakesPerGame: errors.length > 0 ? mean(errors.map((quality) => quality.mistakes)) : null,
        blundersPerGame: errors.length > 0 ? mean(errors.map((quality) => quality.blunders)) : null,
    };
}

function hasCompleteProviderCounts(
    quality: StatsProviderQuality,
): quality is StatsProviderQuality & {
    inaccuracies: number;
    mistakes: number;
    blunders: number;
} {
    return (
        isFiniteOptionalNumber(quality.inaccuracies) &&
        isFiniteOptionalNumber(quality.mistakes) &&
        isFiniteOptionalNumber(quality.blunders)
    );
}

function isFiniteOptionalNumber(value: number | null | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function computeOpponents(
    games: StatsGame[],
    analyzed: AnalyzedGameEntry[],
    currentRating: number | null,
): OpponentSummary {
    const ratedGames = games.filter((game) => game.rated);
    const eligibleGames = games.filter(
        (game): game is StatsGame & { opp: number } =>
            isUsableRating(game.rating) && isUsableRating(game.opp),
    );
    const opponentRatings = eligibleGames.map((game) => game.opp);
    const actualScores = eligibleGames.map(gameScore);
    const expectedScores = eligibleGames.map((game) => expectedScore(game.rating, game.opp));
    const scorePct = actualScores.length > 0 ? mean(actualScores) * 100 : null;
    const expectedScorePct = expectedScores.length > 0 ? mean(expectedScores) * 100 : null;
    const entriesByKey = new Map(analyzed.map((entry) => [entry.key, entry]));
    const bandGames = new Map<number, (StatsGame & { opp: number })[]>();

    for (const game of eligibleGames) {
        const min = Math.floor(game.opp / OPPONENT_RATING_BAND_SIZE) * OPPONENT_RATING_BAND_SIZE;
        const bucket = bandGames.get(min) ?? [];
        bucket.push(game);
        bandGames.set(min, bucket);
    }

    const bands = Array.from(bandGames.entries())
        .sort(([left], [right]) => left - right)
        .map(([min, bucket]): OpponentBandSummary => {
            const max = min + OPPONENT_RATING_BAND_SIZE - 1;
            const wins = bucket.filter((game) => game.result === "win").length;
            const draws = bucket.filter((game) => game.result === "draw").length;
            const losses = bucket.length - wins - draws;
            const bucketScorePct = mean(bucket.map(gameScore)) * 100;
            const bucketExpectedScorePct =
                mean(bucket.map((game) => expectedScore(game.rating, game.opp))) * 100;
            const analyzedEntries = bucket
                .map((game) => entriesByKey.get(gameAnalysisKey(game)))
                .filter((entry): entry is AnalyzedGameEntry => entry !== undefined);
            const pairedEngineEntries = analyzedEntries.filter(
                (entry): entry is AnalyzedGameEntry & { opponentQuality: AnalyzedSideQuality } =>
                    entry.opponentQuality !== undefined,
            );
            const accuracies = pairedEngineEntries
                .map((entry) => entry.stats.accuracy)
                .filter((value): value is number => value !== null && Number.isFinite(value));
            const acpls = pairedEngineEntries
                .map((entry) => entry.stats.acpl)
                .filter((value): value is number => value !== null && Number.isFinite(value));
            const inaccuracies = pairedEngineEntries.reduce(
                (sum, entry) => sum + entry.counts.inaccuracy,
                0,
            );
            const mistakes = pairedEngineEntries.reduce(
                (sum, entry) => sum + entry.counts.mistake,
                0,
            );
            const blunders = pairedEngineEntries.reduce(
                (sum, entry) => sum + entry.counts.blunder,
                0,
            );
            const opponentEntries = pairedEngineEntries.map((entry) => entry.opponentQuality);
            const opponentQuality =
                opponentEntries.length > 0 ? aggregateQuality(opponentEntries) : null;
            const pairedProviderQualities: {
                player: StatsProviderQuality;
                opponent: StatsProviderQuality;
            }[] = [];
            for (const game of bucket) {
                const playerQuality = game.providerQuality;
                const opponentQuality = game.opponentProviderQuality;
                if (
                    playerQuality?.provider === "lichess" &&
                    opponentQuality?.provider === "lichess" &&
                    hasCompleteProviderCounts(playerQuality) &&
                    hasCompleteProviderCounts(opponentQuality)
                ) {
                    pairedProviderQualities.push({
                        player: playerQuality,
                        opponent: opponentQuality,
                    });
                }
            }
            const playerProviderQuality = aggregateProviderQualities(
                pairedProviderQualities.map((pair) => pair.player),
            );
            const opponentProviderQuality = aggregateProviderQualities(
                pairedProviderQualities.map((pair) => pair.opponent),
            );

            return {
                label: `${min}-${max}`,
                min,
                max,
                containsCurrentRating:
                    typeof currentRating === "number" &&
                    Number.isFinite(currentRating) &&
                    currentRating >= min &&
                    currentRating < min + OPPONENT_RATING_BAND_SIZE,
                games: bucket.length,
                wins,
                draws,
                losses,
                scorePct: bucketScorePct,
                expectedScorePct: bucketExpectedScorePct,
                scoreDeltaPct: bucketScorePct - bucketExpectedScorePct,
                avgOpponentRating: mean(bucket.map((game) => game.opp)),
                analyzedGames: pairedEngineEntries.length,
                analysisCoveragePct: (pairedEngineEntries.length / bucket.length) * 100,
                accuracySamples: accuracies.length,
                acplSamples: acpls.length,
                avgAccuracy: accuracies.length > 0 ? mean(accuracies) : null,
                avgAcpl: acpls.length > 0 ? mean(acpls) : null,
                inaccuraciesPerAnalyzedGame:
                    pairedEngineEntries.length > 0
                        ? inaccuracies / pairedEngineEntries.length
                        : null,
                mistakesPerAnalyzedGame:
                    pairedEngineEntries.length > 0 ? mistakes / pairedEngineEntries.length : null,
                blundersPerAnalyzedGame:
                    pairedEngineEntries.length > 0 ? blunders / pairedEngineEntries.length : null,
                opponentAnalyzedGames: opponentEntries.length,
                opponentAvgAccuracy: opponentQuality?.avgAccuracy ?? null,
                opponentAvgAcpl: opponentQuality?.avgAcpl ?? null,
                opponentInaccuraciesPerAnalyzedGame: opponentQuality?.inaccuraciesPerGame ?? null,
                opponentMistakesPerAnalyzedGame: opponentQuality?.mistakesPerGame ?? null,
                opponentBlundersPerAnalyzedGame: opponentQuality?.blundersPerGame ?? null,
                providerQualityMethod: pairedProviderQualities.length > 0 ? "lichess" : null,
                providerAnalyzedGames: playerProviderQuality.errorSamples,
                providerMistakesPerGame: playerProviderQuality.mistakesPerGame,
                providerBlundersPerGame: playerProviderQuality.blundersPerGame,
                opponentProviderAnalyzedGames: opponentProviderQuality.errorSamples,
                opponentProviderMistakesPerGame: opponentProviderQuality.mistakesPerGame,
                opponentProviderBlundersPerGame: opponentProviderQuality.blundersPerGame,
            };
        });

    return {
        totalGames: games.length,
        ratedGames: ratedGames.length,
        gamesWithOpponentRating: eligibleGames.length,
        opponentRatingCoveragePct:
            games.length > 0 ? (eligibleGames.length / games.length) * 100 : null,
        avgOpponentRating: opponentRatings.length > 0 ? mean(opponentRatings) : null,
        medianOpponentRating: opponentRatings.length > 0 ? median(opponentRatings) : null,
        minOpponentRating: opponentRatings.length > 0 ? Math.min(...opponentRatings) : null,
        maxOpponentRating: opponentRatings.length > 0 ? Math.max(...opponentRatings) : null,
        avgRatingGap:
            eligibleGames.length > 0
                ? mean(eligibleGames.map((game) => game.opp - game.rating))
                : null,
        scorePct,
        expectedScorePct,
        scoreDeltaPct:
            scorePct !== null && expectedScorePct !== null ? scorePct - expectedScorePct : null,
        bands,
    };
}

function gameScore(game: StatsGame): number {
    return game.result === "win" ? 1 : game.result === "draw" ? 0.5 : 0;
}

function expectedScore(playerRating: number, opponentRating: number): number {
    return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function isUsableRating(value: number | null): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function computeHighlights(games: StatsGame[]): PeriodReport["highlights"] {
    let bestWin: StatsGame | null = null;
    let worstLoss: StatsGame | null = null;
    for (const game of games) {
        if (typeof game.opp !== "number") continue;
        if (
            game.result === "win" &&
            (!bestWin || game.opp >= (bestWin.opp ?? Number.NEGATIVE_INFINITY))
        ) {
            bestWin = game;
        }
        if (
            game.result === "loss" &&
            (!worstLoss || game.opp <= (worstLoss.opp ?? Number.POSITIVE_INFINITY))
        ) {
            worstLoss = game;
        }
    }

    let longestWinStreak = 0;
    let run = 0;
    for (const game of games) {
        run = game.result === "win" ? run + 1 : 0;
        longestWinStreak = Math.max(longestWinStreak, run);
    }

    const opponents = new Map<string, { name: string; games: number; score: number }>();
    for (const game of games) {
        const name = game.oppName?.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const record = opponents.get(key) ?? { name, games: 0, score: 0 };
        record.games += 1;
        record.score += game.result === "win" ? 1 : game.result === "draw" ? 0.5 : 0;
        opponents.set(key, record);
    }
    let mostPlayedOpponent: { name: string; games: number; scorePct: number } | null = null;
    for (const record of opponents.values()) {
        if (record.games < MOST_PLAYED_MIN_GAMES) continue;
        if (!mostPlayedOpponent || record.games > mostPlayedOpponent.games) {
            mostPlayedOpponent = {
                name: record.name,
                games: record.games,
                scorePct: (record.score / record.games) * 100,
            };
        }
    }

    const upsetOpportunities = games.filter(
        (game) => isUsableRating(game.opp) && game.opp >= game.rating + 100,
    );
    const upsetWins = upsetOpportunities.filter((game) => game.result === "win").length;
    const postLossGames = games.filter(
        (_, index) => index > 0 && games[index - 1].result === "loss",
    );

    return {
        bestWin: bestWin ? toReportGameRef(bestWin) : null,
        longestWinStreak,
        mostPlayedOpponent,
        worstLoss: worstLoss ? toReportGameRef(worstLoss) : null,
        upsetWins,
        upsetOpportunities: upsetOpportunities.length,
        upsetRatePct:
            upsetOpportunities.length > 0 ? (upsetWins / upsetOpportunities.length) * 100 : null,
        postLossScorePct:
            postLossGames.length > 0 ? mean(postLossGames.map(gameScore)) * 100 : null,
    };
}

function toReportGameRef(game: StatsGame): ReportGameRef {
    return {
        source: game.source,
        id: game.id,
        url: game.url,
        end: game.end,
        rating: game.rating,
        result: game.result,
        opp: game.opp,
        oppName: game.oppName,
        color: game.color,
        eco: game.eco,
        openingName: game.openingName,
    };
}

function computePatterns(games: StatsGame[]): PeriodReport["patterns"] {
    const byColor = (["w", "b"] as const)
        .map((color) =>
            buildPatternSplit(
                color,
                color === "w" ? "White" : "Black",
                games.filter((game) => game.color === color),
            ),
        )
        .filter((split): split is PatternSplit => split !== null);

    const weekdayLabels = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    const mondayFirst = [1, 2, 3, 4, 5, 6, 0];
    const byWeekday = mondayFirst
        .map((day) =>
            buildPatternSplit(
                String(day),
                weekdayLabels[day],
                games.filter((game) => new Date(game.end * 1000).getDay() === day),
            ),
        )
        .filter((split): split is PatternSplit => split !== null);

    return { byColor, byWeekday };
}

function buildPatternSplit(key: string, label: string, games: StatsGame[]): PatternSplit | null {
    if (games.length === 0) return null;
    const record = computeRecord(games);
    return {
        key,
        label,
        games: games.length,
        wins: record.wins,
        draws: record.draws,
        losses: record.losses,
        scorePct: record.scorePct ?? 0,
    };
}

function computeWeekly(
    games: StatsGame[],
    opts: { windowStart: number; windowEnd: number; nowSec: number; currentRating: number | null },
): WeekSummary[] {
    if (opts.windowEnd - opts.windowStart <= WEEKLY_MIN_WINDOW_DAYS * 86400) return [];

    const weeks: WeekSummary[] = [];
    const lastWeekStart = startOfWeekSec(opts.windowEnd, 0);
    for (
        let start = startOfWeekSec(opts.windowStart, 0);
        start <= lastWeekStart && weeks.length < WEEKLY_MAX_WEEKS;
        start = addDaysSec(start, 7)
    ) {
        const end = addDaysSec(start, 7) - 1;
        const weekGames = games.filter((game) => game.end >= start && game.end <= end);
        const record = computeRecord(weekGames);
        const performance = computePeriodPerformance(weekGames, {
            currentRating: opts.currentRating,
            nowSec: Math.min(end, opts.nowSec),
            windowStart: start,
            windowEnd: end,
        });
        const rated = weekGames.filter((game) => game.rated && Number.isFinite(game.rating));
        weeks.push({
            start,
            end,
            label: formatWeekLabel(start),
            games: weekGames.length,
            scorePct: record.scorePct,
            perf: performance ? performance.perf : null,
            ratingEnd: rated.length > 0 ? rated[rated.length - 1].rating : null,
        });
    }
    return weeks;
}

function startOfWeekSec(sec: number, offsetWeeks: number): number {
    const date = new Date(sec * 1000);
    const monday = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() - ((date.getDay() + 6) % 7) + offsetWeeks * 7,
    );
    return Math.floor(monday.getTime() / 1000);
}

// Local-calendar day arithmetic so weeks stay aligned across DST changes.
function addDaysSec(sec: number, days: number): number {
    const date = new Date(sec * 1000);
    const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    return Math.floor(shifted.getTime() / 1000);
}

function formatWeekLabel(weekStartSec: number): string {
    return `${formatShortDate(weekStartSec)} – ${formatShortDate(addDaysSec(weekStartSec, 6))}`;
}

function formatShortDate(sec: number): string {
    const date = new Date(sec * 1000);
    return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
    const ordered = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high);
}
