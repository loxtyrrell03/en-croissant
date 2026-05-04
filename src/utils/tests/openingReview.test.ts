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
import { getOpeningReviewGapTrainingType } from "@/utils/openingReviewAutoUpdate";

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
            reviewKey: "due-low",
            priority: 40,
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-23T12:00:00"),
            } as Position["card"],
        });
        const freshHigh = position({ reviewKey: "fresh-high", priority: 90 });
        const freshLow = position({ reviewKey: "fresh-low", priority: 30 });

        const batch = getOpeningReviewDailyBatch(
            [freshLow, dueLow, freshHigh, dueHigh],
            dailySettings({ reviewsPerDay: 3, newItemsPerDay: 1 }),
            { now },
        );

        expect(batch.map((item) => item.reviewKey)).toEqual(["due-high", "due-low", "fresh-high"]);
    });

    test("daily review subtracts positions already attempted today", () => {
        const now = new Date("2026-04-26T12:00:00");
        const attemptedAt = new Date("2026-04-26T09:00:00").getTime();
        const dueDone = position({
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
});
