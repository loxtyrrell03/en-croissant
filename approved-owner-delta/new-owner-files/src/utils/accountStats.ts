import type { Color } from "chessops";
import { getGamePhases } from "@/utils/phase";
import { treeIteratorMainLine } from "@/utils/treeReducer";
import { parsePGN } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { query_games, type Speed } from "@/utils/db";
import { getTimeControl } from "@/utils/timeControl";
import { getAccuracy, getCPLoss, getWinChance, normalizeScore } from "@/utils/score";
import type { NormalizedGame, Score } from "@/bindings";
import type { OnlineGameSource } from "@/utils/onlineGameSource";

export type AccountStatsPeriod =
    | "week"
    | "month"
    | "3months"
    | "6months"
    | "year"
    | "2years"
    | "all";

export type AccountStatsSpeed = "all" | "bullet" | "blitz" | "rapid" | "classical";

export type AccountStatsMetricId =
    | "performance"
    | "opening"
    | "middlegame"
    | "endgame"
    | "advantageCapitalization"
    | "resourcefulness"
    | "timeManagement";

export type AccountStatsAccount = {
    source: OnlineGameSource;
    username: string;
};

export type RatingBandComparison = {
    id: "below" | "current" | "above";
    label: string;
    min: number;
    max: number;
    center: number;
    metrics: Record<AccountStatsMetricId, number>;
};

export type AccountStatsMetric = {
    id: AccountStatsMetricId;
    label: string;
    value: number | null;
    sample: number;
    confidence: "low" | "medium" | "high";
    evidence: string;
};

export type AccountStatsReport = {
    databasePath: string;
    account: AccountStatsAccount;
    period: AccountStatsPeriod;
    speed: AccountStatsSpeed;
    benchmarkSpeed: Exclude<AccountStatsSpeed, "all">;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    scorePct: number;
    expectedScorePct: number | null;
    latestRating: number | null;
    lichessRating: number | null;
    lichessRatingUncertainty: number;
    ratingSource: string;
    benchmarkSource: string;
    evalMoves: number;
    clockMoves: number;
    processedGames: number;
    skippedGames: number;
    metrics: AccountStatsMetric[];
    comparisons: RatingBandComparison[];
};

type Phase = "opening" | "middlegame" | "endgame";

type StatBucket = {
    count: number;
    total: number;
};

type PhaseBucket = {
    moves: number;
    accuracy: StatBucket;
    cpLoss: StatBucket;
    mistakes: number;
};

type Accumulator = {
    games: number;
    wins: number;
    draws: number;
    losses: number;
    expectedScore: StatBucket;
    playerRatings: number[];
    speedCounts: Record<Exclude<AccountStatsSpeed, "all">, number>;
    phase: Record<Phase, PhaseBucket>;
    advantage: {
        winningPositionMoves: number;
        convertedGames: number;
        totalGames: number;
    };
    resourcefulness: {
        worsePositionMoves: number;
        savedGames: number;
        totalGames: number;
    };
    time: {
        moves: number;
        spentTotal: number;
        lowClockMoves: number;
        severeLowClockMoves: number;
        flagLosses: number;
        flagWins: number;
    };
    evalMoves: number;
    clockMoves: number;
    processedGames: number;
    skippedGames: number;
};

type ScanOptions = {
    databasePath: string;
    account: AccountStatsAccount;
    period: AccountStatsPeriod;
    speed: AccountStatsSpeed;
    onProgress?: (progress: number, message: string) => void;
};

type ClockSpec = {
    initial: number;
    increment: number;
};

const PAGE_SIZE = 250;
const RATING_BAND_SIZE = 200;
const SIGNIFICANTLY_BETTER_WIN_CHANCE = 70;
const SIGNIFICANTLY_WORSE_WIN_CHANCE = 30;

const METRIC_LABELS: Record<AccountStatsMetricId, string> = {
    performance: "Performance",
    opening: "Opening",
    middlegame: "Middlegame",
    endgame: "Endgame",
    advantageCapitalization: "Advantage capitalization",
    resourcefulness: "Resourcefulness",
    timeManagement: "Time management",
};

const CHESSGOALS_CHESSCOM_TO_LICHESS = [
    { chesscom: 500, blitz: 1030, bullet: 975, rapid: 1205, classical: 1405 },
    { chesscom: 600, blitz: 1075, bullet: 1010, rapid: 1270, classical: 1435 },
    { chesscom: 700, blitz: 1145, bullet: 1075, rapid: 1340, classical: 1495 },
    { chesscom: 800, blitz: 1200, bullet: 1115, rapid: 1400, classical: 1555 },
    { chesscom: 900, blitz: 1335, bullet: 1200, rapid: 1515, classical: 1625 },
    { chesscom: 1000, blitz: 1420, bullet: 1295, rapid: 1615, classical: 1715 },
    { chesscom: 1100, blitz: 1475, bullet: 1385, rapid: 1690, classical: 1770 },
    { chesscom: 1150, blitz: 1525, bullet: 1435, rapid: 1730, classical: 1795 },
    { chesscom: 1200, blitz: 1565, bullet: 1475, rapid: 1765, classical: 1810 },
    { chesscom: 1250, blitz: 1605, bullet: 1530, rapid: 1795, classical: 1830 },
    { chesscom: 1300, blitz: 1635, bullet: 1575, rapid: 1825, classical: 1850 },
    { chesscom: 1350, blitz: 1670, bullet: 1630, rapid: 1850, classical: 1855 },
    { chesscom: 1400, blitz: 1705, bullet: 1675, rapid: 1880, classical: 1865 },
    { chesscom: 1450, blitz: 1745, bullet: 1720, rapid: 1915, classical: 1915 },
    { chesscom: 1500, blitz: 1780, bullet: 1770, rapid: 1930, classical: 1935 },
    { chesscom: 1550, blitz: 1815, bullet: 1805, rapid: 1965, classical: 1935 },
    { chesscom: 1600, blitz: 1850, bullet: 1845, rapid: 1990, classical: 1935 },
    { chesscom: 1650, blitz: 1895, bullet: 1895, rapid: 2020, classical: 1985 },
    { chesscom: 1700, blitz: 1910, bullet: 1920, rapid: 2035, classical: 2000 },
    { chesscom: 1750, blitz: 1950, bullet: 1960, rapid: 2055, classical: 2010 },
    { chesscom: 1800, blitz: 1970, bullet: 2000, rapid: 2085, classical: 2030 },
    { chesscom: 1850, blitz: 2005, bullet: 2040, rapid: 2115, classical: 2045 },
    { chesscom: 1900, blitz: 2050, bullet: 2110, rapid: 2135, classical: 2070 },
    { chesscom: 1950, blitz: 2075, bullet: 2145, rapid: 2155, classical: 2095 },
    { chesscom: 2000, blitz: 2100, bullet: 2195, rapid: 2185, classical: 2100 },
    { chesscom: 2100, blitz: 2170, bullet: 2255, rapid: 2240, classical: 2125 },
    { chesscom: 2200, blitz: 2235, bullet: 2330, rapid: 2285, classical: 2195 },
    { chesscom: 2300, blitz: 2295, bullet: 2400, rapid: 2330, classical: 2245 },
    { chesscom: 2400, blitz: 2370, bullet: 2490, rapid: 2380, classical: 2340 },
    { chesscom: 2500, blitz: 2445, bullet: 2560, rapid: 2445, classical: 2360 },
    { chesscom: 2600, blitz: 2560, bullet: 2700, rapid: 2510, classical: 2435 },
    { chesscom: 2700, blitz: 2625, bullet: 2765, rapid: 2595, classical: 2500 },
    { chesscom: 2800, blitz: 2695, bullet: 2870, rapid: 2630, classical: 2500 },
    { chesscom: 2900, blitz: 2780, bullet: 3005, rapid: 2705, classical: 2575 },
    { chesscom: 3000, blitz: 2850, bullet: 3090, rapid: 2735, classical: 2590 },
] as const;

const CHESSGOALS_UNCERTAINTY: Record<Exclude<AccountStatsSpeed, "all">, number> = {
    bullet: 120,
    blitz: 75,
    rapid: 100,
    classical: 85,
};

function emptyBucket(): StatBucket {
    return { count: 0, total: 0 };
}

function emptyPhaseBucket(): PhaseBucket {
    return {
        moves: 0,
        accuracy: emptyBucket(),
        cpLoss: emptyBucket(),
        mistakes: 0,
    };
}

function createAccumulator(): Accumulator {
    return {
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        expectedScore: emptyBucket(),
        playerRatings: [],
        speedCounts: {
            bullet: 0,
            blitz: 0,
            rapid: 0,
            classical: 0,
        },
        phase: {
            opening: emptyPhaseBucket(),
            middlegame: emptyPhaseBucket(),
            endgame: emptyPhaseBucket(),
        },
        advantage: {
            winningPositionMoves: 0,
            convertedGames: 0,
            totalGames: 0,
        },
        resourcefulness: {
            worsePositionMoves: 0,
            savedGames: 0,
            totalGames: 0,
        },
        time: {
            moves: 0,
            spentTotal: 0,
            lowClockMoves: 0,
            severeLowClockMoves: 0,
            flagLosses: 0,
            flagWins: 0,
        },
        evalMoves: 0,
        clockMoves: 0,
        processedGames: 0,
        skippedGames: 0,
    };
}

function addSample(bucket: StatBucket, value: number) {
    if (!Number.isFinite(value)) return;
    bucket.total += value;
    bucket.count += 1;
}

function average(bucket: StatBucket) {
    return bucket.count > 0 ? bucket.total / bucket.count : null;
}

function clamp(value: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, value));
}

function round(value: number | null, digits = 0) {
    if (value === null || !Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function formatPct(value: number | null, digits = 0) {
    if (value === null) return "n/a";
    return `${round(value, digits)}%`;
}

function getConfidence(sample: number): AccountStatsMetric["confidence"] {
    if (sample >= 80) return "high";
    if (sample >= 20) return "medium";
    return "low";
}

function periodStartDate(period: AccountStatsPeriod) {
    if (period === "all") return null;
    const now = new Date();
    const start = new Date(now);
    switch (period) {
        case "week":
            start.setDate(start.getDate() - 7);
            break;
        case "month":
            start.setMonth(start.getMonth() - 1);
            break;
        case "3months":
            start.setMonth(start.getMonth() - 3);
            break;
        case "6months":
            start.setMonth(start.getMonth() - 6);
            break;
        case "year":
            start.setFullYear(start.getFullYear() - 1);
            break;
        case "2years":
            start.setFullYear(start.getFullYear() - 2);
            break;
    }
    return formatPgnDate(start);
}

function formatPgnDate(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}.${month}.${day}`;
}

function normalizeSpeed(
    value: ReturnType<typeof getTimeControl>,
): Exclude<AccountStatsSpeed, "all"> | null {
    if (value === "ultra_bullet") return "bullet";
    if (value === "bullet" || value === "blitz" || value === "rapid" || value === "classical") {
        return value;
    }
    return null;
}

function sourceWebsite(source: OnlineGameSource) {
    return source === "chesscom" ? "Chess.com" : "Lichess";
}

function gameSpeed(game: NormalizedGame, source: OnlineGameSource) {
    if (!game.time_control) return null;
    return normalizeSpeed(getTimeControl(sourceWebsite(source), game.time_control));
}

function scoreForGame(game: NormalizedGame, playerColor: Color) {
    if (game.result === "1/2-1/2") return 0.5;
    if (playerColor === "white" && game.result === "1-0") return 1;
    if (playerColor === "black" && game.result === "0-1") return 1;
    return 0;
}

function expectedScore(playerRating: number, opponentRating: number) {
    return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function playerColorForGame(game: NormalizedGame, username: string): Color | null {
    const normalized = username.trim().toLowerCase();
    if (game.white.toLowerCase() === normalized) return "white";
    if (game.black.toLowerCase() === normalized) return "black";
    return null;
}

function getRatings(game: NormalizedGame, playerColor: Color) {
    const playerRating = playerColor === "white" ? game.white_elo : game.black_elo;
    const opponentRating = playerColor === "white" ? game.black_elo : game.white_elo;
    return { playerRating, opponentRating };
}

function parseClockSpec(timeControl: string | null | undefined): ClockSpec | null {
    if (!timeControl || timeControl === "-" || timeControl.includes("/")) return null;
    const [initialRaw, incrementRaw = "0"] = timeControl.split("+");
    const initial = Number(initialRaw);
    const increment = Number(incrementRaw);
    if (!Number.isFinite(initial) || !Number.isFinite(increment)) return null;
    return { initial, increment };
}

function phaseForPly(ply: number, middlegamePly: number | null, endgamePly: number | null): Phase {
    if (endgamePly !== null && ply >= endgamePly) return "endgame";
    if (middlegamePly !== null && ply >= middlegamePly) return "middlegame";
    return "opening";
}

function winChanceFor(score: Score, color: Color) {
    return getWinChance(normalizeScore(score.value, color));
}

function metricFromRatio(numerator: number, denominator: number) {
    return denominator > 0 ? clamp((numerator / denominator) * 100) : null;
}

function cpLossScore(avgCpLoss: number | null) {
    if (avgCpLoss === null) return null;
    return clamp(100 - avgCpLoss / 2);
}

function blend(values: (number | null)[], weights?: number[]) {
    let total = 0;
    let weight = 0;
    values.forEach((value, index) => {
        if (value === null) return;
        const w = weights?.[index] ?? 1;
        total += value * w;
        weight += w;
    });
    return weight > 0 ? total / weight : null;
}

function evaluateGame(
    game: NormalizedGame,
    playerColor: Color,
    playerScore: number,
    acc: Accumulator,
) {
    return parsePGN(game.moves, game.fen)
        .then((tree) => {
            const nodes = [...treeIteratorMainLine(tree.root)].map((item) => item.node);
            const boards = nodes
                .map((node) => positionFromFen(node.fen)[0])
                .filter((pos): pos is NonNullable<typeof pos> => !!pos);
            const phases = getGamePhases(boards);
            const clockSpec = parseClockSpec(game.time_control);
            const clocks: Record<Color, number | undefined> = {
                white: clockSpec?.initial,
                black: clockSpec?.initial,
            };

            let prevScore = tree.root.score;
            let hadAdvantage = false;
            let hadResourceChance = false;

            for (const node of nodes.slice(1)) {
                const moveColor: Color = node.halfMoves % 2 === 1 ? "white" : "black";
                const isPlayerMove = moveColor === playerColor;
                const phase = phaseForPly(node.halfMoves, phases.middlegamePly, phases.endgamePly);
                const phaseBucket = acc.phase[phase];
                if (isPlayerMove) {
                    phaseBucket.moves += 1;
                }

                if (isPlayerMove && clockSpec && typeof node.clock === "number") {
                    const before = clocks[moveColor] ?? clockSpec.initial;
                    const spent = Math.max(0, before + clockSpec.increment - node.clock);
                    acc.time.moves += 1;
                    acc.time.spentTotal += spent;
                    acc.clockMoves += 1;
                    if (node.clock <= Math.max(10, clockSpec.initial * 0.05)) {
                        acc.time.severeLowClockMoves += 1;
                    }
                    if (node.clock <= Math.max(20, clockSpec.initial * 0.1)) {
                        acc.time.lowClockMoves += 1;
                    }
                }
                if (typeof node.clock === "number") {
                    clocks[moveColor] = node.clock;
                }

                if (node.score) {
                    const currentWin = winChanceFor(node.score, playerColor);
                    if (currentWin >= SIGNIFICANTLY_BETTER_WIN_CHANCE) {
                        acc.advantage.winningPositionMoves += 1;
                        hadAdvantage = true;
                    }
                    if (currentWin <= SIGNIFICANTLY_WORSE_WIN_CHANCE) {
                        acc.resourcefulness.worsePositionMoves += 1;
                        hadResourceChance = true;
                    }
                }

                if (prevScore && node.score) {
                    if (isPlayerMove) {
                        const cpLoss = getCPLoss(prevScore.value, node.score.value, playerColor);
                        const accuracy = getAccuracy(
                            prevScore.value,
                            node.score.value,
                            playerColor,
                        );
                        addSample(phaseBucket.cpLoss, cpLoss);
                        addSample(phaseBucket.accuracy, accuracy);
                        if (cpLoss >= 100) {
                            phaseBucket.mistakes += 1;
                        }
                        acc.evalMoves += 1;
                    }
                    prevScore = node.score;
                } else if (node.score) {
                    prevScore = node.score;
                }
            }

            if (hadAdvantage) {
                acc.advantage.totalGames += 1;
                if (playerScore === 1) {
                    acc.advantage.convertedGames += 1;
                }
            }
            if (hadResourceChance) {
                acc.resourcefulness.totalGames += 1;
                if (playerScore >= 0.5) {
                    acc.resourcefulness.savedGames += 1;
                }
            }
        })
        .catch(() => {
            acc.skippedGames += 1;
        });
}

async function loadAccountGames(options: ScanOptions) {
    const startDate = periodStartDate(options.period);
    const games: NormalizedGame[] = [];
    let page = 1;
    let total: number | null = null;

    while (true) {
        const response = await query_games(options.databasePath, {
            start_date: startDate ?? undefined,
            sides: "Any",
            options: {
                page,
                pageSize: PAGE_SIZE,
                sort: "date",
                direction: "desc",
                skipCount: page > 1,
            },
        });

        if (page === 1 && typeof response.count === "number") {
            total = response.count;
        }

        games.push(...response.data);
        options.onProgress?.(
            total ? Math.min(35, (games.length / Math.max(1, total)) * 35) : 10,
            "Loading database games",
        );

        if (response.data.length < PAGE_SIZE) break;
        page += 1;
    }

    return games;
}

export async function computeAccountStats(options: ScanOptions): Promise<AccountStatsReport> {
    const acc = createAccumulator();
    const games = await loadAccountGames(options);
    const matchingGames: {
        game: NormalizedGame;
        playerColor: Color;
        playerScore: number;
    }[] = [];

    for (const game of games) {
        const playerColor = playerColorForGame(game, options.account.username);
        if (!playerColor) continue;

        const speed = gameSpeed(game, options.account.source);
        if (!speed) continue;
        if (options.speed !== "all" && speed !== options.speed) continue;

        const { playerRating, opponentRating } = getRatings(game, playerColor);
        const playerScore = scoreForGame(game, playerColor);
        acc.games += 1;
        acc.speedCounts[speed] += 1;
        if (playerScore === 1) acc.wins += 1;
        else if (playerScore === 0.5) acc.draws += 1;
        else acc.losses += 1;

        if (typeof playerRating === "number" && playerRating > 0) {
            acc.playerRatings.push(playerRating);
        }
        if (
            typeof playerRating === "number" &&
            playerRating > 0 &&
            typeof opponentRating === "number" &&
            opponentRating > 0
        ) {
            addSample(acc.expectedScore, expectedScore(playerRating, opponentRating));
        }

        const endStatus = game.result;
        if (endStatus !== "1/2-1/2") {
            const playerWon =
                (playerColor === "white" && endStatus === "1-0") ||
                (playerColor === "black" && endStatus === "0-1");
            const siteText = `${game.event} ${game.site}`.toLowerCase();
            const timeoutLike = siteText.includes("time") || siteText.includes("timeout");
            if (timeoutLike && playerWon) acc.time.flagWins += 1;
            if (timeoutLike && !playerWon) acc.time.flagLosses += 1;
        }

        matchingGames.push({ game, playerColor, playerScore });
    }

    for (const [index, item] of matchingGames.entries()) {
        acc.processedGames += 1;
        options.onProgress?.(
            35 + ((index + 1) / Math.max(1, matchingGames.length)) * 60,
            "Reading evals, phases, and clocks",
        );
        await evaluateGame(item.game, item.playerColor, item.playerScore, acc);
    }

    const benchmarkSpeed = dominantBenchmarkSpeed(acc.speedCounts, options.speed);
    const latestRating = acc.playerRatings[0] ?? null;
    const ratingMapping = mapAccountRatingToLichess(
        latestRating,
        options.account.source,
        benchmarkSpeed,
    );
    const comparisons = getAccountStatsRatingBandComparisons(
        ratingMapping.lichessRating,
        benchmarkSpeed,
    );
    const metrics = buildMetrics(acc);

    options.onProgress?.(100, "Account stats ready");

    return {
        databasePath: options.databasePath,
        account: options.account,
        period: options.period,
        speed: options.speed,
        benchmarkSpeed,
        games: acc.games,
        wins: acc.wins,
        draws: acc.draws,
        losses: acc.losses,
        scorePct: acc.games > 0 ? ((acc.wins + acc.draws * 0.5) / acc.games) * 100 : 0,
        expectedScorePct:
            acc.expectedScore.count > 0
                ? (acc.expectedScore.total / acc.expectedScore.count) * 100
                : null,
        latestRating,
        lichessRating: ratingMapping.lichessRating,
        lichessRatingUncertainty: ratingMapping.uncertainty,
        ratingSource: ratingMapping.source,
        benchmarkSource:
            "Estimated Lichess rating-band benchmark; Chess.com ratings use the ChessGoals July 2025 active-player mapping",
        evalMoves: acc.evalMoves,
        clockMoves: acc.clockMoves,
        processedGames: acc.processedGames,
        skippedGames: acc.skippedGames,
        metrics,
        comparisons,
    };
}

function dominantBenchmarkSpeed(
    speedCounts: Accumulator["speedCounts"],
    requested: AccountStatsSpeed,
): Exclude<AccountStatsSpeed, "all"> {
    if (requested !== "all") return requested;
    const ranked = Object.entries(speedCounts).sort((a, b) => b[1] - a[1]);
    return (ranked[0]?.[0] as Exclude<AccountStatsSpeed, "all"> | undefined) ?? "rapid";
}

export function mapAccountRatingToLichess(
    rating: number | null,
    source: OnlineGameSource,
    speed: Exclude<AccountStatsSpeed, "all">,
) {
    if (rating === null) {
        return {
            lichessRating: null,
            uncertainty: source === "chesscom" ? CHESSGOALS_UNCERTAINTY[speed] : 0,
            source: "No rating found in selected games",
        };
    }

    if (source === "lichess") {
        return {
            lichessRating: Math.round(rating),
            uncertainty: 0,
            source: "Lichess game ratings",
        };
    }

    return {
        lichessRating: Math.round(interpolateChessGoals(rating, speed)),
        uncertainty: CHESSGOALS_UNCERTAINTY[speed],
        source: "Chess.com mapped with ChessGoals July 2025 active-player table",
    };
}

function interpolateChessGoals(rating: number, speed: Exclude<AccountStatsSpeed, "all">) {
    const table = CHESSGOALS_CHESSCOM_TO_LICHESS;
    if (rating <= table[0].chesscom) return table[0][speed];
    const last = table[table.length - 1]!;
    if (rating >= last.chesscom) return last[speed];

    for (let i = 1; i < table.length; i++) {
        const prev = table[i - 1]!;
        const next = table[i]!;
        if (rating <= next.chesscom) {
            const span = next.chesscom - prev.chesscom;
            const t = span === 0 ? 0 : (rating - prev.chesscom) / span;
            return prev[speed] + (next[speed] - prev[speed]) * t;
        }
    }
    return last[speed];
}

function metricBenchmarkValue(
    metric: AccountStatsMetricId,
    speed: Exclude<AccountStatsSpeed, "all">,
    center: number,
) {
    const normalized = clamp((center - 800) / 1800, 0, 1);
    const speedAdjustment: Record<Exclude<AccountStatsSpeed, "all">, number> = {
        bullet: -4,
        blitz: -1,
        rapid: 2,
        classical: 4,
    };
    const adjustment = speedAdjustment[speed];

    switch (metric) {
        case "performance":
            return clamp(51 + normalized * 20 + adjustment * 0.3);
        case "opening":
            return clamp(56 + normalized * 25 + adjustment * 0.35);
        case "middlegame":
            return clamp(52 + normalized * 27 + adjustment * 0.4);
        case "endgame":
            return clamp(48 + normalized * 31 + adjustment * 0.5);
        case "advantageCapitalization":
            return clamp(50 + normalized * 29 + adjustment * 0.45);
        case "resourcefulness":
            return clamp(42 + normalized * 27 + adjustment * 0.35);
        case "timeManagement":
            return clamp(55 + normalized * 16 - (speed === "bullet" ? 6 : 0));
    }
}

export function getAccountStatsRatingBandComparisons(
    lichessRating: number | null,
    speed: Exclude<AccountStatsSpeed, "all">,
): RatingBandComparison[] {
    const fallbackRating = 1600;
    const centerBase =
        Math.floor(((lichessRating ?? fallbackRating) + RATING_BAND_SIZE / 2) / RATING_BAND_SIZE) *
        RATING_BAND_SIZE;

    return [
        { id: "below" as const, label: "Below", center: centerBase - RATING_BAND_SIZE },
        { id: "current" as const, label: "Your band", center: centerBase },
        { id: "above" as const, label: "Above", center: centerBase + RATING_BAND_SIZE },
    ].map((band) => {
        const center = Math.max(600, band.center);
        const metrics = Object.fromEntries(
            (Object.keys(METRIC_LABELS) as AccountStatsMetricId[]).map((metric) => [
                metric,
                Math.round(metricBenchmarkValue(metric, speed, center)),
            ]),
        ) as Record<AccountStatsMetricId, number>;

        return {
            ...band,
            center,
            min: Math.max(0, center - RATING_BAND_SIZE / 2),
            max: center + RATING_BAND_SIZE / 2 - 1,
            metrics,
        };
    });
}

function buildMetrics(acc: Accumulator): AccountStatsMetric[] {
    const scorePct = acc.games > 0 ? ((acc.wins + acc.draws * 0.5) / acc.games) * 100 : null;
    const expectedPct =
        acc.expectedScore.count > 0
            ? (acc.expectedScore.total / acc.expectedScore.count) * 100
            : null;
    const resultPerformance =
        scorePct === null
            ? null
            : expectedPct === null
              ? scorePct
              : clamp(50 + (scorePct - expectedPct) * 1.4);

    const opening = phaseScore(acc.phase.opening);
    const middlegame = phaseScore(acc.phase.middlegame);
    const endgame = phaseScore(acc.phase.endgame);
    const playQuality = blend([opening, middlegame, endgame], [0.25, 0.5, 0.25]);
    const performance = blend([playQuality, resultPerformance], [0.65, 0.35]);
    const converted = metricFromRatio(acc.advantage.convertedGames, acc.advantage.totalGames);
    const advantageCapitalization = converted;
    const saved = metricFromRatio(acc.resourcefulness.savedGames, acc.resourcefulness.totalGames);
    const resourcefulness = saved;
    const timeManagement = timeScore(acc);

    return [
        {
            id: "performance",
            label: METRIC_LABELS.performance,
            value: round(performance),
            sample: acc.games,
            confidence: getConfidence(acc.games),
            evidence:
                expectedPct === null
                    ? `${playQuality === null ? "No eval play-quality sample" : `${formatPct(playQuality)} play quality`}; ${acc.games} games`
                    : `${playQuality === null ? "No eval play-quality sample" : `${formatPct(playQuality)} play quality`}; ${formatPct(scorePct)} score vs ${formatPct(expectedPct)} expected`,
        },
        phaseMetric("opening", opening, acc.phase.opening),
        phaseMetric("middlegame", middlegame, acc.phase.middlegame),
        phaseMetric("endgame", endgame, acc.phase.endgame),
        {
            id: "advantageCapitalization",
            label: METRIC_LABELS.advantageCapitalization,
            value: round(advantageCapitalization),
            sample: acc.advantage.totalGames,
            confidence: getConfidence(acc.advantage.totalGames),
            evidence:
                acc.advantage.totalGames > 0
                    ? `${acc.advantage.convertedGames}/${acc.advantage.totalGames} better games converted; ${acc.advantage.winningPositionMoves} winning-position moves`
                    : `Needs evals from positions at or above ${SIGNIFICANTLY_BETTER_WIN_CHANCE}% win chance`,
        },
        {
            id: "resourcefulness",
            label: METRIC_LABELS.resourcefulness,
            value: round(resourcefulness),
            sample: acc.resourcefulness.totalGames,
            confidence: getConfidence(acc.resourcefulness.totalGames),
            evidence:
                acc.resourcefulness.totalGames > 0
                    ? `${acc.resourcefulness.savedGames}/${acc.resourcefulness.totalGames} worse games won or drawn; ${acc.resourcefulness.worsePositionMoves} worse-position moves`
                    : `Needs evals from positions at or below ${SIGNIFICANTLY_WORSE_WIN_CHANCE}% win chance`,
        },
        {
            id: "timeManagement",
            label: METRIC_LABELS.timeManagement,
            value: round(timeManagement),
            sample: acc.time.moves,
            confidence: getConfidence(acc.time.moves),
            evidence:
                acc.time.moves > 0
                    ? `${Math.round(acc.time.spentTotal / acc.time.moves)}s avg move; ${acc.time.lowClockMoves} low-clock moves`
                    : "Needs clock comments",
        },
    ];
}

function phaseScore(bucket: PhaseBucket) {
    const accuracy = average(bucket.accuracy);
    const lossScore = cpLossScore(average(bucket.cpLoss));
    const mistakeScore =
        bucket.moves > 0 ? clamp(100 - (bucket.mistakes / Math.max(1, bucket.moves)) * 400) : null;
    return blend([accuracy, lossScore, mistakeScore], [0.55, 0.3, 0.15]);
}

function phaseMetric(id: Phase, value: number | null, bucket: PhaseBucket): AccountStatsMetric {
    const avgCp = average(bucket.cpLoss);
    const avgAccuracy = average(bucket.accuracy);
    return {
        id,
        label: METRIC_LABELS[id],
        value: round(value),
        sample: bucket.accuracy.count,
        confidence: getConfidence(bucket.accuracy.count),
        evidence:
            bucket.accuracy.count > 0
                ? `${formatPct(avgAccuracy)} accuracy; ${Math.round(avgCp ?? 0)} avg cp loss; ${bucket.mistakes} major slips`
                : "Needs eval comments in this phase",
    };
}

function timeScore(acc: Accumulator) {
    if (acc.time.moves === 0) return null;
    const lowClockRate = acc.time.lowClockMoves / acc.time.moves;
    const severeRate = acc.time.severeLowClockMoves / acc.time.moves;
    const flagPenalty = acc.games > 0 ? (acc.time.flagLosses / acc.games) * 20 : 0;
    return clamp(92 - lowClockRate * 70 - severeRate * 45 - flagPenalty);
}

export function accountStatsPeriodLabel(period: AccountStatsPeriod) {
    switch (period) {
        case "week":
            return "Last week";
        case "month":
            return "Last month";
        case "3months":
            return "Last 3 months";
        case "6months":
            return "Last 6 months";
        case "year":
            return "Last year";
        case "2years":
            return "Last 2 years";
        case "all":
            return "All time";
    }
}

export function accountStatsSpeedLabel(speed: AccountStatsSpeed | Speed | string) {
    switch (speed) {
        case "bullet":
        case "Bullet":
            return "Bullet";
        case "blitz":
        case "Blitz":
            return "Blitz";
        case "rapid":
        case "Rapid":
            return "Rapid";
        case "classical":
        case "Classical":
            return "Classical";
        case "all":
            return "All";
        default:
            return "Other";
    }
}
