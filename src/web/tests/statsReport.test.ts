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
