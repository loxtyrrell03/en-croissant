import { INITIAL_FEN } from "chessops/fen";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import {
    classifyMistakeReviewAttempt,
    formatMistakeReviewLastSeen,
    getMistakeReviewDailyBatch,
    getMistakeReviewDailyProgress,
    isMistakeReviewPassingLabel,
    mergeMistakeReviewPositions,
    type MistakeReviewDeck,
} from "@/utils/mistakeReview";

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

    test("daily review takes due cards first, then capped new cards", () => {
        const now = new Date("2026-04-26T12:00:00Z");
        const dueBlunder = position({
            reviewKey: "due-blunder",
            card: {
                ...createEmptyCard(),
                reps: 2,
                due: new Date("2026-04-24T12:00:00Z"),
            } as Position["card"],
            mistakeReview: { ...position().mistakeReview!, severity: "blunder", gameIds: [1] },
        });
        const dueMistake = position({
            reviewKey: "due-mistake",
            card: {
                ...createEmptyCard(),
                reps: 1,
                due: new Date("2026-04-23T12:00:00Z"),
            } as Position["card"],
            mistakeReview: { ...position().mistakeReview!, severity: "mistake", gameIds: [2] },
        });
        const freshOne = position({ reviewKey: "new-one" });
        const freshTwo = position({ reviewKey: "new-two" });

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

    test("daily review subtracts positions already attempted today", () => {
        const now = new Date("2026-04-26T12:00:00");
        const attemptedAt = new Date("2026-04-26T09:00:00").getTime();
        const dueDone = position({
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
});
