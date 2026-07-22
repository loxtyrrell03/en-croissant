import { INITIAL_FEN } from "chessops/fen";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import {
    DEFAULT_OPENING_REVIEW_DAILY_SETTINGS,
    createOpeningReviewDeck,
    getOpeningReviewDailyBatch,
    getOpeningReviewDailyProgress,
    mergeOpeningReviewPositions,
    type OpeningReviewDailySettings,
} from "@/utils/openingReview";
import {
    getOpeningReviewGapTrainingType,
    getOpeningReviewPlanGapTrainingIndices,
    openingReviewAutoUpdateNeedsScan,
    openingReviewGapTrainingTypeDescription,
    openingReviewGapTrainingTypeLabel,
    openingReviewPositionExplanation,
} from "@/utils/openingReviewAutoUpdate";

const BLACK_TO_MOVE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
const AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const AFTER_D4_FEN = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
const AFTER_C4_FEN = "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1";

function position(overrides: Partial<Position> = {}): Position {
    return {
        fen: INITIAL_FEN,
        answer: "Nf3",
        answerUci: "g1f3",
        card: createEmptyCard(),
        reviewKey: `${INITIAL_FEN}|g1f3`,
        priority: 50,
        openingHealth: {
            lastPlayed: "2026.04.20",
            reviewSide: "white",
        },
        ...overrides,
    };
}

function dailySettings(
    overrides: Partial<OpeningReviewDailySettings> = {},
): OpeningReviewDailySettings {
    return {
        ...DEFAULT_OPENING_REVIEW_DAILY_SETTINGS,
        ...overrides,
    };
}

describe("opening review helpers", () => {
    test("daily review takes due cards first, then capped new cards", () => {
        const now = new Date("2026-04-26T12:00:00");
        const dueHigh = position({
            reviewKey: "due-high",
            priority: 80,
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
        });
        const dueLow = position({
            fen: AFTER_E4_FEN,
            reviewKey: "due-low",
            priority: 40,
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-23T12:00:00"),
            } as Position["card"],
        });
        const freshLow = position({ fen: AFTER_D4_FEN, reviewKey: "fresh-low", priority: 30 });
        const freshHighUnique = position({
            fen: AFTER_C4_FEN,
            reviewKey: "fresh-high",
            priority: 90,
        });

        const batch = getOpeningReviewDailyBatch(
            [freshLow, dueLow, freshHighUnique, dueHigh],
            dailySettings({ reviewsPerDay: 3, newItemsPerDay: 1 }),
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual(["due-high", "due-low", "fresh-high"]);
    });

    test("daily review prefers recent due gaps without skipping older SRS cards", () => {
        const now = new Date("2026-04-26T12:00:00");
        const oldDue = position({
            reviewKey: "old-due",
            priority: 70,
            openingHealth: { lastPlayed: "2025.01.15", reviewSide: "white" },
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-20T12:00:00"),
            } as Position["card"],
        });
        const recentDue = position({
            fen: AFTER_E4_FEN,
            reviewKey: "recent-due",
            priority: 70,
            openingHealth: { lastPlayed: "2026.04.25", reviewSide: "white" },
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
        });

        const batch = getOpeningReviewDailyBatch(
            [oldDue, recentDue],
            dailySettings({ reviewsPerDay: 2, newItemsPerDay: 0 }),
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual(["recent-due", "old-due"]);
    });

    test("daily review keeps one card per board position", () => {
        const now = new Date("2026-04-26T12:00:00");
        const dueHigh = position({
            reviewKey: "due-high",
            priority: 80,
            answer: "e4",
            answerUci: "e2e4",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
        });
        const dueSameBoard = position({
            reviewKey: "due-same-board",
            priority: 40,
            answer: "d4",
            answerUci: "d2d4",
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-23T12:00:00"),
            } as Position["card"],
        });
        const freshSameBoard = position({
            reviewKey: "fresh-same-board",
            priority: 90,
            answer: "c4",
            answerUci: "c2c4",
        });
        const freshOtherBoard = position({
            fen: BLACK_TO_MOVE_FEN,
            reviewKey: "fresh-other-board",
            answer: "e5",
            answerUci: "e7e5",
        });

        const batch = getOpeningReviewDailyBatch(
            [freshSameBoard, dueSameBoard, freshOtherBoard, dueHigh],
            dailySettings({ reviewsPerDay: 4, newItemsPerDay: 2 }),
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual(["due-high", "fresh-other-board"]);
    });

    test("daily review subtracts positions already attempted today", () => {
        const now = new Date("2026-04-26T12:00:00");
        const attemptedAt = new Date("2026-04-26T09:00:00").getTime();
        const dueDone = position({
            fen: AFTER_C4_FEN,
            reviewKey: "due-done",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
            openingReview: {
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 3,
            },
        });
        const dueOne = position({
            reviewKey: "due-one",
            priority: 70,
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
        });
        const dueTwo = position({
            fen: AFTER_E4_FEN,
            reviewKey: "due-two",
            priority: 60,
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-25T12:00:00"),
            } as Position["card"],
        });

        const settings = dailySettings({ reviewsPerDay: 2, newItemsPerDay: 1 });
        const batch = getOpeningReviewDailyBatch([dueOne, dueDone, dueTwo], settings, { now });
        const progress = getOpeningReviewDailyProgress([dueOne, dueDone, dueTwo], settings, {
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
            reviewKey: "done-board",
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
            openingReview: {
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 3,
            },
        });
        const duplicateSameBoard = position({
            reviewKey: "duplicate-same-board",
            answer: "d4",
            answerUci: "d2d4",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
        });
        const otherBoard = position({
            fen: AFTER_E4_FEN,
            reviewKey: "other-board",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
        });

        const settings = dailySettings({ reviewsPerDay: 3, newItemsPerDay: 1 });
        const positions = [duplicateSameBoard, otherBoard, done];
        const batch = getOpeningReviewDailyBatch(positions, settings, { now });
        const progress = getOpeningReviewDailyProgress(positions, settings, { now });

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
                due: new Date("2026-04-30T12:00:00"),
            } as Position["card"],
            openingReview: {
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 0,
            },
        });
        const freshOne = position({ reviewKey: "fresh-one" });
        const freshTwo = position({ reviewKey: "fresh-two" });
        const settings = dailySettings({ reviewsPerDay: 3, newItemsPerDay: 1 });

        const batch = getOpeningReviewDailyBatch([completedNew, freshOne, freshTwo], settings, {
            now,
        });
        const progress = getOpeningReviewDailyProgress(
            [completedNew, freshOne, freshTwo],
            settings,
            { now },
        );

        expect(progress.completed).toBe(1);
        expect(progress.completedNew).toBe(1);
        expect(progress.newRemaining).toBe(0);
        expect(batch).toEqual([]);
    });

    test("daily review filters by last played period, urgency, and color", () => {
        const now = new Date("2026-04-26T12:00:00");
        const recentWhite = position({
            reviewKey: "recent-white",
            priority: 70,
            openingHealth: { lastPlayed: "2026.04.24", reviewSide: "white" },
        });
        const oldWhite = position({
            reviewKey: "old-white",
            priority: 90,
            openingHealth: { lastPlayed: "2024.04.24", reviewSide: "white" },
        });
        const recentBlack = position({
            reviewKey: "recent-black",
            priority: 90,
            openingHealth: { lastPlayed: "2026.04.24", reviewSide: "black" },
        });
        const lowUrgency = position({
            reviewKey: "low-urgency",
            priority: 20,
            openingHealth: { lastPlayed: "2026.04.24", reviewSide: "white" },
        });

        const batch = getOpeningReviewDailyBatch(
            [oldWhite, recentBlack, lowUrgency, recentWhite],
            dailySettings({
                gamePeriod: "week",
                minUrgency: 50,
                includeBlack: false,
            }),
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual(["recent-white"]);
    });

    test("daily progress counts opening cards reviewed from other trainer modes", () => {
        const now = new Date("2026-04-26T12:00:00");
        const attemptedAt = new Date("2026-04-26T09:00:00").getTime();
        const trainedOutsideDailyScope = position({
            fen: AFTER_D4_FEN,
            reviewKey: "trained-outside-daily-scope",
            priority: 90,
            openingHealth: { lastPlayed: "2024.04.24", reviewSide: "black" },
            card: {
                ...createEmptyCard(),
                reps: 3,
                due: new Date("2026-04-24T12:00:00"),
            } as Position["card"],
            openingReview: {
                lastAttemptedAt: attemptedAt,
                lastAttemptedCardReps: 3,
            },
        });
        const dailyOne = position({
            fen: AFTER_E4_FEN,
            reviewKey: "daily-one",
            priority: 70,
            openingHealth: { lastPlayed: "2026.04.24", reviewSide: "white" },
        });
        const dailyTwo = position({
            fen: AFTER_C4_FEN,
            reviewKey: "daily-two",
            priority: 60,
            openingHealth: { lastPlayed: "2026.04.24", reviewSide: "white" },
        });
        const settings = dailySettings({
            reviewsPerDay: 2,
            newItemsPerDay: 2,
            gamePeriod: "week",
            minUrgency: 50,
            includeBlack: false,
        });

        const positions = [trainedOutsideDailyScope, dailyOne, dailyTwo];
        const progress = getOpeningReviewDailyProgress(positions, settings, { now });
        const batch = getOpeningReviewDailyBatch(positions, settings, { now });

        expect(progress.completed).toBe(1);
        expect(progress.remaining).toBe(1);
        expect(batch.map((item) => item.reviewKey)).toEqual(["daily-one"]);
    });

    test("merge preserves daily attempt metadata", () => {
        const previous = position({
            answer: "d4",
            answerUci: "d2d4",
            openingReview: {
                lastAttemptedAt: 1_000,
                lastAttemptedCardReps: 0,
            },
        });
        const incoming = position({
            openingReview: {
                lastAttemptedAt: 500,
                lastAttemptedCardReps: 1,
            },
        });
        const deck = createOpeningReviewDeck({ name: "Openings", positions: [previous] });

        const merged = mergeOpeningReviewPositions(deck, [incoming]);

        expect(merged.positions[0]!.answer).toBe("Nf3");
        expect(merged.positions[0]!.openingReview?.lastAttemptedAt).toBe(1_000);
        expect(merged.positions[0]!.openingReview?.lastAttemptedCardReps).toBe(0);
    });

    test("classifies saved opening review cards by the trained move", () => {
        const baseOpeningHealth = {
            classification: "preparedUnderperforming" as const,
            usualMoveSan: "Nc3",
            usualMoveUci: "b1c3",
            topMoveSan: "e4",
            topMoveUci: "e2e4",
        };

        expect(
            getOpeningReviewGapTrainingType(
                position({
                    answer: "Nc3",
                    answerUci: "b1c3",
                    openingHealth: baseOpeningHealth,
                }),
            ),
        ).toBe("planGap");
        expect(
            getOpeningReviewGapTrainingType(
                position({
                    answer: "e4",
                    answerUci: "e2e4",
                    openingHealth: baseOpeningHealth,
                }),
            ),
        ).toBe("openingGap");
        expect(
            getOpeningReviewGapTrainingType(
                position({
                    tags: ["Prepared but underperforming"],
                    openingHealth: undefined,
                }),
            ),
        ).toBe("planGap");
    });

    test("labels bad move gaps and plan gaps explicitly", () => {
        const badMoveGap = position({
            answer: "e4",
            answerUci: "e2e4",
            openingHealth: {
                classification: "repertoireGap",
                usualMoveSan: "Nc3",
                usualMoveUci: "b1c3",
                topMoveSan: "e4",
                topMoveUci: "e2e4",
            },
        });
        const planGap = position({
            answer: "Nc3",
            answerUci: "b1c3",
            openingHealth: {
                classification: "preparedUnderperforming",
                usualMoveSan: "Nc3",
                usualMoveUci: "b1c3",
            },
        });

        expect(openingReviewGapTrainingTypeLabel("openingGap")).toBe("Bad move gap");
        expect(openingReviewGapTrainingTypeDescription("openingGap", badMoveGap)).toContain(
            "Replace Nc3 with e4",
        );
        expect(
            openingReviewGapTrainingTypeDescription("openingGap", badMoveGap, {
                revealMoves: false,
            }),
        ).not.toContain("e4");
        expect(openingReviewPositionExplanation(badMoveGap)).toMatch(/^Bad move gap:/);
        expect(openingReviewGapTrainingTypeLabel("planGap")).toBe("Plan gap");
        expect(openingReviewGapTrainingTypeDescription("planGap", planGap)).toContain(
            "Nc3 is still the move",
        );
        expect(
            openingReviewGapTrainingTypeDescription("planGap", planGap, { revealMoves: false }),
        ).not.toContain("Nc3");
        expect(openingReviewPositionExplanation(planGap)).toMatch(/^Plan gap:/);
    });

    test("selects opening plan gaps in urgency order", () => {
        const planLow = position({
            answer: "Nc3",
            answerUci: "b1c3",
            reviewKey: "plan-low",
            priority: 30,
            openingHealth: {
                classification: "preparedUnderperforming",
                usualMoveSan: "Nc3",
                usualMoveUci: "b1c3",
            },
        });
        const openingGap = position({
            answer: "e4",
            answerUci: "e2e4",
            reviewKey: "opening-gap",
            priority: 100,
            openingHealth: {
                classification: "repertoireGap",
                usualMoveSan: "Nc3",
                usualMoveUci: "b1c3",
            },
        });
        const planHigh = position({
            answer: "d4",
            answerUci: "d2d4",
            reviewKey: "plan-high",
            priority: 80,
            openingHealth: {
                classification: "preparedUnderperforming",
                usualMoveSan: "d4",
                usualMoveUci: "d2d4",
            },
        });

        expect(getOpeningReviewPlanGapTrainingIndices([planLow, openingGap, planHigh])).toEqual([
            2, 0,
        ]);
    });

    test("auto-update reruns when the linked database changed after the deck scan", () => {
        expect(
            openingReviewAutoUpdateNeedsScan(
                {
                    enabled: true,
                    playerDb: "loxi-ty_chesscom.db3",
                    playerId: 1,
                    playerName: "Loxi-ty",
                    referenceDb: "mega.db3",
                    mode: "self",
                    color: "any",
                    maxPlies: 30,
                    minPlayerGames: 3,
                    minReferenceGames: 20,
                    topReferenceMoves: 3,
                    dateRange: "all",
                    lastUpdatedDatabaseAt: 1_000,
                    lastKnownGameCount: 12_970,
                },
                {
                    source: "chesscom",
                    username: "loxi-ty",
                    dbPath: "loxi-ty_chesscom.db3",
                    title: "loxi-ty Chess.com",
                    autoUpdate: true,
                    lastCheckedAt: 2_000,
                    lastUpdatedAt: 2_000,
                    lastKnownGameCount: 12_970,
                },
            ),
        ).toBe(true);

        expect(
            openingReviewAutoUpdateNeedsScan(
                {
                    enabled: true,
                    playerDb: "loxi-ty_chesscom.db3",
                    playerId: 1,
                    playerName: "Loxi-ty",
                    referenceDb: "mega.db3",
                    mode: "self",
                    color: "any",
                    maxPlies: 30,
                    minPlayerGames: 3,
                    minReferenceGames: 20,
                    topReferenceMoves: 3,
                    dateRange: "all",
                    lastUpdatedDatabaseAt: 1_000,
                    lastKnownGameCount: 12_835,
                },
                {
                    source: "chesscom",
                    username: "loxi-ty",
                    dbPath: "loxi-ty_chesscom.db3",
                    title: "loxi-ty Chess.com",
                    autoUpdate: true,
                    lastCheckedAt: null,
                    lastUpdatedAt: null,
                    lastKnownGameCount: 12_970,
                },
            ),
        ).toBe(true);
    });
});
