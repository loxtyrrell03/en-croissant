import type { DrawShape } from "@lichess-org/chessground/draw";
import type { SetStateAction } from "react";
import { type Card, createEmptyCard, fsrs, type Grade, generatorParameters } from "ts-fsrs";
import { z } from "zod";
import type { RepertoireGap } from "@/bindings";
import type { PracticeData } from "@/state/atoms";
import type { Annotation } from "@/utils/annotation";
import { isPrefix } from "@/utils/misc";
import { type TreeNode, treeIterator } from "@/utils/treeReducer";

const params = generatorParameters({ enable_fuzz: true });

const f = fsrs(params);

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
    openingHealth: z
        .object({
            mode: z.enum(["self", "opponent"]).optional(),
            sideToMove: z.enum(["white", "black"]).optional(),
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
            severity: z.enum(["best", "good", "okay", "inaccuracy", "mistake", "blunder"]).optional(),
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
            gameId: z.number().optional(),
            lastGameId: z.number().optional(),
            ply: z.number().optional(),
            moveNumber: z.number().optional(),
            gameIds: z.array(z.number()).optional(),
            occurrenceCount: z.number().optional(),
            date: z.string().nullable().optional(),
            opponent: z.string().optional(),
            timeControl: z.string().nullable().optional(),
            whiteName: z.string().optional(),
            blackName: z.string().optional(),
            whiteElo: z.number().nullable().optional(),
            blackElo: z.number().nullable().optional(),
            gameResult: z.string().nullable().optional(),
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
    openingHealth?: {
        mode?: "self" | "opponent";
        sideToMove?: "white" | "black";
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
        timeControls?: ("bullet" | "blitz" | "rapid" | "classical" | "correspondence" | "unknown")[];
        dateRange?: "all" | "week" | "2weeks" | "month" | "3months" | "6months" | "year";
        engineName?: string;
        enginePath?: string;
        gameId?: number;
        lastGameId?: number;
        ply?: number;
        moveNumber?: number;
        gameIds?: number[];
        occurrenceCount?: number;
        date?: string | null;
        opponent?: string;
        timeControl?: string | null;
        whiteName?: string;
        blackName?: string;
        whiteElo?: number | null;
        blackElo?: number | null;
        gameResult?: string | null;
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
            return "Repertoire gap";
        case "preparedUnderperforming":
            return "Prepared but underperforming";
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
        openingHealth: options?.openingHealth,
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
) {
    const schedulingCards = f.repeat(card, new Date());

    const { card: newCard, log } = schedulingCards[grade];

    setPositions((data) => {
        data.positions[i].card = newCard;
        data.logs.push({ ...log, fen: data.positions[i].fen });
        return {
            positions: data.positions,
            logs: data.logs,
        };
    });
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

export function getNextReviewTimes(card: Card): Record<Grade, Date> {
    const schedulingCards = f.repeat(card, new Date());
    return {
        1: schedulingCards[1].card.due,
        2: schedulingCards[2].card.due,
        3: schedulingCards[3].card.due,
        4: schedulingCards[4].card.due,
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
