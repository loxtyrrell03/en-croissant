import { INITIAL_FEN } from "chessops/fen";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import { scheduleSm2Card, type Position } from "@/components/files/opening";
import {
    classifyMistakeReviewAttempt,
    DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
    formatMistakeReviewMoveTime,
    formatMistakeReviewMoveTimeWords,
    formatMistakeReviewTimeManagementFeedback,
    formatMistakeReviewLastSeen,
    getMistakeReviewDailyBatch,
    getMistakeReviewDailyProgress,
    getMistakeReviewPhase,
    getMistakeReviewPhaseBatch,
    getMistakeReviewPhaseCounts,
    getMistakeReviewTimeManagementBatch,
    isMistakeReviewPassingLabel,
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
const OPENING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 5";
const MIDDLEGAME_FEN = "r1bq1rk1/ppp2ppp/2n2n2/3pp3/3PP3/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 20";
const ENDGAME_FEN = "8/8/8/8/8/8/4K3/4k3 w - - 0 40";

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

        expect(getMistakeReviewPhase(openingDue)).toBe("opening");
        expect(getMistakeReviewPhase(middlegame)).toBe("middlegame");
        expect(getMistakeReviewPhase(endgame)).toBe("endgame");
        expect(counts.opening).toEqual({ total: 3, due: 1 });
        expect(counts.middlegame).toEqual({ total: 1, due: 0 });
        expect(counts.endgame).toEqual({ total: 1, due: 0 });
        expect(batch.map((item) => item.reviewKey)).toEqual([
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

    test("time management batch keeps long-think mistakes first", () => {
        const shortThink = position({
            reviewKey: "short-think",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 12,
                severity: "blunder",
            },
        });
        const longThink = position({
            reviewKey: "long-think",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 45,
                severity: "mistake",
            },
        });
        const longestThink = position({
            reviewKey: "longest-think",
            mistakeReview: {
                ...position().mistakeReview!,
                moveTimeSeconds: 90,
                severity: "inaccuracy",
            },
        });

        expect(
            getMistakeReviewTimeManagementBatch([shortThink, longThink, longestThink], {
                minMoveSeconds: 20,
            }).map((item) => item.reviewKey),
        ).toEqual(["longest-think", "long-think"]);
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
        expect(result.deck.positions[0]!.tags).toContain("Long think");
        expect(result.deck.positions[0]!.evidence).toContain("Spent 42s");
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
