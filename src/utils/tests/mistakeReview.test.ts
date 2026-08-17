import { INITIAL_FEN } from "chessops/fen";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import { getStats, scheduleSm2Card, type Position } from "@/components/files/opening";
import {
    classifyMistakeReviewNature,
    classifyMistakeReviewAttempt,
    DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
    formatMistakeReviewMoveTime,
    formatMistakeReviewMoveTimeWords,
    formatMistakeReviewTimeManagementFeedback,
    formatMistakeReviewLastSeen,
    getMistakeReviewDailyBatch,
    getMistakeReviewDailyProgress,
    getMistakeReviewNature,
    getMistakeReviewNatureBatch,
    getMistakeReviewNatureCounts,
    getMistakeReviewPhase,
    getMistakeReviewPhaseBatch,
    getMistakeReviewPhaseCounts,
    getMistakeReviewTimeManagementBatch,
    getMistakeReviewTimeManagementSummary,
    isMistakeReviewPassingLabel,
    migrateMistakeReviewDeckNatureClassifications,
    mergeMistakeReviewPositions,
    type MistakeReviewDeck,
} from "@/utils/mistakeReview";
import {
    getMistakeReviewAutoUpdatePlayerNameCandidates,
    selectMistakeReviewPlayerTargets,
} from "@/utils/mistakeReviewAutoUpdate";
import { applyMistakeReviewClockTimings } from "@/utils/mistakeReviewClockHydration";
import { hasOnlineDatabaseNewLocalGames } from "@/utils/onlineGameImport";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const OPENING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 5";
const MIDDLEGAME_FEN = "r1bq1rk1/ppp2ppp/2n2n2/3pp3/3PP3/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 20";
const ENDGAME_FEN = "8/8/8/8/8/8/4K3/4k3 w - - 0 40";
const HANGING_KNIGHT_FEN = "4k3/8/7p/8/8/5N2/8/4K3 w - - 0 1";
const FORK_BLUNDER_FEN = "4k3/8/8/8/1n6/8/8/R3K2R w KQ - 0 1";

function position(overrides: Partial<Position> = {}): Position {
    return {
        fen: INITIAL_FEN,
        answer: "Nf3",
        answerUci: "g1f3",
        card: createEmptyCard(),
        reviewKey: `${INITIAL_FEN}|g2g4`,
        mistakeReview: {
            severity: "mistake",
            cpLoss: 120,
            winProbabilityDrop: 8,
            date: "2026.04.20",
            playedMoveSan: "g4",
            playedMoveUci: "g2g4",
            bestMoveSan: "Nf3",
            bestMoveUci: "g1f3",
            occurrenceCount: 1,
            gameIds: [1],
        },
        ...overrides,
    };
}

function deck(positions: Position[]): MistakeReviewDeck {
    return {
        version: 1,
        name: "Mistakes",
        createdAt: 1,
        updatedAt: 1,
        settings: {
            playerDb: "games.db3",
            playerId: 1,
            enginePath: "stockfish",
            analysisMode: "single",
            fastDepth: 12,
            deepDepth: 17,
            multiPv: 3,
            timeControls: [],
            dateRange: "all",
            thresholds: { inaccuracy: 50, mistake: 100, blunder: 200 },
            includeSeverities: { inaccuracy: true, mistake: true, blunder: true },
            minWinProbabilityDrop: 5,
            timeManagement: DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
        },
        daily: {
            reviewsPerDay: 40,
            newItemsPerDay: 10,
            gamePeriod: "all",
            minWinProbabilityDrop: 0,
            includeInaccuracies: true,
            includeMistakes: true,
            includeBlunders: true,
        },
        positions,
        logs: [],
    };
}

describe("mistake review helpers", () => {
    test("uses binary pass/fail labels", () => {
        expect(classifyMistakeReviewAttempt(0, undefined, true)).toBe("best");
        expect(classifyMistakeReviewAttempt(30)).toBe("good");
        expect(classifyMistakeReviewAttempt(45)).toBe("okay");
        expect(classifyMistakeReviewAttempt(140)).toBe("mistake");
        expect(classifyMistakeReviewAttempt(240)).toBe("blunder");
        expect(isMistakeReviewPassingLabel("best")).toBe(true);
        expect(isMistakeReviewPassingLabel("good")).toBe(true);
        expect(isMistakeReviewPassingLabel("okay")).toBe(false);
    });

    test("formats move think time compactly", () => {
        expect(formatMistakeReviewMoveTime(9.6)).toBe("9.6s");
        expect(formatMistakeReviewMoveTime(42.2)).toBe("42s");
        expect(formatMistakeReviewMoveTime(125)).toBe("2:05");
        expect(formatMistakeReviewMoveTime(null)).toBeNull();
    });

    test("formats time-management feedback for trainer cards", () => {
        expect(formatMistakeReviewMoveTimeWords(20)).toBe("20 seconds");
        expect(formatMistakeReviewMoveTimeWords(60)).toBe("1 minute");
        expect(formatMistakeReviewMoveTimeWords(125)).toBe("2 minutes 5 seconds");
        expect(
            formatMistakeReviewTimeManagementFeedback({
                ...position().mistakeReview!,
                moveTimeSeconds: 20,
                playedMoveSan: "Be3",
                severity: "mistake",
            }),
        ).toBe(
            "In the game, you spent 20 seconds on this move and played Be3, which was a mistake.",
        );
        expect(
            formatMistakeReviewTimeManagementFeedback({
                ...position().mistakeReview!,
                moveTimeSeconds: 42,
                playedMoveSan: "Qh5",
                severity: "inaccuracy",
            }),
        ).toContain("which was an inaccuracy");
        expect(formatMistakeReviewTimeManagementFeedback(position().mistakeReview)).toBeNull();
    });

    test("daily review takes due cards first, then capped new cards", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const dueBlunder = position({
            fen: OPENING_FEN,
            reviewKey: "due-blunder",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: { ...position().mistakeReview!, severity: "blunder", gameIds: [1] },
        });
        const dueMistake = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "due-mistake",
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-23T12:00:00Z"),
            } as Position["card"],
            mistakeReview: { ...position().mistakeReview!, severity: "mistake", gameIds: [2] },
        });
        const freshOne = position({ fen: ENDGAME_FEN, reviewKey: "new-one" });
        const freshTwo = position({
            fen: "8/8/8/8/8/8/3K4/3k4 w - - 0 41",
            reviewKey: "new-two",
        });

        const batch = getMistakeReviewDailyBatch(
            [freshOne, dueMistake, freshTwo, dueBlunder],
            {
                reviewsPerDay: 3,
                newItemsPerDay: 1,
                gamePeriod: "all",
                minWinProbabilityDrop: 0,
                includeInaccuracies: true,
                includeMistakes: true,
                includeBlunders: true,
            },
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual([
            "due-blunder",
            "due-mistake",
            "new-one",
        ]);
    });

    test("daily review prefers recent due mistakes without skipping older SRS cards", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const oldDue = position({
            fen: OPENING_FEN,
            reviewKey: "old-due",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-20T12:00:00Z"),
            } as Position["card"],
            mistakeReview: { ...position().mistakeReview!, date: "2025.01.15" },
        });
        const recentDue = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "recent-due",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: { ...position().mistakeReview!, date: "2026.04.25" },
        });

        const batch = getMistakeReviewDailyBatch(
            [oldDue, recentDue],
            {
                reviewsPerDay: 2,
                newItemsPerDay: 0,
                gamePeriod: "all",
                minWinProbabilityDrop: 0,
                includeInaccuracies: true,
                includeMistakes: true,
                includeBlunders: true,
            },
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual(["recent-due", "old-due"]);
    });

    test("daily review keeps one card per board position", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const dueBlunder = position({
            fen: OPENING_FEN,
            reviewKey: "due-blunder",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                severity: "blunder",
                cpLoss: 250,
                gameIds: [1],
            },
        });
        const dueSameBoard = position({
            fen: OPENING_FEN,
            reviewKey: "due-same-board",
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-23T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                severity: "mistake",
                playedMoveSan: "d4",
                playedMoveUci: "d2d4",
                gameIds: [2],
            },
        });
        const freshSameBoard = position({
            fen: OPENING_FEN,
            reviewKey: "new-same-board",
            mistakeReview: {
                ...position().mistakeReview!,
                severity: "blunder",
                playedMoveSan: "c4",
                playedMoveUci: "c2c4",
                gameIds: [3],
            },
        });
        const freshOtherBoard = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "new-other-board",
        });

        const batch = getMistakeReviewDailyBatch(
            [freshSameBoard, dueSameBoard, freshOtherBoard, dueBlunder],
            {
                reviewsPerDay: 4,
                newItemsPerDay: 2,
                gamePeriod: "all",
                minWinProbabilityDrop: 0,
                includeInaccuracies: true,
                includeMistakes: true,
                includeBlunders: true,
            },
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual(["due-blunder", "new-other-board"]);
    });

    test("daily review subtracts positions already attempted today", () => {
        const now = new Date("2026-04-26T12:00:00");
        const attemptedAt = new Date("2026-04-26T09:00:00").getTime();
        const dueDone = position({
            fen: ENDGAME_FEN,
            reviewKey: "due-done",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 3,
            },
        });
        const dueOne = position({
            reviewKey: "due-one",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
        });
        const dueTwo = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "due-two",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-25T12:00:00Z"),
            } as Position["card"],
        });

        const settings = {
            reviewsPerDay: 2,
            newItemsPerDay: 1,
            gamePeriod: "all" as const,
            minWinProbabilityDrop: 0,
            includeInaccuracies: true,
            includeMistakes: true,
            includeBlunders: true,
        };
        const batch = getMistakeReviewDailyBatch([dueOne, dueDone, dueTwo], settings, { now });
        const progress = getMistakeReviewDailyProgress([dueOne, dueDone, dueTwo], settings, {
            now,
        });

        expect(progress.completed).toBe(1);
        expect(progress.remaining).toBe(1);
        expect(batch.map((item) => item.reviewKey)).toEqual(["due-one"]);
    });

    test("daily review treats duplicate boards attempted today as covered", () => {
        const now = new Date("2026-04-26T12:00:00");
        const attemptedAt = new Date("2026-04-26T09:00:00").getTime();
        const done = position({
            fen: OPENING_FEN,
            reviewKey: "done-board",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 3,
            },
        });
        const duplicateSameBoard = position({
            fen: OPENING_FEN,
            reviewKey: "duplicate-same-board",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                playedMoveSan: "d4",
                playedMoveUci: "d2d4",
            },
        });
        const otherBoard = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "other-board",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
        });

        const settings = {
            reviewsPerDay: 3,
            newItemsPerDay: 1,
            gamePeriod: "all" as const,
            minWinProbabilityDrop: 0,
            includeInaccuracies: true,
            includeMistakes: true,
            includeBlunders: true,
        };
        const positions = [duplicateSameBoard, otherBoard, done];
        const batch = getMistakeReviewDailyBatch(positions, settings, { now });
        const progress = getMistakeReviewDailyProgress(positions, settings, { now });

        expect(progress.completed).toBe(1);
        expect(batch.map((item) => item.reviewKey)).toEqual(["other-board"]);
    });

    test("daily review remembers new cards already introduced today", () => {
        const now = new Date("2026-04-26T12:00:00");
        const attemptedAt = new Date("2026-04-26T09:00:00").getTime();
        const completedNew = position({
            reviewKey: "new-done",
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-30T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 0,
            },
        });
        const freshOne = position({ reviewKey: "new-one" });
        const freshTwo = position({ reviewKey: "new-two" });

        const settings = {
            reviewsPerDay: 3,
            newItemsPerDay: 1,
            gamePeriod: "all" as const,
            minWinProbabilityDrop: 0,
            includeInaccuracies: true,
            includeMistakes: true,
            includeBlunders: true,
        };

        const batch = getMistakeReviewDailyBatch([completedNew, freshOne, freshTwo], settings, {
            now,
        });
        const progress = getMistakeReviewDailyProgress(
            [completedNew, freshOne, freshTwo],
            settings,
            {
                now,
            },
        );

        expect(progress.completed).toBe(1);
        expect(progress.completedNew).toBe(1);
        expect(progress.newRemaining).toBe(0);
        expect(batch).toEqual([]);
    });

    test("daily progress counts long-think cards reviewed from trainer mode", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const attemptedAt = new Date("2026-04-26T09:00:00Z").getTime();
        const reviewedLongThink = position({
            fen: ENDGAME_FEN,
            reviewKey: "reviewed-long-think",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                severity: "blunder",
                moveTimeSeconds: 90,
                date: "2026.04.24",
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 3,
            },
        });
        const dailyOne = position({
            fen: OPENING_FEN,
            reviewKey: "daily-one",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                severity: "mistake",
                date: "2026.04.24",
            },
        });
        const dailyTwo = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "daily-two",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                severity: "mistake",
                date: "2026.04.23",
            },
        });
        const settings = {
            reviewsPerDay: 2,
            newItemsPerDay: 1,
            gamePeriod: "all" as const,
            minWinProbabilityDrop: 0,
            includeInaccuracies: true,
            includeMistakes: true,
            includeBlunders: false,
        };
        const positions = [reviewedLongThink, dailyOne, dailyTwo];
        const batch = getMistakeReviewDailyBatch(positions, settings, { now });
        const progress = getMistakeReviewDailyProgress(positions, settings, { now });

        expect(progress.completed).toBe(1);
        expect(progress.remaining).toBe(1);
        expect(batch.map((item) => item.reviewKey)).toEqual(["daily-one"]);
    });

    test("phase training groups opening, middlegame, and endgame cards", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const openingDue = position({
            fen: OPENING_FEN,
            reviewKey: "opening-due",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
        });
        const openingFresh = position({
            fen: OPENING_FEN,
            reviewKey: "opening-fresh",
            mistakeReview: {
                ...position().mistakeReview!,
                severity: "blunder",
                date: "2026.04.25",
            },
        });
        const openingScheduled = position({
            fen: OPENING_FEN,
            reviewKey: "opening-scheduled",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-30T12:00:00Z"),
            } as Position["card"],
        });
        const middlegame = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "middlegame",
        });
        const endgame = position({
            fen: ENDGAME_FEN,
            reviewKey: "endgame",
        });

        const positions = [middlegame, openingScheduled, openingFresh, endgame, openingDue];
        const counts = getMistakeReviewPhaseCounts(positions, { now });
        const batch = getMistakeReviewPhaseBatch(positions, "opening", { now });
        const fullBatch = getMistakeReviewPhaseBatch(positions, "opening", {
            now,
            includeScheduled: true,
        });

        expect(getMistakeReviewPhase(openingDue)).toBe("opening");
        expect(getMistakeReviewPhase(middlegame)).toBe("middlegame");
        expect(getMistakeReviewPhase(endgame)).toBe("endgame");
        expect(counts.opening).toEqual({ total: 3, due: 1 });
        expect(counts.middlegame).toEqual({ total: 1, due: 0 });
        expect(counts.endgame).toEqual({ total: 1, due: 0 });
        expect(batch.map((item) => item.reviewKey)).toEqual(["opening-due", "opening-fresh"]);
        expect(fullBatch.map((item) => item.reviewKey)).toEqual([
            "opening-due",
            "opening-fresh",
            "opening-scheduled",
        ]);
    });

    test("phase metadata overrides FEN classification aliases", () => {
        expect(
            getMistakeReviewPhase(
                position({
                    fen: OPENING_FEN,
                    mistakeReview: {
                        ...position().mistakeReview!,
                        gamePhase: "midgame",
                    },
                }),
            ),
        ).toBe("middlegame");
    });

    test("classifies tactical and positional mistake nature from engine line shape", () => {
        const tactical = classifyMistakeReviewNature({
            bestMoveSan: "Nxe5+",
            bestMoveUci: "f3e5",
            playedMoveSan: "h3",
            pvSan: ["Nxe5+", "dxe5", "Qh5"],
            pvUci: ["f3e5", "d6e5", "d1h5"],
            cpLoss: 220,
            winProbabilityDrop: 18,
        });
        const positional = classifyMistakeReviewNature({
            bestMoveSan: "Re1",
            playedMoveSan: "a3",
            pvSan: ["Re1", "Qc7", "Bb3", "Rad8"],
            cpLoss: 95,
            winProbabilityDrop: 5,
        });

        expect(tactical.nature).toBe("tactical");
        expect(tactical.aspect).toBe("missed");
        expect(tactical.confidence).toBe("high");
        expect(tactical.reason).toContain("Nxe5+");
        expect(positional.nature).toBe("positional");
        expect(positional.confidence).toBe("medium");
    });

    test("recognizes quiet moves that are tactically motivated", () => {
        const quietFork = classifyMistakeReviewNature({
            fen: "k7/3q1r2/8/8/8/5N2/8/K7 w - - 0 1",
            bestMoveSan: "Ne5",
            bestMoveUci: "f3e5",
            playedMoveSan: "Ka2",
            pvSan: ["Ne5", "Qe6", "Nxf7"],
            pvUci: ["f3e5", "d7e6", "e5f7"],
            cpLoss: 140,
            winProbabilityDrop: 8,
        });

        expect(quietFork.nature).toBe("tactical");
        expect(quietFork.confidence).toBe("high");
        expect(quietFork.reason).toContain("tactically motivated");
        expect(quietFork.reason).toContain("forking");
    });

    test("recognizes quiet tactical ideas whose payoff is later in the line", () => {
        const quietMateThreat = classifyMistakeReviewNature({
            bestMoveSan: "Qh5",
            playedMoveSan: "a3",
            pvSan: ["Qh5", "h6", "Qg6", "Kf8", "Qf7#"],
            cpLoss: 150,
            winProbabilityDrop: 8,
        });

        expect(quietMateThreat.nature).toBe("tactical");
        expect(quietMateThreat.confidence).toBe("high");
        expect(quietMateThreat.reason).toContain("tactically motivated");
        expect(quietMateThreat.reason).toContain("mate");
    });

    test("recognizes a quiet move that creates an immediate mate threat on the board", () => {
        const quietMateThreat = classifyMistakeReviewNature({
            fen: "5bkb/5ppp/8/8/8/8/2B5/3Q2K1 w - - 0 1",
            bestMoveSan: "Qh5",
            bestMoveUci: "d1h5",
            playedMoveSan: "Kh2",
            pvSan: ["Qh5"],
            pvUci: ["d1h5"],
            cpLoss: 150,
            winProbabilityDrop: 8,
        });

        expect(quietMateThreat.nature).toBe("tactical");
        expect(quietMateThreat.confidence).toBe("high");
        expect(quietMateThreat.reason).toContain("tactically motivated");
        expect(quietMateThreat.reason).toContain("immediate mate threat");
    });

    test("does not treat a routine exchange sequence as tactical by notation alone", () => {
        const routineExchange = classifyMistakeReviewNature({
            bestMoveSan: "cxd5",
            playedMoveSan: "h3",
            pvSan: ["cxd5", "exd5", "Nf3", "Nf6"],
            cpLoss: 95,
            winProbabilityDrop: 5,
        });

        expect(routineExchange.nature).toBe("positional");
        expect(routineExchange.confidence).toBe("medium");
        expect(routineExchange.reason).toContain("no verified material or mating outcome");
    });

    test("does not treat an isolated check as proof of a tactic", () => {
        const incidentalCheck = classifyMistakeReviewNature({
            bestMoveSan: "Qa5+",
            playedMoveSan: "h3",
            pvSan: ["Qa5+", "Nc6", "Nf3", "Nf6"],
            cpLoss: 80,
            winProbabilityDrop: 4,
        });

        expect(incidentalCheck.nature).toBe("positional");
        expect(incidentalCheck.confidence).toBe("low");
        expect(incidentalCheck.reason).toContain("positional label is provisional");
        expect(incidentalCheck.tacticalSignals).toEqual([
            expect.stringContaining("does not verify a concrete follow-up"),
        ]);
    });

    test("does not infer tactics from the size of a quiet evaluation loss", () => {
        const severePositionalError = classifyMistakeReviewNature({
            bestMoveSan: "Re1",
            playedMoveSan: "a3",
            pvSan: ["Re1", "Qc7", "Bb3", "Rad8", "h3", "Rfe8"],
            cpLoss: 240,
            winProbabilityDrop: 16,
        });

        expect(severePositionalError.nature).toBe("positional");
        expect(severePositionalError.confidence).toBe("low");
        expect(severePositionalError.reason).toContain("positional label is provisional");
    });

    test("assigns strong positional confidence only to verified quiet lines", () => {
        const verifiedPositional = classifyMistakeReviewNature({
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            bestMoveSan: "Nf3",
            bestMoveUci: "g1f3",
            playedMoveSan: "h3",
            playedMoveUci: "h2h3",
            pvSan: ["Nf3", "Nf6", "g3", "g6"],
            pvUci: ["g1f3", "g8f6", "g2g3", "g7g6"],
            refutationSan: ["Nf6", "Nf3", "g6", "g3"],
            refutationUci: ["g8f6", "g1f3", "g7g6", "g2g3"],
            cpLoss: 60,
            winProbabilityDrop: 4,
            reachedDepth: 18,
        });

        expect(verifiedPositional.nature).toBe("positional");
        expect(verifiedPositional.confidence).toBe("high");
        expect(verifiedPositional.reason).toContain("verified tactical window");
    });

    test("does not award high positional confidence when a supplied UCI line breaks", () => {
        const incompleteVerification = classifyMistakeReviewNature({
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            bestMoveSan: "Nf3",
            bestMoveUci: "g1f3",
            playedMoveSan: "h3",
            playedMoveUci: "h2h3",
            pvSan: ["Nf3", "Nf6", "g3", "g6", "Ra8"],
            pvUci: ["g1f3", "g8f6", "g2g3", "g7g6", "a1a8"],
            refutationSan: ["Nf6", "Nf3", "g6", "g3", "Ra1"],
            refutationUci: ["g8f6", "g1f3", "g7g6", "g2g3", "a8a1"],
            cpLoss: 60,
            winProbabilityDrop: 4,
            reachedDepth: 18,
        });

        expect(incompleteVerification.nature).toBe("positional");
        expect(incompleteVerification.confidence).toBe("medium");
        expect(incompleteVerification.reason).toContain("supplied engine line");
    });

    test("keeps incomplete evidence provisional instead of claiming positional certainty", () => {
        const incomplete = classifyMistakeReviewNature({});

        expect(incomplete.nature).toBe("positional");
        expect(incomplete.confidence).toBe("low");
        expect(incomplete.reason).toContain("Insufficient engine-line evidence");
    });

    test("classifies immediate material hangs as tactical even with quiet engine text", () => {
        const hangingPiece = classifyMistakeReviewNature({
            fen: HANGING_KNIGHT_FEN,
            playedMoveSan: "Ng5",
            playedMoveUci: "f3g5",
            bestMoveSan: "Kd2",
            bestMoveUci: "e1d2",
            pvSan: ["Kd2", "Kd7", "Ke3"],
            pvUci: ["e1d2", "e8d7", "d2e3"],
            cpLoss: 120,
            winProbabilityDrop: 6,
        });

        expect(hangingPiece.nature).toBe("tactical");
        expect(hangingPiece.aspect).toBe("allowed");
        expect(hangingPiece.confidence).toBe("high");
        expect(hangingPiece.reason).toContain("capturable by a pawn");
    });

    test("classifies short fork threats after the blunder as tactical", () => {
        const fork = classifyMistakeReviewNature({
            fen: FORK_BLUNDER_FEN,
            playedMoveSan: "Rh3",
            playedMoveUci: "h1h3",
            bestMoveSan: "Kd1",
            bestMoveUci: "e1d1",
            pvSan: ["Kd1", "Nc2", "Kc1"],
            pvUci: ["e1d1", "b4c2", "d1c1"],
            cpLoss: 130,
            winProbabilityDrop: 7,
        });

        expect(fork.nature).toBe("tactical");
        expect(fork.confidence).toBe("high");
        expect(fork.reason).toContain("fork");
    });

    test("distinguishes allowed and missed tactical resources", () => {
        const allowed = classifyMistakeReviewNature({
            fen: FORK_BLUNDER_FEN,
            playedMoveSan: "Rh3",
            playedMoveUci: "h1h3",
            bestMoveSan: "Kd1",
            bestMoveUci: "e1d1",
            pvSan: ["Kd1", "Nxa2"],
            pvUci: ["e1d1", "b4a2"],
            refutationSan: ["Nc2+"],
            refutationUci: ["b4c2"],
            cpLoss: 130,
            winProbabilityDrop: 7,
        });
        const missed = classifyMistakeReviewNature({
            fen: "4k3/8/8/8/1n6/8/8/R3K2R b KQ - 0 1",
            bestMoveSan: "Nc2+",
            bestMoveUci: "b4c2",
            pvSan: ["Nc2+"],
            pvUci: ["b4c2"],
            playedMoveSan: "Kd7",
            playedMoveUci: "e8d7",
            cpLoss: 130,
            winProbabilityDrop: 7,
        });

        expect(allowed.nature).toBe("tactical");
        expect(allowed.aspect).toBe("allowed");
        expect(allowed.allowedNature).toBe("tactical");
        expect(allowed.missedNature).toBe("positional");
        expect(allowed.reason).toContain("tactically motivated");
        expect(missed.nature).toBe("tactical");
        expect(missed.aspect).toBe("missed");
        expect(missed.missedNature).toBe("tactical");
    });

    test("nature training batches tactical and positional cards", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const tacticalDue = position({
            reviewKey: "tactical-due",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                nature: "tactical",
                severity: "blunder",
            },
        });
        const tacticalFresh = position({
            reviewKey: "tactical-fresh",
            mistakeReview: {
                ...position().mistakeReview!,
                bestMoveSan: "Bxh7+",
                pvSan: ["Bxh7+", "Kxh7", "Ng5+"],
            },
        });
        const tacticalScheduled = position({
            reviewKey: "tactical-scheduled",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-30T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                nature: "tactical",
            },
        });
        const positional = position({
            reviewKey: "positional",
            mistakeReview: {
                ...position().mistakeReview!,
                nature: "positional",
            },
        });

        const positions = [positional, tacticalScheduled, tacticalFresh, tacticalDue];
        const counts = getMistakeReviewNatureCounts(positions, { now });
        const tacticalBatch = getMistakeReviewNatureBatch(positions, "tactical", { now });
        const tacticalFullBatch = getMistakeReviewNatureBatch(positions, "tactical", {
            now,
            includeScheduled: true,
        });

        expect(getMistakeReviewNature(tacticalFresh)).toBe("tactical");
        expect(getMistakeReviewNature(positional)).toBe("positional");
        expect(counts.tactical).toEqual({ total: 3, due: 1 });
        expect(counts.positional).toEqual({ total: 1, due: 0 });
        expect(tacticalBatch.map((item) => item.reviewKey)).toEqual([
            "tactical-due",
            "tactical-fresh",
        ]);
        expect(tacticalFullBatch.map((item) => item.reviewKey)).toEqual([
            "tactical-due",
            "tactical-fresh",
            "tactical-scheduled",
        ]);
    });

    test("nature migration classifies old cards once and stores metadata", async () => {
        const oldTactical = position({
            reviewKey: "old-tactical",
            answer: "Bxh7+",
            mistakeReview: {
                ...position().mistakeReview!,
                bestMoveSan: "Bxh7+",
                pvSan: ["Bxh7+", "Kxh7", "Ng5+"],
            },
        });
        const sourceDeck = deck([oldTactical]);

        const firstMigration = await migrateMistakeReviewDeckNatureClassifications(sourceDeck, {
            chunkSize: 1,
        });
        const migrated = firstMigration.deck.positions[0].mistakeReview!;

        expect(firstMigration.updatedCount).toBe(1);
        expect(migrated.nature).toBe("tactical");
        expect(migrated.natureClassifierVersion).toBeDefined();

        const secondMigration = await migrateMistakeReviewDeckNatureClassifications(
            firstMigration.deck,
            { chunkSize: 1 },
        );
        expect(secondMigration.updatedCount).toBe(0);
    });

    test("time management batch keeps ready long-think mistakes first", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const shortThink = position({
            reviewKey: "short-think",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 12,
                severity: "blunder",
            },
        });
        const longThink = position({
            fen: OPENING_FEN,
            reviewKey: "long-think",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 45,
                severity: "mistake",
            },
        });
        const scheduledLongThink = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "scheduled-long-think",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-30T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 80,
                severity: "blunder",
            },
        });
        const reviewedTodayAgain = position({
            fen: ENDGAME_FEN,
            reviewKey: "reviewed-today-again",
            card: {
                ...createEmptyCard(),
                reps: 0,
                last_review: new Date("2026-04-26T09:00:00Z"),
                due: new Date("2026-04-27T09:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 95,
                severity: "blunder",
                lastAttemptedAt: new Date("2026-04-26T09:00:00Z").getTime(),
                lastAttemptedCardReps: 2,
            },
        });
        const longestThink = position({
            fen: HANGING_KNIGHT_FEN,
            reviewKey: "longest-think",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 90,
                severity: "inaccuracy",
            },
        });
        const dailyThink = position({
            reviewKey: "daily-think",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 259200,
                severity: "blunder",
                timeControl: "1/259200",
            },
        });
        const savedCorrespondenceBucket = position({
            reviewKey: "correspondence-bucket",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 180,
                severity: "mistake",
                timeControls: ["correspondence"],
            },
        });

        expect(
            getMistakeReviewTimeManagementBatch(
                [
                    shortThink,
                    dailyThink,
                    longThink,
                    savedCorrespondenceBucket,
                    longestThink,
                    scheduledLongThink,
                    reviewedTodayAgain,
                ],
                {
                    minMoveSeconds: 20,
                    now,
                },
            ).map((item) => item.reviewKey),
        ).toEqual(["longest-think", "long-think"]);

        expect(
            getMistakeReviewTimeManagementBatch(
                [
                    shortThink,
                    dailyThink,
                    longThink,
                    savedCorrespondenceBucket,
                    longestThink,
                    scheduledLongThink,
                    reviewedTodayAgain,
                ],
                {
                    minMoveSeconds: 60,
                    now,
                },
            ).map((item) => item.reviewKey),
        ).toEqual(["longest-think"]);

        expect(
            getMistakeReviewTimeManagementBatch(
                [scheduledLongThink, reviewedTodayAgain, longThink],
                {
                    minMoveSeconds: 20,
                    now,
                    includeScheduled: true,
                },
            ).map((item) => item.reviewKey),
        ).toEqual(["reviewed-today-again", "scheduled-long-think", "long-think"]);
    });

    test("time management batch spaces duplicate board positions together", () => {
        const now = new Date("2026-04-27T12:00:00Z");
        const scheduledBoard = position({
            fen: OPENING_FEN,
            reviewKey: "scheduled-board",
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-30T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 120,
                lastAttemptedAt: new Date("2026-04-26T09:00:00Z").getTime(),
                lastAttemptedCardReps: 0,
            },
        });
        const freshSameScheduledBoard = position({
            fen: OPENING_FEN,
            reviewKey: "fresh-same-scheduled-board",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 150,
                playedMoveSan: "d4",
                playedMoveUci: "d2d4",
            },
        });
        const dueBoard = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "due-board",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-26T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 70,
            },
        });
        const freshSameDueBoard = position({
            fen: MIDDLEGAME_FEN,
            reviewKey: "fresh-same-due-board",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 140,
                playedMoveSan: "c4",
                playedMoveUci: "c2c4",
            },
        });
        const freshOtherBoard = position({
            fen: ENDGAME_FEN,
            reviewKey: "fresh-other-board",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 60,
            },
        });
        const attemptedToday = position({
            fen: HANGING_KNIGHT_FEN,
            reviewKey: "attempted-today",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-25T12:00:00Z"),
            } as Position["card"],
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 200,
                lastAttemptedAt: new Date("2026-04-27T09:00:00Z").getTime(),
                lastAttemptedCardReps: 3,
            },
        });
        const freshSameAttemptedBoard = position({
            fen: HANGING_KNIGHT_FEN,
            reviewKey: "fresh-same-attempted-board",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 190,
                playedMoveSan: "e4",
                playedMoveUci: "e2e4",
            },
        });

        const positions = [
            freshSameScheduledBoard,
            scheduledBoard,
            freshSameDueBoard,
            dueBoard,
            freshOtherBoard,
            attemptedToday,
            freshSameAttemptedBoard,
        ];
        const batch = getMistakeReviewTimeManagementBatch(positions, {
            minMoveSeconds: 20,
            now,
        });
        const summary = getMistakeReviewTimeManagementSummary(positions, {
            minMoveSeconds: 20,
            now,
        });

        expect(batch.map((item) => item.reviewKey)).toEqual(["due-board", "fresh-other-board"]);
        expect(summary).toEqual({ readyCount: 2, clockDataCount: 4 });
    });

    test("SM2 review schedule starts at one day and grows from there", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const again = scheduleSm2Card(createEmptyCard(), 1, now);
        const firstGood = scheduleSm2Card(createEmptyCard(), 3, now);
        const secondGood = scheduleSm2Card(firstGood.card, 3, new Date(now.getTime() + ONE_DAY_MS));
        const thirdEasy = scheduleSm2Card(
            secondGood.card,
            4,
            new Date(now.getTime() + 7 * ONE_DAY_MS),
        );
        const lapse = scheduleSm2Card(thirdEasy.card, 2, new Date(now.getTime() + 23 * ONE_DAY_MS));

        expect(again.card.reps).toBe(0);
        expect(again.card.scheduled_days).toBe(1);
        expect(again.card.due.getTime()).toBe(now.getTime() + ONE_DAY_MS);
        expect(firstGood.card.reps).toBe(1);
        expect(firstGood.card.scheduled_days).toBe(1);
        expect(secondGood.card.reps).toBe(2);
        expect(secondGood.card.scheduled_days).toBe(6);
        expect(thirdEasy.card.reps).toBe(3);
        expect(thirdEasy.card.scheduled_days).toBeGreaterThan(6);
        expect(lapse.card.reps).toBe(0);
        expect(lapse.card.scheduled_days).toBe(1);
        expect(lapse.card.lapses).toBe(1);
    });

    test("review stats do not count relearning cards as unseen before their due date", () => {
        const again = scheduleSm2Card(createEmptyCard(), 1, new Date());
        const stats = getStats([position({ card: again.card })]);

        expect(stats.unseen).toBe(0);
        expect(stats.due).toBe(0);
        expect(stats.practiced).toBe(1);
    });

    test("repertoire practice SM2 uses minute-scale first reviews without changing the default", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const defaultGood = scheduleSm2Card(createEmptyCard(), 3, now);
        const again = scheduleSm2Card(createEmptyCard(), 1, now, { profile: "repertoire" });
        const hard = scheduleSm2Card(createEmptyCard(), 2, now, { profile: "repertoire" });
        const firstGood = scheduleSm2Card(createEmptyCard(), 3, now, { profile: "repertoire" });
        const firstEasy = scheduleSm2Card(createEmptyCard(), 4, now, { profile: "repertoire" });
        const secondGood = scheduleSm2Card(
            firstGood.card,
            3,
            new Date(now.getTime() + 30 * ONE_MINUTE_MS),
            { profile: "repertoire" },
        );

        expect(defaultGood.card.due.getTime()).toBe(now.getTime() + ONE_DAY_MS);
        expect(again.card.due.getTime()).toBe(now.getTime() + 5 * ONE_MINUTE_MS);
        expect(hard.card.due.getTime()).toBe(now.getTime() + 15 * ONE_MINUTE_MS);
        expect(firstGood.card.due.getTime()).toBe(now.getTime() + 30 * ONE_MINUTE_MS);
        expect(firstEasy.card.due.getTime()).toBe(now.getTime() + 2 * 60 * ONE_MINUTE_MS);
        expect(secondGood.card.due.getTime()).toBe(now.getTime() + (30 + 4 * 60) * ONE_MINUTE_MS);
        expect(firstGood.card.scheduled_days).toBeCloseTo(30 / (24 * 60));
    });

    test("merge preserves SRS state while aggregating repeated evidence", () => {
        const previous = position({
            card: {
                ...createEmptyCard(),
                reps: 4,
                due: new Date("2026-05-01T12:00:00Z"),
            } as Position["card"],
            comment: "keep this",
            mistakeReview: {
                ...position().mistakeReview!,
                gameIds: [1],
                occurrenceCount: 1,
                lastAttemptedAt: 1_000,
                lastAttemptedCardReps: 0,
            },
        });
        const incoming = position({
            answer: "d4",
            answerUci: "d2d4",
            mistakeReview: {
                ...position().mistakeReview!,
                gameIds: [2, 3],
                occurrenceCount: 2,
                lastAttemptedAt: 500,
                lastAttemptedCardReps: 1,
            },
        });

        const merged = mergeMistakeReviewPositions(deck([previous]), [incoming]);

        expect(merged.positions).toHaveLength(1);
        expect(merged.positions[0]!.answer).toBe("d4");
        expect(merged.positions[0]!.card.reps).toBe(4);
        expect(merged.positions[0]!.comment).toBe("keep this");
        expect(merged.positions[0]!.mistakeReview?.gameIds).toEqual([1, 2, 3]);
        expect(merged.positions[0]!.mistakeReview?.occurrenceCount).toBe(3);
        expect(merged.positions[0]!.mistakeReview?.lastAttemptedAt).toBe(1_000);
        expect(merged.positions[0]!.mistakeReview?.lastAttemptedCardReps).toBe(0);
    });

    test("clock hydration fills timing data without resetting SRS state", () => {
        const previous = position({
            reviewKey: "clock-card",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-05-01T12:00:00Z"),
            } as Position["card"],
            evidence: "1 occurrence; latest against Opponent.",
            mistakeReview: {
                ...position().mistakeReview!,
                gameId: 7,
                gameIds: [7],
                playedMoveUci: "g2g4",
                moveTimeSeconds: null,
                clockBeforeSeconds: null,
                clockAfterSeconds: null,
            },
        });

        const result = applyMistakeReviewClockTimings(deck([previous]), [
            {
                reviewKey: "clock-card",
                gameId: 7,
                ply: 12,
                moveSequence: "e4 e5 Nf3 Nc6",
                moveTimeSeconds: 42,
                clockBeforeSeconds: 120,
                clockAfterSeconds: 78,
                date: "2026.04.30",
                time: "18:00:00",
                timeControl: "300+0",
            },
        ]);

        expect(result.updatedCount).toBe(1);
        expect(result.deck.positions[0]!.card.reps).toBe(3);
        expect(result.deck.positions[0]!.mistakeReview?.moveTimeSeconds).toBe(42);
        expect(result.deck.positions[0]!.mistakeReview?.clockAfterSeconds).toBe(78);
        expect(result.deck.positions[0]!.moveSequence).toBe("e4 e5 Nf3 Nc6");
        expect(result.deck.positions[0]!.tags).toContain("Long think");
        expect(result.deck.positions[0]!.evidence).toContain("Spent 42s");
    });

    test("line hydration fills mistake move sequence without clock data", () => {
        const previous = position({
            reviewKey: "line-card",
            moveSequence: undefined,
            mistakeReview: {
                ...position().mistakeReview!,
                playedMoveUci: "g2g4",
                moveTimeSeconds: 42,
                clockBeforeSeconds: 120,
                clockAfterSeconds: 78,
            },
        });

        const result = applyMistakeReviewClockTimings(deck([previous]), [
            {
                reviewKey: "line-card",
                gameId: 7,
                ply: 4,
                moveSequence: "d4 Nf6 c4 e6",
                moveTimeSeconds: null,
                clockBeforeSeconds: null,
                clockAfterSeconds: null,
                date: null,
                time: null,
                timeControl: null,
            },
        ]);

        expect(result.updatedCount).toBe(1);
        expect(result.deck.positions[0]!.moveSequence).toBe("d4 Nf6 c4 e6");
        expect(result.deck.positions[0]!.mistakeReview?.moveTimeSeconds).toBe(42);
    });

    test("formats mistake review last seen from attempt metadata", () => {
        const now = Date.now();
        const seenPosition = position({
            mistakeReview: {
                ...position().mistakeReview!,
                lastAttemptedAt: now - 2 * 3600000,
            },
        });

        expect(formatMistakeReviewLastSeen(position())).toBe("Never");
        expect(formatMistakeReviewLastSeen(seenPosition)).toBe("2h ago");
    });

    test("auto-update scans every exact username variant", () => {
        const targets = selectMistakeReviewPlayerTargets(
            [
                { id: 1, name: "Loxty" },
                { id: 2, name: "loxty" },
                { id: 3, name: "Loxty_Bot" },
                { id: 4, name: "Other" },
            ],
            "loxty",
        );

        expect(targets).toEqual([
            { playerId: 1, playerName: "Loxty" },
            { playerId: 2, playerName: "loxty" },
        ]);
    });

    test("auto-update dedupes configured and online account names", () => {
        const names = getMistakeReviewAutoUpdatePlayerNameCandidates(
            {
                ...deck([]).settings,
                enabled: true,
                playerName: "Loxty",
            },
            {
                source: "lichess",
                username: "loxty",
                accounts: [
                    { source: "lichess", username: "loxty" },
                    { source: "chesscom", username: "Loxty!" },
                ],
                dbPath: "games.db3",
                title: "Online games",
                autoUpdate: true,
                lastCheckedAt: null,
                lastUpdatedAt: 100,
                lastKnownGameCount: 10,
            },
        );

        expect(names).toEqual(["Loxty"]);
    });

    test("online database updates can be detected when count stays flat", () => {
        expect(
            hasOnlineDatabaseNewLocalGames(
                { gameCount: 100, lastGameId: 200 },
                { gameCount: 100, lastGameId: 205 },
            ),
        ).toBe(true);
        expect(
            hasOnlineDatabaseNewLocalGames(
                { gameCount: 100, lastGameId: 200 },
                { gameCount: 101, lastGameId: 200 },
            ),
        ).toBe(true);
        expect(
            hasOnlineDatabaseNewLocalGames(
                { gameCount: 100, lastGameId: null },
                { gameCount: 100, lastGameId: 205 },
            ),
        ).toBe(false);
    });
});
