import type { DrawShape } from "@lichess-org/chessground/draw";
import type { SetStateAction } from "react";
import { type Card, createEmptyCard, type Grade, type ReviewLog, State } from "ts-fsrs";
import { z } from "zod";
import type { RepertoireGap } from "@/bindings";
import type { PracticeData } from "@/state/atoms";
import type { Annotation } from "@/utils/annotation";
import { isPrefix } from "@/utils/misc";
import { type TreeNode, treeIterator } from "@/utils/treeReducer";

const REVIEW_DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_MINUTE_MS = 60 * 1000;
const SM2_DEFAULT_EASE_FACTOR = 2.5;
const SM2_MIN_EASE_FACTOR = 1.3;
const REPERTOIRE_AGAIN_MINUTES = 5;
const REPERTOIRE_HARD_MINUTES = 15;
const REPERTOIRE_FIRST_GOOD_MINUTES = 30;
const REPERTOIRE_SECOND_GOOD_MINUTES = 4 * 60;
const REPERTOIRE_FIRST_EASY_MINUTES = 2 * 60;
const REPERTOIRE_SECOND_EASY_MINUTES = 12 * 60;

type Sm2CardFields = {
    sm2EaseFactor?: number;
    sm2IntervalDays?: number;
    sm2IntervalMinutes?: number;
    sm2ScheduleProfile?: ReviewScheduleProfile;
};

export type ReviewScheduleProfile = "daily" | "repertoire";

export type ReviewScheduleOptions = {
    profile?: ReviewScheduleProfile;
};

const reviewTreeNodeSchema: z.ZodType<TreeNode> = z.lazy(
    () =>
        z.object({
            fen: z.string(),
            move: z.object({}).passthrough().nullable().default(null),
            san: z.string().nullable().default(null),
            children: reviewTreeNodeSchema.array().default([]),
            score: z.object({}).passthrough().nullable().default(null),
            depth: z.number().nullable().default(null),
            halfMoves: z.number(),
            shapes: z.array(z.object({}).passthrough()).default([]),
            annotations: z.array(z.string()).default([]),
            comment: z.string().default(""),
            clock: z.number().optional(),
        }) as unknown as z.ZodType<TreeNode>,
);

export const positionSchema = z.object({
    fen: z.string(),
    answer: z.string(),
    answerUci: z.string().optional(),
    card: z.object({}).passthrough(),
    sideToMove: z.enum(["white", "black"]).optional(),
    moveSequence: z.string().optional(),
    tags: z.array(z.string()).optional(),
    source: z.string().optional(),
    reviewKey: z.string().optional(),
    priority: z.number().optional(),
    reason: z.string().optional(),
    evidence: z.string().optional(),
    importedAt: z.number().optional(),
    comment: z.string().optional(),
    annotations: z.array(z.string()).optional(),
    shapes: z.array(z.object({}).passthrough()).optional(),
    reviewTree: reviewTreeNodeSchema.optional(),
    openingReview: z
        .object({
            lastAttemptedAt: z.number().optional(),
            lastAttemptedCardReps: z.number().optional(),
        })
        .optional(),
    openingHealth: z
        .object({
            classification: z
                .enum(["repertoireGap", "preparedUnderperforming", "lowConfidence"])
                .optional(),
            mode: z.enum(["self", "opponent"]).optional(),
            sideToMove: z.enum(["white", "black"]).optional(),
            reviewSide: z.enum(["white", "black"]).optional(),
            usualMoveSan: z.string().optional(),
            usualMoveUci: z.string().optional(),
            games: z.number().optional(),
            white: z.number().optional(),
            draw: z.number().optional(),
            black: z.number().optional(),
            score: z.number().optional(),
            strongGames: z.number().optional(),
            strongWhite: z.number().nullable().optional(),
            strongDraw: z.number().nullable().optional(),
            strongBlack: z.number().nullable().optional(),
            strongScore: z.number().nullable().optional(),
            topMoveSan: z.string().nullable().optional(),
            topMoveUci: z.string().nullable().optional(),
            openingName: z.string().optional(),
            lastPlayed: z.string().nullable().optional(),
            dateRange: z
                .enum(["all", "3months", "6months", "year", "2years", "5years", "custom"])
                .optional(),
            startDate: z.string().nullable().optional(),
            endDate: z.string().nullable().optional(),
            timeControl: z.string().nullable().optional(),
            timeControls: z.array(z.string()).optional(),
        })
        .optional(),
    mistakeReview: z
        .object({
            playerDb: z.string().optional(),
            playerId: z.number().optional(),
            playerName: z.string().nullable().optional(),
            playerColor: z.enum(["white", "black"]).optional(),
            playedMoveSan: z.string().optional(),
            playedMoveUci: z.string().optional(),
            bestMoveSan: z.string().optional(),
            bestMoveUci: z.string().optional(),
            pvSan: z.array(z.string()).optional(),
            pvUci: z.array(z.string()).optional(),
            refutationSan: z.array(z.string()).optional(),
            refutationUci: z.array(z.string()).optional(),
            severity: z
                .enum(["best", "good", "okay", "inaccuracy", "mistake", "blunder"])
                .optional(),
            cpLoss: z.number().optional(),
            winProbabilityDrop: z.number().optional(),
            cpBefore: z.number().optional(),
            cpAfter: z.number().optional(),
            requestedDepth: z.number().optional(),
            reachedDepth: z.number().optional(),
            analysisMode: z.enum(["single", "layered"]).optional(),
            fastDepth: z.number().optional(),
            multiPv: z.number().optional(),
            timeControls: z
                .array(
                    z.enum(["bullet", "blitz", "rapid", "classical", "correspondence", "unknown"]),
                )
                .optional(),
            dateRange: z
                .enum(["all", "week", "2weeks", "month", "3months", "6months", "year"])
                .optional(),
            engineName: z.string().optional(),
            enginePath: z.string().optional(),
            phase: z.enum(["opening", "middlegame", "endgame"]).optional(),
            nature: z.enum(["tactical", "positional"]).optional(),
            mistakeNature: z.enum(["tactical", "positional"]).optional(),
            category: z.string().optional(),
            natureConfidence: z.enum(["high", "medium", "low"]).optional(),
            natureReason: z.string().optional(),
            tacticalSignals: z.array(z.string()).optional(),
            natureAspect: z.enum(["allowed", "missed", "both"]).optional(),
            allowedNature: z.enum(["tactical", "positional"]).optional(),
            allowedNatureReason: z.string().optional(),
            missedNature: z.enum(["tactical", "positional"]).optional(),
            missedNatureReason: z.string().optional(),
            natureClassifierVersion: z.number().optional(),
            gamePhase: z.string().optional(),
            positionPhase: z.string().optional(),
            summary: z
                .object({
                    phase: z.string().optional(),
                    nature: z.string().optional(),
                    mistakeNature: z.string().optional(),
                    natureConfidence: z.string().optional(),
                })
                .passthrough()
                .optional(),
            gameId: z.number().optional(),
            lastGameId: z.number().optional(),
            ply: z.number().optional(),
            moveNumber: z.number().optional(),
            gameIds: z.array(z.number()).optional(),
            occurrenceCount: z.number().optional(),
            date: z.string().nullable().optional(),
            time: z.string().nullable().optional(),
            openingName: z.string().nullable().optional(),
            opponent: z.string().optional(),
            timeControl: z.string().nullable().optional(),
            whiteName: z.string().optional(),
            blackName: z.string().optional(),
            whiteElo: z.number().nullable().optional(),
            blackElo: z.number().nullable().optional(),
            gameResult: z.string().nullable().optional(),
            moveTimeSeconds: z.number().nullable().optional(),
            clockBeforeSeconds: z.number().nullable().optional(),
            clockAfterSeconds: z.number().nullable().optional(),
            longThinkThresholdSeconds: z.number().nullable().optional(),
            timeManagement: z
                .object({
                    enabled: z.boolean(),
                    minMoveSeconds: z.number(),
                })
                .optional(),
            lastAttemptedAt: z.number().optional(),
            lastAttemptedCardReps: z.number().optional(),
            thresholds: z
                .object({
                    inaccuracy: z.number(),
                    mistake: z.number(),
                    blunder: z.number(),
                })
                .optional(),
        })
        .optional(),
    engine: z
        .object({
            source: z.enum(["lichess", "chessdb", "cloud", "local"]).optional(),
            lossCp: z.number().optional(),
            depth: z.number().nullable().optional(),
            bestMoveSan: z.string().nullable().optional(),
            bestMoveUci: z.string().nullable().optional(),
        })
        .optional(),
});

export type Position = {
    fen: string;
    answer: string;
    answerUci?: string;
    card: Card;
    sideToMove?: "white" | "black";
    moveSequence?: string;
    tags?: string[];
    source?: string;
    reviewKey?: string;
    priority?: number;
    reason?: string;
    evidence?: string;
    importedAt?: number;
    comment?: string;
    annotations?: Annotation[];
    shapes?: DrawShape[];
    reviewTree?: TreeNode;
    openingReview?: {
        lastAttemptedAt?: number;
        lastAttemptedCardReps?: number;
    };
    openingHealth?: {
        classification?: RepertoireGap["classification"];
        mode?: "self" | "opponent";
        sideToMove?: "white" | "black";
        reviewSide?: "white" | "black";
        usualMoveSan?: string;
        usualMoveUci?: string;
        games?: number;
        white?: number;
        draw?: number;
        black?: number;
        score?: number;
        strongGames?: number;
        strongWhite?: number | null;
        strongDraw?: number | null;
        strongBlack?: number | null;
        strongScore?: number | null;
        topMoveSan?: string | null;
        topMoveUci?: string | null;
        openingName?: string;
        lastPlayed?: string | null;
        dateRange?: "all" | "3months" | "6months" | "year" | "2years" | "5years" | "custom";
        startDate?: string | null;
        endDate?: string | null;
        timeControl?: string | null;
        timeControls?: string[];
    };
    mistakeReview?: {
        playerDb?: string;
        playerId?: number;
        playerName?: string | null;
        playerColor?: "white" | "black";
        playedMoveSan?: string;
        playedMoveUci?: string;
        bestMoveSan?: string;
        bestMoveUci?: string;
        pvSan?: string[];
        pvUci?: string[];
        refutationSan?: string[];
        refutationUci?: string[];
        severity?: "best" | "good" | "okay" | "inaccuracy" | "mistake" | "blunder";
        cpLoss?: number;
        winProbabilityDrop?: number;
        cpBefore?: number;
        cpAfter?: number;
        requestedDepth?: number;
        reachedDepth?: number;
        analysisMode?: "single" | "layered";
        fastDepth?: number;
        multiPv?: number;
        timeControls?: (
            | "bullet"
            | "blitz"
            | "rapid"
            | "classical"
            | "correspondence"
            | "unknown"
        )[];
        dateRange?: "all" | "week" | "2weeks" | "month" | "3months" | "6months" | "year";
        engineName?: string;
        enginePath?: string;
        phase?: "opening" | "middlegame" | "endgame";
        nature?: "tactical" | "positional";
        mistakeNature?: "tactical" | "positional";
        category?: string;
        natureConfidence?: "high" | "medium" | "low";
        natureReason?: string;
        tacticalSignals?: string[];
        natureAspect?: "allowed" | "missed" | "both";
        allowedNature?: "tactical" | "positional";
        allowedNatureReason?: string;
        missedNature?: "tactical" | "positional";
        missedNatureReason?: string;
        natureClassifierVersion?: number;
        gamePhase?: string;
        positionPhase?: string;
        summary?: {
            phase?: string;
            nature?: string;
            mistakeNature?: string;
            natureConfidence?: string;
            [key: string]: unknown;
        };
        gameId?: number;
        lastGameId?: number;
        ply?: number;
        moveNumber?: number;
        gameIds?: number[];
        occurrenceCount?: number;
        date?: string | null;
        time?: string | null;
        openingName?: string | null;
        opponent?: string;
        timeControl?: string | null;
        whiteName?: string;
        blackName?: string;
        whiteElo?: number | null;
        blackElo?: number | null;
        gameResult?: string | null;
        moveTimeSeconds?: number | null;
        clockBeforeSeconds?: number | null;
        clockAfterSeconds?: number | null;
        longThinkThresholdSeconds?: number | null;
        timeManagement?: {
            enabled: boolean;
            minMoveSeconds: number;
        };
        lastAttemptedAt?: number;
        lastAttemptedCardReps?: number;
        thresholds?: {
            inaccuracy: number;
            mistake: number;
            blunder: number;
        };
    };
    engine?: {
        source?: "lichess" | "chessdb" | "cloud" | "local";
        lossCp?: number;
        depth?: number | null;
        bestMoveSan?: string | null;
        bestMoveUci?: string | null;
    };
};

export const OPENING_HEALTH_SOURCE = "Analyze Repertoire";

export function openingHealthClassificationLabel(classification: RepertoireGap["classification"]) {
    switch (classification) {
        case "repertoireGap":
            return "Bad move gap";
        case "preparedUnderperforming":
            return "Opening plan gap";
        case "lowConfidence":
            return "Low confidence";
    }
}

export function createOpeningHealthTrainingItem(
    gap: RepertoireGap,
    answerMove?: { san: string; uci?: string | null },
    options?: {
        priority?: number;
        reason?: string;
        evidence?: string;
        importedAt?: number;
        engine?: Position["engine"];
        openingHealth?: Position["openingHealth"];
    },
): Position | null {
    const answer = answerMove?.san || gap.topReferenceMoves[0]?.san;
    if (!answer) return null;
    const answerUci = answerMove?.uci ?? gap.topReferenceMoves[0]?.uci;
    const reviewKey = `${gap.normalizedFen}|${answerUci || answer}`;

    return {
        fen: gap.fen,
        answer,
        answerUci: answerUci || undefined,
        card: createEmptyCard(),
        sideToMove: gap.sideToMove === "black" ? "black" : "white",
        moveSequence: gap.moveSequence,
        tags: [openingHealthClassificationLabel(gap.classification), OPENING_HEALTH_SOURCE],
        source: OPENING_HEALTH_SOURCE,
        reviewKey,
        priority: options?.priority,
        reason: options?.reason,
        evidence: options?.evidence,
        importedAt: options?.importedAt ?? Date.now(),
        openingHealth: options?.openingHealth
            ? {
                  ...options.openingHealth,
                  classification: options.openingHealth.classification ?? gap.classification,
              }
            : undefined,
        engine: options?.engine,
    };
}

export function buildFromTree(tree: TreeNode, color: "white" | "black", start: number[]) {
    const cards: Position[] = [];
    const iterator = treeIterator(tree);
    for (const item of iterator) {
        if (
            item.node.children.length === 0 ||
            isPrefix(item.position, start) ||
            !item.node.children[0].san ||
            cards.find((c) => c.fen === item.node.fen)
        ) {
            continue;
        }
        if (
            (color === "white" && item.node.halfMoves % 2 === 0) ||
            (color === "black" && item.node.halfMoves % 2 === 1)
        ) {
            cards.push({
                fen: item.node.fen,
                answer: item.node.children[0].san,
                card: createEmptyCard(),
            });
        }
    }
    return cards;
}

type Stats = {
    unseen: number;
    due: number;
    practiced: number;
    nextDue: Date | null;
    total: number;
};

export function getStats(positions: Position[]) {
    const stats: Stats = {
        unseen: 0,
        due: 0,
        practiced: 0,
        nextDue: null,
        total: positions.length,
    };
    const now = new Date();
    for (const card of positions) {
        const dueDate = new Date(card.card.due);
        if (card.card.reps === 0) {
            stats.unseen++;
        } else if (dueDate <= now) {
            stats.due++;
        } else {
            stats.practiced++;
            if (!stats.nextDue || dueDate < stats.nextDue) {
                stats.nextDue = dueDate;
            }
        }
    }
    return stats;
}

export function getCardForReview(
    positions: Position[],
    options: { random: boolean } = { random: false },
): Position | null {
    if (options.random) {
        return positions[Math.floor(Math.random() * positions.length)];
    }
    const now = new Date();

    const filtered = positions.filter((position) => new Date(position.card.due) <= now);

    return filtered.length > 0 ? filtered[0] : null;
}

export function updateCardPerformance(
    setPositions: React.Dispatch<SetStateAction<PracticeData>>,
    i: number,
    card: Card,
    grade: 1 | 2 | 3 | 4,
    options: ReviewScheduleOptions = {},
) {
    const { card: newCard, log } = scheduleSm2Card(card, grade, new Date(), options);

    setPositions((data) => {
        data.positions[i].card = newCard;
        data.logs.push({ ...log, fen: data.positions[i].fen });
        return {
            positions: data.positions,
            logs: data.logs,
        };
    });
}

export function scheduleSm2Card(
    card: Card,
    grade: 1 | 2 | 3 | 4,
    reviewedAt: Date = new Date(),
    options: ReviewScheduleOptions = {},
): { card: Card; log: ReviewLog } {
    if (options.profile === "repertoire") {
        return scheduleRepertoireSm2Card(card, grade, reviewedAt);
    }

    const now = new Date(reviewedAt);
    const q = sm2QualityFromGrade(grade);
    const previousReps = Math.max(0, Math.trunc(Number(card.reps) || 0));
    const previousLapses = Math.max(0, Math.trunc(Number(card.lapses) || 0));
    const previousInterval = getSm2IntervalDays(card);
    const previousEaseFactor = getSm2EaseFactor(card);
    const easeFactor = Math.max(
        SM2_MIN_EASE_FACTOR,
        previousEaseFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
    );

    let reps: number;
    let lapses = previousLapses;
    let intervalDays: number;
    let state: State;

    if (q >= 4) {
        reps = previousReps + 1;
        if (reps === 1) {
            intervalDays = 1;
        } else if (reps === 2) {
            intervalDays = 6;
        } else {
            intervalDays = Math.max(1, Math.round(previousInterval * easeFactor));
        }
        state = State.Review;
    } else {
        reps = 0;
        lapses = previousLapses + 1;
        intervalDays = 1;
        state = previousReps > 0 ? State.Relearning : State.Learning;
    }

    const due = new Date(now.getTime() + intervalDays * REVIEW_DAY_MS);
    const elapsedDays = getElapsedReviewDays(card.last_review, now);
    const nextCard = {
        ...card,
        due,
        stability: intervalDays,
        difficulty: easeFactor,
        elapsed_days: elapsedDays,
        scheduled_days: intervalDays,
        reps,
        lapses,
        state,
        last_review: now,
    } satisfies Card;
    const sm2Card = nextCard as Card & Sm2CardFields;
    sm2Card.sm2EaseFactor = easeFactor;
    sm2Card.sm2IntervalDays = intervalDays;

    return {
        card: sm2Card,
        log: {
            rating: grade,
            state,
            due,
            stability: intervalDays,
            difficulty: easeFactor,
            elapsed_days: elapsedDays,
            last_elapsed_days: Math.max(0, Math.trunc(Number(card.elapsed_days) || 0)),
            scheduled_days: intervalDays,
            review: now,
        },
    };
}

function scheduleRepertoireSm2Card(
    card: Card,
    grade: 1 | 2 | 3 | 4,
    reviewedAt: Date = new Date(),
): { card: Card; log: ReviewLog } {
    const now = new Date(reviewedAt);
    const q = sm2QualityFromGrade(grade);
    const previousReps = Math.max(0, Math.trunc(Number(card.reps) || 0));
    const previousLapses = Math.max(0, Math.trunc(Number(card.lapses) || 0));
    const previousIntervalMinutes = getSm2IntervalMinutes(card);
    const hasRepertoireInterval = previousIntervalMinutes !== null;
    const previousEaseFactor = getSm2EaseFactor(card);
    const easeFactor = Math.max(
        SM2_MIN_EASE_FACTOR,
        previousEaseFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
    );

    let reps: number;
    let lapses = previousLapses;
    let intervalMinutes: number;
    let state: State;

    if (q >= 4) {
        reps = previousReps + 1;
        if (!hasRepertoireInterval || reps === 1) {
            intervalMinutes =
                grade === 4 ? REPERTOIRE_FIRST_EASY_MINUTES : REPERTOIRE_FIRST_GOOD_MINUTES;
        } else if (reps === 2) {
            intervalMinutes =
                grade === 4 ? REPERTOIRE_SECOND_EASY_MINUTES : REPERTOIRE_SECOND_GOOD_MINUTES;
        } else {
            intervalMinutes = Math.max(
                REPERTOIRE_AGAIN_MINUTES,
                Math.round(previousIntervalMinutes * easeFactor),
            );
        }
        state = State.Review;
    } else {
        reps = 0;
        lapses = previousLapses + 1;
        intervalMinutes = grade === 2 ? REPERTOIRE_HARD_MINUTES : REPERTOIRE_AGAIN_MINUTES;
        state = previousReps > 0 ? State.Relearning : State.Learning;
    }

    const due = new Date(now.getTime() + intervalMinutes * REVIEW_MINUTE_MS);
    const scheduledDays = intervalMinutes / (24 * 60);
    const elapsedDays = getElapsedReviewDays(card.last_review, now);
    const nextCard = {
        ...card,
        due,
        stability: scheduledDays,
        difficulty: easeFactor,
        elapsed_days: elapsedDays,
        scheduled_days: scheduledDays,
        reps,
        lapses,
        state,
        last_review: now,
    } satisfies Card;
    const sm2Card = nextCard as Card & Sm2CardFields;
    sm2Card.sm2EaseFactor = easeFactor;
    sm2Card.sm2IntervalMinutes = intervalMinutes;
    sm2Card.sm2ScheduleProfile = "repertoire";

    return {
        card: sm2Card,
        log: {
            rating: grade,
            state,
            due,
            stability: scheduledDays,
            difficulty: easeFactor,
            elapsed_days: elapsedDays,
            last_elapsed_days: Math.max(0, Math.trunc(Number(card.elapsed_days) || 0)),
            scheduled_days: scheduledDays,
            review: now,
        },
    };
}

export function syncDeck(
    existing: Position[],
    tree: TreeNode,
    color: "white" | "black",
    start: number[],
): { positions: Position[]; added: number; removed: number } {
    const freshPositions = buildFromTree(tree, color, start);
    const externalPositions = existing.filter((pos) => pos.source === OPENING_HEALTH_SOURCE);
    const managedExisting = existing.filter((pos) => pos.source !== OPENING_HEALTH_SOURCE);

    const existingByFen = new Map<string, Position>();
    for (const pos of managedExisting) {
        existingByFen.set(pos.fen, pos);
    }

    let added = 0;
    const merged: Position[] = [];
    for (const pos of freshPositions) {
        const prev = existingByFen.get(pos.fen);
        if (prev) {
            merged.push({ ...prev, answer: pos.answer });
        } else {
            merged.push(pos);
            added++;
        }
    }

    for (const pos of externalPositions) {
        if (!merged.some((item) => item.fen === pos.fen && item.answer === pos.answer)) {
            merged.push(pos);
        }
    }

    const freshFens = new Set(freshPositions.map((p) => p.fen));
    const removed = managedExisting.filter((p) => !freshFens.has(p.fen)).length;

    return { positions: merged, added, removed };
}

export function getNextReviewTimes(
    card: Card,
    options: ReviewScheduleOptions = {},
): Record<Grade, Date> {
    return {
        1: scheduleSm2Card(card, 1, new Date(), options).card.due,
        2: scheduleSm2Card(card, 2, new Date(), options).card.due,
        3: scheduleSm2Card(card, 3, new Date(), options).card.due,
        4: scheduleSm2Card(card, 4, new Date(), options).card.due,
    };
}

export function formatReviewInterval(dueDate: Date): string {
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);
    const diffHrs = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    if (diffMin < 1) return "< 1m";
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHrs < 24) return `${diffHrs}h`;
    if (diffDays < 30) return `${diffDays}d`;
    return `${Math.round(diffDays / 30)}mo`;
}

function sm2QualityFromGrade(grade: 1 | 2 | 3 | 4) {
    switch (grade) {
        case 4:
            return 5;
        case 3:
            return 4;
        case 2:
            return 3;
        case 1:
            return 1;
    }
}

function getSm2EaseFactor(card: Card) {
    const sm2Card = card as Card & Sm2CardFields & { ef?: number };
    const value = Number(sm2Card.sm2EaseFactor ?? sm2Card.ef ?? card.difficulty);
    return Number.isFinite(value) && value >= SM2_MIN_EASE_FACTOR ? value : SM2_DEFAULT_EASE_FACTOR;
}

function getSm2IntervalDays(card: Card) {
    const sm2Card = card as Card & Sm2CardFields & { interval?: number };
    const value = Number(sm2Card.sm2IntervalDays ?? sm2Card.interval ?? card.scheduled_days);
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 1;
}

function getSm2IntervalMinutes(card: Card) {
    const sm2Card = card as Card & Sm2CardFields;
    const value = Number(sm2Card.sm2IntervalMinutes);
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
}

function getElapsedReviewDays(lastReview: Card["last_review"], reviewedAt: Date) {
    if (!lastReview) return 0;
    const lastReviewDate = new Date(lastReview);
    if (Number.isNaN(lastReviewDate.getTime())) return 0;
    return Math.max(
        0,
        Math.floor((reviewedAt.getTime() - lastReviewDate.getTime()) / REVIEW_DAY_MS),
    );
}
