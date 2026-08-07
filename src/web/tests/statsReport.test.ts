import { describe, expect, test } from "vitest";
import { extractPgnEvals, extractPgnMoves, gameAnalysisKey } from "@/web/statsAnalysis";
import { computePeriodReport, getWeekWindow } from "@/web/statsReport";
import type { StatsGame } from "@/web/statsRating";
import type { AnalyzedGameEntry } from "@/web/statsStrength";

const LICHESS_PGN = `
[Event "Rated Blitz game"]
[Site "https://lichess.org/abcd1234"]
[Result "1-0"]
[TimeControl "180+2"]

1. e4 { [%eval 0.17] [%clk 0:03:00] } 1... c5?! { [%eval 0.3] [%clk 0:03:00] } 2. Nf3 { [%eval 0.25] [%clk 0:02:58] } (2. c3 { a quieter sideline }) 2... d6 $6 { [%eval 0.8] [%clk 0:02:57] } 3. Bc4 { [%eval #-3] [%clk 0:02:55] } Nf6 { [%clk 0:02:56] } 1-0
`;

const CHESSCOM_PGN = `
[Event "Live Chess"]
[Site "Chess.com"]
[Result "0-1"]
[TimeControl "600"]

1. d4 {[%clk 0:09:58.1]} 1... d5 {[%clk 0:09:57.3]} 2. c4 {[%clk 0:09:50]} 0-1
`;

describe("PGN move and eval extraction", () => {
    test("reads lichess-style movetext with clocks, evals, mate scores, NAGs, and variations", () => {
        const { sans, clocks } = extractPgnMoves(LICHESS_PGN);
        expect(sans).toEqual(["e4", "c5", "Nf3", "d6", "Bc4", "Nf6"]);
        expect(clocks).toEqual([180, 180, 178, 177, 175, 176]);

        const evals = extractPgnEvals(LICHESS_PGN);
        expect(evals).toEqual([
            { cp: 15 },
            { cp: 17 },
            { cp: 30 },
            { cp: 25 },
            { cp: 80 },
            { mate: -3 },
            null,
        ]);
        expect(evals).toHaveLength(sans.length + 1);
    });

    test("reads chess.com-style movetext with fractional clocks and no evals", () => {
        const { sans, clocks } = extractPgnMoves(CHESSCOM_PGN);
        expect(sans).toEqual(["d4", "d5", "c4"]);
        expect(clocks).toEqual([598.1, 597.3, 590]);
        expect(extractPgnEvals(CHESSCOM_PGN)).toBeNull();
    });
});

// July 2026 local calendar: Jul 6, Jul 13, and Jul 20 are Mondays.
function sec(month: number, day: number, hour = 0, minute = 0): number {
    return Math.floor(new Date(2026, month - 1, day, hour, minute).getTime() / 1000);
}

let fixtureCounter = 0;

function makeGame(overrides: Partial<StatsGame> & { end: number }): StatsGame {
    fixtureCounter += 1;
    return {
        source: "chesscom",
        id: `game-${fixtureCounter}`,
        url: null,
        start: overrides.end - 300,
        rating: 1500,
        result: "win",
        termination: "resign",
        opp: 1500,
        oppName: `opp-${fixtureCounter}`,
        rated: true,
        color: "w",
        timeClass: "blitz",
        timeControl: { base: 180, inc: 0 },
        eco: null,
        openingName: null,
        pgn: null,
        ...overrides,
    };
}

const CLOCKED_PGN_A = `
[Event "Clocked A"]
[Result "1-0"]
[TimeControl "180+2"]

1. e4 {[%clk 0:02:52]} e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:44]} Nc6 {[%clk 0:02:55]} 1-0
`;

const CLOCKED_PGN_B = `
[Event "Clocked B"]
[Result "1-0"]
[TimeControl "180+2"]

1. d4 {[%clk 0:02:56]} d5 {[%clk 0:02:57]} 2. c4 {[%clk 0:02:52]} e6 {[%clk 0:02:53]} 1-0
`;

const LONG_CLOCK_PGN = `[Event "Clock comparison"]
[Result "1-0"]
[TimeControl "180"]

${Array.from({ length: 20 }, (_, index) => {
    const move = index + 1;
    const whiteSan = move % 2 === 1 ? "Nf3" : "Ng1";
    const blackSan = move % 2 === 1 ? "Nf6" : "Ng8";
    const whiteClock = 180 - move * 3;
    const blackClock = 180 - move * 5;
    const clock = (seconds: number) =>
        `0:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    return `${move}. ${whiteSan} {[%clk ${clock(whiteClock)}]} ${blackSan} {[%clk ${clock(blackClock)}]}`;
}).join(" ")} 1-0`;

function buildFixtureGames(): StatsGame[] {
    const najdorf = "Sicilian Defense: Najdorf Variation";
    const dragon = "Sicilian Defense: Dragon Variation";
    const qgdExchange = "Queen's Gambit Declined: Exchange Variation";
    return [
        // Week 1: Mon Jul 6 - Sun Jul 12 (6W 1D 3L, one timeout loss).
        makeGame({
            end: sec(7, 6, 10, 0),
            result: "win",
            oppName: "RivalDude",
            opp: 1520,
            rating: 1510,
            openingName: najdorf,
        }),
        makeGame({
            end: sec(7, 6, 10, 10),
            result: "win",
            oppName: "A1",
            opp: 1500,
            rating: 1518,
            openingName: najdorf,
        }),
        makeGame({
            end: sec(7, 7, 11, 0),
            result: "loss",
            termination: "timeout",
            oppName: "A2",
            opp: 1530,
            rating: 1508,
            color: "b",
            openingName: qgdExchange,
        }),
        makeGame({
            end: sec(7, 7, 11, 10),
            result: "win",
            oppName: "A3",
            opp: 1490,
            rating: 1516,
            openingName: dragon,
        }),
        makeGame({
            end: sec(7, 8, 12, 0),
            result: "draw",
            termination: "draw",
            oppName: "A4",
            opp: 1515,
            rating: 1516,
            color: "b",
            openingName: "Queen's Gambit Declined: Orthodox Defense",
        }),
        makeGame({
            end: sec(7, 8, 12, 10),
            result: "loss",
            oppName: "RivalDude",
            opp: 1525,
            rating: 1506,
            openingName: najdorf,
        }),
        makeGame({
            end: sec(7, 9, 13, 0),
            result: "win",
            oppName: "A5",
            opp: 1500,
            rating: 1514,
            eco: "B01",
        }),
        makeGame({
            end: sec(7, 10, 14, 0),
            result: "win",
            oppName: "A6",
            opp: 1505,
            rating: 1522,
            eco: "B01",
        }),
        makeGame({
            end: sec(7, 11, 15, 0),
            result: "loss",
            oppName: "A7",
            opp: 1540,
            rating: 1512,
            color: "b",
            openingName: qgdExchange,
        }),
        makeGame({
            end: sec(7, 12, 16, 0),
            result: "win",
            oppName: "RivalDude",
            opp: 1518,
            rating: 1520,
            openingName: dragon,
        }),
        // Week 2: Mon Jul 13 - Sun Jul 19 (4W 2D 4L, two timeout losses).
        makeGame({
            end: sec(7, 13, 10, 0),
            result: "loss",
            termination: "timeout",
            oppName: "B1",
            opp: 1550,
            rating: 1510,
        }),
        makeGame({
            end: sec(7, 13, 10, 10),
            result: "win",
            oppName: "RivalDude",
            opp: 1522,
            rating: 1518,
            openingName: najdorf,
        }),
        makeGame({
            end: sec(7, 14, 11, 0),
            result: "draw",
            termination: "draw",
            oppName: "B2",
            opp: 1520,
            rating: 1518,
            color: "b",
            openingName: qgdExchange,
        }),
        makeGame({
            end: sec(7, 15, 12, 0),
            result: "loss",
            termination: "timeout",
            oppName: "B3",
            opp: 1560,
            rating: 1508,
            color: "b",
            openingName: qgdExchange,
        }),
        makeGame({
            end: sec(7, 15, 12, 10),
            result: "win",
            oppName: "B4",
            opp: 1500,
            rating: 1516,
            eco: "C50",
        }),
        makeGame({
            end: sec(7, 16, 13, 0),
            result: "win",
            oppName: "B5",
            opp: 1510,
            rating: 1524,
            openingName: "Italian Game: Classical Variation",
        }),
        makeGame({
            end: sec(7, 17, 14, 0),
            result: "loss",
            oppName: "B6",
            opp: 1530,
            rating: 1514,
            openingName: "Italian Game: Two Knights Defense",
        }),
        makeGame({ end: sec(7, 18, 15, 0), result: "win", oppName: "B7", opp: 1505, rating: 1522 }),
        makeGame({
            end: sec(7, 19, 16, 0),
            result: "draw",
            termination: "draw",
            oppName: "B8",
            opp: 1515,
            rating: 1522,
            color: "b",
            openingName: "French Defense: Tarrasch Variation",
        }),
        makeGame({
            end: sec(7, 19, 16, 10),
            result: "loss",
            oppName: "B9",
            opp: 1535,
            rating: 1512,
            color: "b",
            openingName: "French Defense: Advance Variation",
        }),
        // Week 3: Mon Jul 20 - Sun Jul 26 (8W 2L, four-game win streak).
        makeGame({
            end: sec(7, 20, 10, 0),
            result: "win",
            oppName: "C1",
            opp: 1500,
            rating: 1520,
            color: "b",
            openingName: "King's Indian Defense: Classical Variation",
        }),
        makeGame({
            end: sec(7, 21, 10, 0),
            result: "win",
            oppName: "C2",
            opp: 1510,
            rating: 1528,
            color: "b",
            openingName: "King's Indian Defense: Fianchetto Variation",
        }),
        makeGame({
            end: sec(7, 21, 10, 10),
            result: "loss",
            oppName: "C3",
            opp: 1540,
            rating: 1518,
            color: "b",
            openingName: "King's Indian Defense: Saemisch Variation",
        }),
        makeGame({
            id: "best-win",
            end: sec(7, 22, 11, 0),
            result: "win",
            oppName: "StrongOpp",
            opp: 1710,
            rating: 1530,
            openingName: "Sicilian Defense: Classical Variation",
        }),
        makeGame({
            end: sec(7, 23, 12, 0),
            result: "win",
            oppName: "C4",
            opp: 1512,
            rating: 1538,
            openingName: "Caro-Kann Defense: Advance Variation",
        }),
        makeGame({
            end: sec(7, 24, 13, 0),
            result: "win",
            oppName: "C5",
            opp: 1505,
            rating: 1546,
            eco: "A45",
        }),
        makeGame({
            end: sec(7, 24, 13, 10),
            result: "win",
            oppName: "C6",
            opp: 1515,
            rating: 1554,
            openingName: "London System",
        }),
        makeGame({
            end: sec(7, 25, 14, 0),
            result: "loss",
            termination: "abandon",
            oppName: "C7",
            opp: 1550,
            rating: 1544,
            openingName: "Scandinavian Defense: Modern Variation",
        }),
        makeGame({
            end: sec(7, 26, 9, 0),
            result: "win",
            oppName: "C8",
            opp: 1500,
            rating: 1552,
            openingName: "Vienna Game",
            timeControl: { base: 180, inc: 2 },
            pgn: CLOCKED_PGN_A,
        }),
        makeGame({
            end: sec(7, 26, 9, 30),
            result: "win",
            oppName: "C9",
            opp: 1495,
            rating: 1560,
            openingName: "Vienna Game: Stanley Variation",
            timeControl: { base: 180, inc: 2 },
            pgn: CLOCKED_PGN_B,
        }),
    ];
}

const FIXTURE_GAMES = buildFixtureGames();
const BEST_WIN_GAME = FIXTURE_GAMES.find((game) => game.id === "best-win") as StatsGame;
const NOW_SEC = sec(7, 26, 12, 0);
const WINDOW_START = sec(7, 6);
const WINDOW_END = sec(7, 27) - 1;

const ANALYZED_ENTRY: AnalyzedGameEntry = {
    v: 2,
    ts: 1_750_000_000_000,
    key: gameAnalysisKey(BEST_WIN_GAME),
    end: BEST_WIN_GAME.end,
    source: "chesscom",
    url: null,
    timeControl: { base: 180, inc: 0 },
    color: "w",
    opponent: "StrongOpp",
    opp: 1710,
    result: "win",
    plies: 62,
    eco: "B56",
    openingName: "Sicilian Defense: Classical Variation",
    stats: {
        accuracy: 85,
        acpl: 40,
        scoredCount: 24,
        complexity: 5,
        bookMoves: 6,
        blunderRate: 0.08,
        fastRate: 0.2,
        scramble: 0,
        analysisDepth: 12,
    },
    phases: {
        middlegame: { accuracy: 82, acpl: 55, scoredCount: 14, complexity: 5.5 },
    },
    counts: { inaccuracy: 3, mistake: 1, blunder: 2 },
    phaseBlunders: { opening: 0, middlegame: 1, endgame: 1 },
};

const DECOY_ENTRY: AnalyzedGameEntry = {
    ...ANALYZED_ENTRY,
    key: "chesscom|not-in-window",
    end: sec(5, 1),
    counts: { inaccuracy: 9, mistake: 9, blunder: 9 },
};

function makeAnalyzedEntry(
    game: StatsGame,
    overrides?: {
        accuracy?: number | null;
        acpl?: number | null;
        counts?: AnalyzedGameEntry["counts"];
    },
): AnalyzedGameEntry {
    return {
        ...ANALYZED_ENTRY,
        key: gameAnalysisKey(game),
        end: game.end,
        source: game.source,
        url: game.url,
        timeControl: game.timeControl,
        color: game.color,
        opponent: game.oppName,
        opp: game.opp,
        result: game.result,
        eco: game.eco,
        openingName: game.openingName,
        stats: {
            ...ANALYZED_ENTRY.stats,
            accuracy:
                overrides?.accuracy === undefined
                    ? ANALYZED_ENTRY.stats.accuracy
                    : overrides.accuracy,
            acpl: overrides?.acpl === undefined ? ANALYZED_ENTRY.stats.acpl : overrides.acpl,
        },
        counts: overrides?.counts ?? ANALYZED_ENTRY.counts,
    };
}

function withOpponentQuality(
    entry: AnalyzedGameEntry,
    overrides?: {
        accuracy?: number | null;
        acpl?: number | null;
        counts?: AnalyzedGameEntry["counts"];
    },
): AnalyzedGameEntry {
    const counts = overrides?.counts ?? entry.counts;
    const emptyDecision = { moves: 0, errors: 0, accuracy: null };
    return {
        ...entry,
        opponentQuality: {
            stats: {
                ...entry.stats,
                accuracy:
                    overrides?.accuracy === undefined ? entry.stats.accuracy : overrides.accuracy,
                acpl: overrides?.acpl === undefined ? entry.stats.acpl : overrides.acpl,
            },
            phases: entry.phases,
            counts,
            phaseBlunders: entry.phaseBlunders,
            advanced: {
                advantage: emptyDecision,
                defence: emptyDecision,
                balanced: emptyDecision,
                critical: emptyDecision,
                fast: emptyDecision,
                longThink: emptyDecision,
                timeTrouble: emptyDecision,
                hadWinningPosition: false,
                convertedWinningPosition: null,
                hadLosingPosition: false,
                savedLosingPosition: null,
                openingExitWinPct: null,
                move15EvalCp: null,
                endgameEntryEvalCp: null,
            },
        },
    };
}

function buildThreeWeekReport() {
    return computePeriodReport({
        games: FIXTURE_GAMES,
        analyzed: [ANALYZED_ENTRY, DECOY_ENTRY],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        label: "Last 3 weeks",
        nowSec: NOW_SEC,
        currentRating: 1560,
    });
}

describe("computePeriodReport", () => {
    test("computes the window record, rating span, performance, and form", () => {
        const report = buildThreeWeekReport();

        expect(report.window).toEqual({
            start: WINDOW_START,
            end: WINDOW_END,
            label: "Last 3 weeks",
        });
        expect(report.record.games).toBe(30);
        expect(report.record.wins).toBe(18);
        expect(report.record.draws).toBe(3);
        expect(report.record.losses).toBe(9);
        expect(report.record.scorePct).toBeCloseTo(65, 9);

        expect(report.rating).toEqual({ start: 1510, end: 1560, delta: 50 });

        expect(report.perf).not.toBeNull();
        expect(report.perf?.gamesWithOpp).toBe(30);
        expect(typeof report.perf?.perf).toBe("number");

        expect(report.form).not.toBeNull();
        expect(report.form?.streak).toEqual({ type: "win", len: 2 });
    });

    test("summarizes opponent-rating coverage and computes Elo expectation per selected game", () => {
        const winBelow = makeGame({
            end: sec(7, 25, 10),
            rating: 1000,
            opp: 900,
            result: "win",
        });
        const lossAbove = makeGame({
            end: sec(7, 25, 11),
            rating: 1000,
            opp: 1100,
            result: "loss",
        });
        const equalDraw = makeGame({
            end: sec(7, 25, 12),
            rating: 1100,
            opp: 1100,
            result: "draw",
        });
        const missingOpponent = makeGame({
            end: sec(7, 25, 13),
            rating: 1100,
            opp: null,
        });
        const invalidPlayerRating = makeGame({
            end: sec(7, 25, 14),
            rating: Number.NaN,
            opp: 1200,
        });
        const casual = makeGame({
            end: sec(7, 25, 15),
            rating: 1100,
            opp: 1300,
            rated: false,
            result: "win",
        });

        const report = computePeriodReport({
            games: [casual, missingOpponent, equalDraw, lossAbove, invalidPlayerRating, winBelow],
            analyzed: [],
            windowStart: sec(7, 25),
            windowEnd: sec(7, 26) - 1,
            label: "One day",
            nowSec: sec(7, 25, 16),
            currentRating: 1100,
        });

        const expectedBelow = 1 / (1 + 10 ** ((900 - 1000) / 400));
        const expectedAbove = 1 / (1 + 10 ** ((1100 - 1000) / 400));
        const expectedCasual = 1 / (1 + 10 ** ((1300 - 1100) / 400));
        const expectedPct = ((expectedBelow + expectedAbove + 0.5 + expectedCasual) / 4) * 100;

        expect(report.opponents).toMatchObject({
            totalGames: 6,
            ratedGames: 5,
            gamesWithOpponentRating: 4,
            minOpponentRating: 900,
            maxOpponentRating: 1300,
        });
        expect(report.opponents.opponentRatingCoveragePct).toBeCloseTo(200 / 3, 9);
        expect(report.opponents.avgOpponentRating).toBeCloseTo(1100, 9);
        expect(report.opponents.medianOpponentRating).toBe(1100);
        // Positive means the opposition was stronger; the casual game counts too.
        expect(report.opponents.avgRatingGap).toBeCloseTo(50, 9);
        expect(report.opponents.scorePct).toBeCloseTo(62.5, 9);
        expect(report.opponents.expectedScorePct).toBeCloseTo(expectedPct, 9);
        expect(report.opponents.scoreDeltaPct).toBeCloseTo(62.5 - expectedPct, 9);
    });

    test("uses fixed ascending 200-point bands with explicit analysis samples", () => {
        const below = makeGame({
            end: sec(7, 25, 10),
            rating: 999,
            opp: 999,
            result: "win",
        });
        const bandStart = makeGame({
            end: sec(7, 25, 11),
            rating: 1000,
            opp: 1000,
            result: "loss",
        });
        const bandEnd = makeGame({
            end: sec(7, 25, 12),
            rating: 1199,
            opp: 1199,
            result: "draw",
        });
        const above = makeGame({
            end: sec(7, 25, 13),
            rating: 1200,
            opp: 1200,
            result: "win",
        });
        const analyzedBelow = withOpponentQuality(
            makeAnalyzedEntry(below, {
                accuracy: 90,
                acpl: 10,
                counts: { inaccuracy: 1, mistake: 0, blunder: 0 },
            }),
        );
        const analyzedStart = withOpponentQuality(
            makeAnalyzedEntry(bandStart, {
                accuracy: 70,
                acpl: 90,
                counts: { inaccuracy: 3, mistake: 2, blunder: 1 },
            }),
        );
        const analyzedEnd = withOpponentQuality(
            makeAnalyzedEntry(bandEnd, {
                accuracy: null,
                acpl: null,
                counts: { inaccuracy: 1, mistake: 1, blunder: 1 },
            }),
        );

        const report = computePeriodReport({
            games: [above, bandEnd, below, bandStart],
            analyzed: [analyzedEnd, analyzedBelow, analyzedStart, DECOY_ENTRY],
            windowStart: sec(7, 25),
            windowEnd: sec(7, 26) - 1,
            label: "One day",
            nowSec: sec(7, 25, 16),
            currentRating: 1000,
        });

        expect(report.opponents.bands.map((band) => band.label)).toEqual([
            "800-999",
            "1000-1199",
            "1200-1399",
        ]);
        expect(report.opponents.bands.map((band) => band.containsCurrentRating)).toEqual([
            false,
            true,
            false,
        ]);

        expect(report.opponents.bands[0]).toMatchObject({
            min: 800,
            max: 999,
            games: 1,
            wins: 1,
            draws: 0,
            losses: 0,
            scorePct: 100,
            expectedScorePct: 50,
            scoreDeltaPct: 50,
            avgOpponentRating: 999,
            analyzedGames: 1,
            analysisCoveragePct: 100,
            accuracySamples: 1,
            acplSamples: 1,
            avgAccuracy: 90,
            avgAcpl: 10,
            inaccuraciesPerAnalyzedGame: 1,
            mistakesPerAnalyzedGame: 0,
            blundersPerAnalyzedGame: 0,
        });

        expect(report.opponents.bands[1]).toMatchObject({
            games: 2,
            wins: 0,
            draws: 1,
            losses: 1,
            scorePct: 25,
            expectedScorePct: 50,
            scoreDeltaPct: -25,
            avgOpponentRating: 1099.5,
            analyzedGames: 2,
            analysisCoveragePct: 100,
            accuracySamples: 1,
            acplSamples: 1,
            avgAccuracy: 70,
            avgAcpl: 90,
            inaccuraciesPerAnalyzedGame: 2,
            mistakesPerAnalyzedGame: 1.5,
            blundersPerAnalyzedGame: 1,
        });

        expect(report.opponents.bands[2]).toMatchObject({
            games: 1,
            analyzedGames: 0,
            analysisCoveragePct: 0,
            accuracySamples: 0,
            acplSamples: 0,
            avgAccuracy: null,
            avgAcpl: null,
            inaccuraciesPerAnalyzedGame: null,
            mistakesPerAnalyzedGame: null,
            blundersPerAnalyzedGame: null,
        });
    });

    test("keeps empty opponent samples explicit instead of fabricating ratings or bands", () => {
        const unrated = makeGame({
            end: sec(7, 25, 10),
            rated: false,
            opp: null,
        });
        const missing = makeGame({
            end: sec(7, 25, 11),
            rated: true,
            opp: null,
        });
        const report = computePeriodReport({
            games: [unrated, missing],
            analyzed: [makeAnalyzedEntry(unrated)],
            windowStart: sec(7, 25),
            windowEnd: sec(7, 26) - 1,
            label: "One day",
            nowSec: sec(7, 25, 16),
            currentRating: 1500,
        });

        expect(report.opponents).toEqual({
            totalGames: 2,
            ratedGames: 1,
            gamesWithOpponentRating: 0,
            opponentRatingCoveragePct: 0,
            avgOpponentRating: null,
            medianOpponentRating: null,
            minOpponentRating: null,
            maxOpponentRating: null,
            avgRatingGap: null,
            scorePct: null,
            expectedScorePct: null,
            scoreDeltaPct: null,
            bands: [],
        });
    });

    test("keeps player and opponent engine comparisons on the same paired games", () => {
        const legacyGame = makeGame({
            id: "legacy-quality",
            end: sec(7, 25, 10),
            rating: 1500,
            opp: 1450,
        });
        const pairedGame = makeGame({
            id: "paired-quality",
            end: sec(7, 25, 11),
            rating: 1500,
            opp: 1475,
        });
        const legacy = makeAnalyzedEntry(legacyGame, {
            accuracy: 40,
            acpl: 120,
            counts: { inaccuracy: 2, mistake: 4, blunder: 5 },
        });
        const paired = withOpponentQuality(
            makeAnalyzedEntry(pairedGame, {
                accuracy: 90,
                acpl: 20,
                counts: { inaccuracy: 1, mistake: 1, blunder: 0 },
            }),
            {
                accuracy: 80,
                acpl: 45,
                counts: { inaccuracy: 2, mistake: 2, blunder: 1 },
            },
        );

        const report = computePeriodReport({
            games: [legacyGame, pairedGame],
            analyzed: [legacy, paired],
            windowStart: sec(7, 25),
            windowEnd: sec(7, 26) - 1,
            label: "One day",
            nowSec: sec(7, 25, 16),
            currentRating: 1500,
        });

        expect(report.mistakes?.analyzedGames).toBe(2);
        expect(report.mistakes?.player.avgAccuracy).toBe(65);
        expect(report.mistakes?.pairedGames).toBe(1);
        expect(report.mistakes?.pairedPlayer?.avgAccuracy).toBe(90);
        expect(report.mistakes?.pairedPlayer?.mistakesPerGame).toBe(1);
        expect(report.mistakes?.opponents?.avgAccuracy).toBe(80);
        expect(report.mistakes?.opponents?.mistakesPerGame).toBe(2);
        expect(report.mistakes?.peerBenchmark?.samples).toBe(1);
        expect(report.mistakes?.peerBenchmark?.accuracyDelta).toBeCloseTo(
            90 - (report.mistakes?.peerBenchmark?.expectedAccuracy ?? 0),
            9,
        );
        expect(report.opponents.bands[0]).toMatchObject({
            analyzedGames: 1,
            avgAccuracy: 90,
            mistakesPerAnalyzedGame: 1,
            opponentAnalyzedGames: 1,
            opponentAvgAccuracy: 80,
            opponentMistakesPerAnalyzedGame: 2,
        });
    });

    test("does not use one-sided provider counts as a rating-band comparison", () => {
        const game = makeGame({
            source: "lichess",
            end: sec(7, 25, 12),
            rating: 1500,
            opp: 1550,
            providerQuality: {
                provider: "lichess",
                accuracy: 88,
                acpl: 30,
                inaccuracies: 1,
                mistakes: 1,
                blunders: 0,
            },
        });
        const report = computePeriodReport({
            games: [game],
            analyzed: [],
            windowStart: sec(7, 25),
            windowEnd: sec(7, 26) - 1,
            label: "One day",
            nowSec: sec(7, 25, 16),
            currentRating: 1500,
        });

        expect(report.opponents.bands[0]).toMatchObject({
            providerQualityMethod: null,
            providerAnalyzedGames: 0,
            opponentProviderAnalyzedGames: 0,
            providerMistakesPerGame: null,
            opponentProviderMistakesPerGame: null,
        });
    });

    test("buckets games into Monday-based local weeks", () => {
        const report = buildThreeWeekReport();

        expect(report.weekly).toHaveLength(3);
        expect(report.weekly.map((week) => week.start)).toEqual([
            sec(7, 6),
            sec(7, 13),
            sec(7, 20),
        ]);
        expect(report.weekly.map((week) => week.end)).toEqual([
            sec(7, 13) - 1,
            sec(7, 20) - 1,
            sec(7, 27) - 1,
        ]);
        expect(report.weekly.map((week) => week.label)).toEqual([
            "Jul 6 – Jul 12",
            "Jul 13 – Jul 19",
            "Jul 20 – Jul 26",
        ]);
        expect(report.weekly.map((week) => week.games)).toEqual([10, 10, 10]);
        expect(report.weekly[0].scorePct).toBeCloseTo(65, 9);
        expect(report.weekly[1].scorePct).toBeCloseTo(50, 9);
        expect(report.weekly[2].scorePct).toBeCloseTo(80, 9);
        expect(report.weekly.map((week) => week.ratingEnd)).toEqual([1520, 1512, 1560]);
        for (const week of report.weekly) {
            expect(typeof week.perf).toBe("number");
        }
    });

    test("skips weekly buckets for windows of ten days or less", () => {
        const week = getWeekWindow(0, NOW_SEC);
        const report = computePeriodReport({
            games: FIXTURE_GAMES,
            analyzed: [],
            windowStart: week.start,
            windowEnd: week.end,
            label: week.label,
            nowSec: NOW_SEC,
            currentRating: 1560,
        });

        expect(report.weekly).toEqual([]);
        expect(report.record.games).toBe(10);
        expect(report.mistakes).toBeNull();
    });

    test("aggregates openings into families with best and worst callouts", () => {
        const report = buildThreeWeekReport();

        const sicilian = report.openings.white.find((agg) => agg.name === "Sicilian Defense");
        expect(sicilian).toBeDefined();
        expect(sicilian).toMatchObject({ color: "w", games: 7, wins: 6, draws: 0, losses: 1 });
        expect(sicilian?.scorePct).toBeCloseTo(600 / 7, 9);
        expect(report.openings.white[0]?.name).toBe("Sicilian Defense");

        const qgd = report.openings.black.find((agg) => agg.name === "Queen's Gambit Declined");
        expect(qgd).toBeDefined();
        expect(qgd).toMatchObject({ color: "b", games: 5, wins: 0, draws: 2, losses: 3 });
        expect(qgd?.scorePct).toBeCloseTo(20, 9);

        const kid = report.openings.black.find((agg) => agg.name === "King's Indian Defense");
        expect(kid).toMatchObject({ games: 3, wins: 2, losses: 1 });

        const ecoFallback = report.openings.white.find((agg) => agg.name === "B01");
        expect(ecoFallback).toMatchObject({ games: 2, wins: 2 });
        const unknown = report.openings.white.find((agg) => agg.name === "Unknown opening");
        expect(unknown).toMatchObject({ games: 2, wins: 1, losses: 1 });

        expect(report.openings.best?.name).toBe("Sicilian Defense");
        expect(report.openings.worst?.name).toBe("Queen's Gambit Declined");
    });

    test("summarizes time management from PGN clocks and timeout losses", () => {
        const report = buildThreeWeekReport();

        expect(report.time).not.toBeNull();
        expect(report.time?.gamesWithClocks).toBe(2);
        expect(report.time?.avgMoveSeconds).toBeCloseTo(8, 9);
        expect(report.time?.medianMoveSeconds).toBeCloseTo(8, 9);
        expect(report.time?.byPhaseSeconds.opening).toBeCloseTo(8, 9);
        expect(report.time?.byPhaseSeconds.middlegame).toBeUndefined();
        expect(report.time?.byPhaseSeconds.endgame).toBeUndefined();
        // Both clocked games have fewer than eight considered moves, so the
        // fast/scramble rates stay unavailable.
        expect(report.time?.fastMovePct).toBeNull();
        expect(report.time?.scramblePct).toBeNull();
        expect(report.time?.avgRemainingPctAtEnd).toBeCloseTo(
            ((164 / 180 + 172 / 180) / 2) * 100,
            6,
        );
        expect(report.time?.timeoutLosses).toBe(3);
        expect(report.time?.timeoutLossPct).toBeCloseTo(100 / 3, 9);
    });

    test("compares move-20 clock balance and builds a remaining-time curve", () => {
        const game = makeGame({
            end: sec(7, 25, 18),
            result: "win",
            color: "w",
            timeControl: { base: 180, inc: 0 },
            pgn: LONG_CLOCK_PGN,
        });
        const report = computePeriodReport({
            games: [game],
            analyzed: [],
            windowStart: sec(7, 25),
            windowEnd: sec(7, 26) - 1,
            label: "One day",
            nowSec: sec(7, 25, 20),
            currentRating: 1500,
        });

        expect(report.time?.clockBalanceAtMove20.ahead).toEqual({ games: 1, scorePct: 100 });
        expect(report.time?.clockBalanceAtMove20.even).toEqual({ games: 0, scorePct: null });
        expect(report.time?.clockBalanceAtMove20.behind).toEqual({ games: 0, scorePct: null });
        expect(report.time?.clockCurve.map((checkpoint) => checkpoint.move)).toEqual([10, 20]);
        expect(report.time?.clockCurve[0]).toMatchObject({ games: 1 });
        expect(report.time?.clockCurve[0].playerRemainingPct).toBeCloseTo((150 / 180) * 100, 9);
        expect(report.time?.clockCurve[0].opponentRemainingPct).toBeCloseTo((130 / 180) * 100, 9);
    });

    test("aggregates mistakes from analyzed entries matched by analysis key", () => {
        const report = buildThreeWeekReport();

        expect(report.mistakes).not.toBeNull();
        expect(report.mistakes?.analyzedGames).toBe(1);
        expect(report.mistakes?.avgAccuracy).toBeCloseTo(85, 9);
        expect(report.mistakes?.avgAcpl).toBeCloseTo(40, 9);
        expect(report.mistakes?.blundersPerGame).toBe(2);
        expect(report.mistakes?.mistakesPerGame).toBe(1);
        expect(report.mistakes?.inaccuraciesPerGame).toBe(3);
        expect(report.mistakes?.byPhase.opening).toEqual({ blunders: 0, share: 0 });
        expect(report.mistakes?.byPhase.middlegame).toEqual({ blunders: 1, share: 0.5 });
        expect(report.mistakes?.byPhase.endgame).toEqual({ blunders: 1, share: 0.5 });
        expect(report.mistakes?.worstGames).toHaveLength(1);
        expect(report.mistakes?.worstGames[0]?.entry.key).toBe(gameAnalysisKey(BEST_WIN_GAME));
        expect(report.mistakes?.worstGames[0]?.game?.id).toBe("best-win");
    });

    test("combines player/opponent quality, rating baseline, provider accuracy, and position outcomes", () => {
        const game = makeGame({
            source: "lichess",
            end: sec(7, 25, 18),
            rating: 1500,
            opp: 1575,
            result: "win",
            color: "w",
            providerQuality: {
                provider: "lichess",
                accuracy: 87,
                acpl: 35,
                inaccuracies: 2,
                mistakes: 1,
                blunders: 0,
            },
            opponentProviderQuality: {
                provider: "lichess",
                accuracy: 81,
                acpl: 55,
                inaccuracies: 3,
                mistakes: 2,
                blunders: 1,
            },
        });
        const emptyDecision = { moves: 0, errors: 0, accuracy: null };
        const advanced = {
            advantage: { moves: 8, errors: 1, accuracy: 84 },
            defence: { moves: 2, errors: 0, accuracy: 92 },
            balanced: { moves: 14, errors: 1, accuracy: 82 },
            critical: { moves: 5, errors: 1, accuracy: 76 },
            fast: { moves: 6, errors: 1, accuracy: 78 },
            longThink: { moves: 4, errors: 0, accuracy: 94 },
            timeTrouble: emptyDecision,
            hadWinningPosition: true,
            convertedWinningPosition: true,
            hadLosingPosition: false,
            savedLosingPosition: null,
            openingExitWinPct: 58,
            move15EvalCp: 45,
            endgameEntryEvalCp: 130,
        };
        const entry: AnalyzedGameEntry = {
            ...makeAnalyzedEntry(game, {
                accuracy: 86,
                acpl: 38,
                counts: { inaccuracy: 1, mistake: 1, blunder: 1 },
            }),
            advanced,
            opponentQuality: {
                stats: {
                    ...ANALYZED_ENTRY.stats,
                    accuracy: 79,
                    acpl: 62,
                    scoredCount: 25,
                },
                phases: {
                    middlegame: {
                        accuracy: 77,
                        acpl: 70,
                        scoredCount: 15,
                        complexity: 5,
                    },
                },
                counts: { inaccuracy: 3, mistake: 2, blunder: 2 },
                phaseBlunders: { opening: 0, middlegame: 2, endgame: 0 },
                advanced: {
                    ...advanced,
                    hadWinningPosition: false,
                    convertedWinningPosition: null,
                },
            },
        };

        const report = computePeriodReport({
            games: [game],
            analyzed: [entry],
            windowStart: sec(7, 25),
            windowEnd: sec(7, 26) - 1,
            label: "One day",
            nowSec: sec(7, 25, 20),
            currentRating: 1500,
        });

        expect(report.mistakes?.analysisCoveragePct).toBe(100);
        expect(report.mistakes?.player.errorsPer100Moves).toBeCloseTo((2 / 24) * 100, 9);
        expect(report.mistakes?.opponents?.mistakesPerGame).toBe(2);
        expect(report.mistakes?.opponents?.blundersPerGame).toBe(2);
        expect(report.mistakes?.peerBenchmark?.ratingBandLabel).toBe("1400-1599");
        expect(report.mistakes?.peerBenchmark?.samples).toBe(1);
        expect(report.mistakes?.situations?.conversionPct).toBe(100);
        expect(report.mistakes?.situations?.critical.errorPct).toBe(20);
        expect(report.mistakes?.situations?.endgames.better).toEqual({
            games: 1,
            scorePct: 100,
        });
        expect(report.providerQuality).toMatchObject({
            provider: "lichess",
            playerSamples: 1,
            opponentSamples: 1,
            pairedSamples: 1,
            avgPlayerAccuracy: 87,
            avgOpponentAccuracy: 81,
            accuracyDelta: 6,
            avgPlayerAcpl: 35,
            avgOpponentAcpl: 55,
            playerErrorSamples: 1,
            playerMistakesPerGame: 1,
            playerBlundersPerGame: 0,
            opponentErrorSamples: 1,
            opponentMistakesPerGame: 2,
            opponentBlundersPerGame: 1,
        });
        expect(report.opponents.bands[0]).toMatchObject({
            opponentAnalyzedGames: 1,
            opponentMistakesPerAnalyzedGame: 2,
            opponentBlundersPerAnalyzedGame: 2,
            providerQualityMethod: "lichess",
            providerAnalyzedGames: 1,
            providerMistakesPerGame: 1,
            providerBlundersPerGame: 0,
            opponentProviderAnalyzedGames: 1,
            opponentProviderMistakesPerGame: 2,
            opponentProviderBlundersPerGame: 1,
        });
        expect(report.patterns.byColor[0]).toMatchObject({ label: "White", scorePct: 100 });
    });

    test("collects highlights: best win, longest win streak, most played opponent", () => {
        const report = buildThreeWeekReport();

        expect(report.highlights.bestWin?.oppName).toBe("StrongOpp");
        expect(report.highlights.bestWin?.opp).toBe(1710);
        expect(report.highlights.longestWinStreak).toBe(4);
        expect(report.highlights.mostPlayedOpponent?.name).toBe("RivalDude");
        expect(report.highlights.mostPlayedOpponent?.games).toBe(4);
        expect(report.highlights.mostPlayedOpponent?.scorePct).toBeCloseTo(75, 9);
    });
});

describe("getWeekWindow", () => {
    test("returns Monday-based local weeks with short labels", () => {
        const current = getWeekWindow(0, NOW_SEC);
        expect(current.start).toBe(sec(7, 20));
        expect(current.end).toBe(sec(7, 27) - 1);
        expect(current.label).toBe("Jul 20 – Jul 26");

        const previous = getWeekWindow(-1, NOW_SEC);
        expect(previous.start).toBe(sec(7, 13));
        expect(previous.end).toBe(sec(7, 20) - 1);
        expect(previous.label).toBe("Jul 13 – Jul 19");
    });
});
