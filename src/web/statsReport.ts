import { extractPgnMoves, gameAnalysisKey } from "./statsAnalysis";
import type { StatsFormSummary, StatsGame, StatsPerformance } from "./statsRating";
import { computeFormSummary, computePerformance } from "./statsRating";
import type { AnalyzedGameEntry, StrengthPhase } from "./statsStrength";
import { clockFeaturesForSide } from "./statsStrength";

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
        worstGames: { entry: AnalyzedGameEntry; game: StatsGame | null }[];
    } | null;
    highlights: {
        bestWin: StatsGame | null;
        longestWinStreak: number;
        mostPlayedOpponent: { name: string; games: number; scorePct: number } | null;
    };
    weekly: WeekSummary[];
};

const WEEKLY_MIN_WINDOW_DAYS = 10;
const WEEKLY_MAX_WEEKS = 320;
const OPENING_CALLOUT_MIN_GAMES = 3;
const MOST_PLAYED_MIN_GAMES = 2;
const MOVE_TIME_TOLERANCE_SECONDS = -0.75;
const WORST_GAMES_LIMIT = 3;
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
        perf: computePerformance(games, { currentRating, nowSec }),
        rating: computeRatingSpan(games),
        form: games.length > 0 ? computeFormSummary(games, { currentRating, nowSec }) : null,
        time: computeTimeStats(games),
        openings: computeOpenings(games),
        mistakes: computeMistakes(games, analyzed),
        highlights: computeHighlights(games),
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
    }

    const losses = games.filter((game) => game.result === "loss");
    const timeoutLosses = losses.filter((game) => game.termination === "timeout").length;

    if (gamesWithClocks === 0) return null;

    const byPhaseSeconds: Partial<Record<StrengthPhase, number>> = {};
    for (const phase of STRENGTH_PHASES) {
        const seconds = phaseSeconds[phase];
        if (seconds && seconds.length > 0) byPhaseSeconds[phase] = mean(seconds);
    }

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
    };
}

function collectGameClockStats(game: StatsGame): {
    moveTimes: { phase: StrengthPhase; seconds: number }[];
    fastRate: number | null;
    scramble: number | null;
    remainingPct: number | null;
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

    return {
        moveTimes,
        fastRate: features.fastRate,
        scramble: features.scramble,
        remainingPct:
            lastClock !== null && base > 0 ? clamp((lastClock / base) * 100, 0, 100) : null,
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

    const worstGames = matched
        .filter(({ entry }) => entry.counts.blunder > 0)
        .sort(
            (a, b) =>
                b.entry.counts.blunder - a.entry.counts.blunder ||
                (a.entry.stats.accuracy ?? 100) - (b.entry.stats.accuracy ?? 100),
        )
        .slice(0, WORST_GAMES_LIMIT)
        .map(({ entry, game }) => ({ entry, game: game as StatsGame | null }));

    return {
        analyzedGames: matched.length,
        avgAccuracy: accuracies.length > 0 ? mean(accuracies) : null,
        avgAcpl: acpls.length > 0 ? mean(acpls) : null,
        blundersPerGame: blunders / matched.length,
        mistakesPerGame: mistakes / matched.length,
        inaccuraciesPerGame: inaccuracies / matched.length,
        byPhase,
        worstGames,
    };
}

function computeHighlights(games: StatsGame[]): PeriodReport["highlights"] {
    let bestWin: StatsGame | null = null;
    for (const game of games) {
        if (game.result !== "win" || typeof game.opp !== "number") continue;
        if (!bestWin || game.opp >= (bestWin.opp ?? Number.NEGATIVE_INFINITY)) bestWin = game;
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

    return { bestWin, longestWinStreak, mostPlayedOpponent };
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
        const performance = computePerformance(weekGames, {
            currentRating: opts.currentRating,
            nowSec: Math.min(end, opts.nowSec),
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
