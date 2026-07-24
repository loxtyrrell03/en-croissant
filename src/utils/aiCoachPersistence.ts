import { z } from "zod";
import { commands, type AiCoachResponse } from "@/bindings";
import type { Tab } from "@/utils/tabs";

export const AI_COACH_SIDECAR_SUFFIX = ".coach.json";
export const AI_COACH_SIDECAR_VERSION = 1 as const;

export type AiCoachPlayerColor = "white" | "black";
export type AiCoachReviewScope = "current_line" | "whole_game";

export type AiCoachPersistenceTarget = {
    sidecarPath: string;
    recordKey: string;
    sourceKind: "pgn" | "database";
};

export type AiCoachPersistenceContext = {
    gameFingerprint: string;
    currentFen: string;
    currentPath: number[];
    currentLineFingerprint: string;
};

const stringArraySchema = z.array(z.string());
const coachEngineLineSchema = z.object({
    multipv: z.number(),
    depth: z.number(),
    eval: z.string(),
    uciMoves: stringArraySchema,
    sanMoves: stringArraySchema,
});
const coachTargetedResultSchema = z.object({
    requestType: z.string(),
    reason: z.string(),
    fen: z.string(),
    moves: stringArraySchema,
    label: z.string(),
    lines: z.array(coachEngineLineSchema),
});
const coachBookLineMoveSchema = z.object({
    moveIndex: z.number().int().nonnegative(),
    ply: z.number().int().nonnegative(),
    san: z.string(),
    uci: z.string(),
    fenBefore: z.string(),
    fenAfter: z.string(),
    sourcePdfPage: z.number().int().positive(),
    sourcePrintedPage: z.number().int().positive().nullable(),
    sourceChunkId: z.string().nullable(),
    confidence: z.number(),
});
const coachBookLineSchema = z.object({
    lineId: z.string(),
    lineKind: z.string(),
    pgn: z.string(),
    citation: z.string(),
    matchedGamePly: z.number().int().nonnegative(),
    matchedBookMoveIndex: z.number().int().nonnegative(),
    matchedBookPly: z.number().int().nonnegative(),
    playedSan: z.string(),
    playedUci: z.string(),
    bookMoveSan: z.string(),
    bookMoveUci: z.string(),
    playedMoveMatched: z.boolean(),
    sharedPlies: z.number().int().nonnegative(),
    moves: z.array(coachBookLineMoveSchema),
});
const coachBookPassageSchema = z.object({
    chunkId: z.string(),
    bookId: z.string(),
    title: z.string(),
    author: z.string(),
    shelf: z.string(),
    chapterTitle: z.string(),
    citation: z.string(),
    pdfPageStart: z.number(),
    pdfPageEnd: z.number(),
    printedPageStart: z.number().nullable(),
    printedPageEnd: z.number().nullable(),
    excerpt: z.string(),
    localPath: z.string(),
    openingLines: z.array(coachBookLineSchema),
});
const coachCategoryPositionSchema = z.object({
    ply: z.number().int().nonnegative(),
    san: z.string(),
    title: z.string(),
    explanation: z.string(),
    engineEvidence: z.string(),
    betterPlan: z.string(),
});
const coachCategoryReferenceSchema = z.object({
    chunkId: z.string(),
    whyItMatters: z.string(),
    positionPly: z.number().int().nonnegative().nullable(),
});
const coachCategorySchema = z.object({
    id: z.string(),
    label: z.string(),
    summary: z.string(),
    explanation: z.string(),
    positions: z.array(coachCategoryPositionSchema),
    bookReferences: z.array(coachCategoryReferenceSchema),
});
const coachAnalysisCoverageSchema = z.object({
    totalPositions: z.number().int().nonnegative(),
    uniquePositions: z.number().int().nonnegative(),
    cloudHits: z.number().int().nonnegative(),
    liveAnalyses: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    liveDepth: z.number().int().nonnegative(),
    complete: z.boolean().optional(),
});
const coachResponseSchema: z.ZodType<AiCoachResponse> = z.object({
    answer: z.string().min(1),
    overview: z.string(),
    categories: z.array(coachCategorySchema).min(1),
    analysisCoverage: coachAnalysisCoverageSchema.nullable(),
    pgnScope: z.string(),
    model: z.string(),
    usedExistingAnalysis: z.boolean(),
    stockfishLines: z.array(coachEngineLineSchema),
    targetedResults: z.array(coachTargetedResultSchema),
    bookPassages: z.array(coachBookPassageSchema),
    bookCorpusAvailable: z.boolean(),
});

const persistedReviewSchema = z
    .object({
        savedAt: z.string(),
        question: z.string(),
        playerColor: z.enum(["white", "black"]),
        scope: z.enum(["current_line", "whole_game"]),
        gameFingerprint: z.string().min(1),
        base: z.object({
            fen: z.string().min(1),
            path: z.array(z.number().int().nonnegative()),
            halfMoves: z.number().int().nonnegative(),
            sanMoves: stringArraySchema,
            currentLineFingerprint: z.string(),
        }),
        response: coachResponseSchema,
    })
    .superRefine((review, context) => {
        if (review.response.pgnScope !== review.scope) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Saved response scope does not match its persistence context",
            });
        }
    });

const sidecarSchema = z.object({
    version: z.literal(AI_COACH_SIDECAR_VERSION),
    records: z.record(persistedReviewSchema),
});

export type PersistedAiCoachReview = z.infer<typeof persistedReviewSchema>;
export type AiCoachSidecar = z.infer<typeof sidecarSchema>;

function normalizedWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

export function createAiCoachGameFingerprint(rootFen: string, wholeGamePgn: string): string {
    return JSON.stringify([normalizedWhitespace(rootFen), normalizedWhitespace(wholeGamePgn)]);
}

export function createAiCoachPersistenceContext({
    rootFen,
    wholeGamePgn,
    currentFen,
    currentPath,
    currentLinePgn,
}: {
    rootFen: string;
    wholeGamePgn: string;
    currentFen: string;
    currentPath: number[];
    currentLinePgn: string;
}): AiCoachPersistenceContext {
    return {
        gameFingerprint: createAiCoachGameFingerprint(rootFen, wholeGamePgn),
        currentFen: normalizedWhitespace(currentFen),
        currentPath: [...currentPath],
        currentLineFingerprint: normalizedWhitespace(currentLinePgn),
    };
}

export function getAiCoachSidecarPath(sourcePath: string): string {
    return `${sourcePath}${AI_COACH_SIDECAR_SUFFIX}`;
}

export function getAiCoachPersistenceTarget(tab?: Tab | null): AiCoachPersistenceTarget | null {
    if (!tab) return null;
    if (tab.gameOrigin.kind === "file" || tab.gameOrigin.kind === "temp_file") {
        const sourcePath = tab.gameOrigin.file.path.trim();
        if (!sourcePath) return null;
        return {
            sidecarPath: getAiCoachSidecarPath(sourcePath),
            recordKey: `pgn:${tab.gameOrigin.gameNumber}`,
            sourceKind: "pgn",
        };
    }
    if (tab.gameOrigin.kind === "database") {
        const sourcePath = tab.gameOrigin.database.trim();
        if (!sourcePath) return null;
        return {
            sidecarPath: getAiCoachSidecarPath(sourcePath),
            recordKey: `database:${tab.gameOrigin.gameId}`,
            sourceKind: "database",
        };
    }
    return null;
}

export function parseAiCoachSidecar(raw: string): AiCoachSidecar | null {
    try {
        const candidate = JSON.parse(raw) as {
            records?: Record<
                string,
                {
                    response?: {
                        bookPassages?: Array<{
                            openingLines?: Array<{ sharedPlies?: unknown }>;
                        }>;
                    };
                }
            >;
        };
        for (const record of Object.values(candidate.records ?? {})) {
            for (const passage of record.response?.bookPassages ?? []) {
                if (!Array.isArray(passage.openingLines)) passage.openingLines = [];
                for (const line of passage.openingLines) {
                    if (
                        typeof line.sharedPlies !== "number" ||
                        !Number.isFinite(line.sharedPlies)
                    ) {
                        line.sharedPlies = 0;
                    }
                }
            }
        }
        return sidecarSchema.parse(candidate);
    } catch {
        return null;
    }
}

export function createPersistedAiCoachReview({
    savedAt = new Date().toISOString(),
    question,
    playerColor,
    response,
    context,
    baseHalfMoves,
    baseSanMoves,
}: {
    savedAt?: string;
    question: string;
    playerColor: AiCoachPlayerColor;
    response: AiCoachResponse;
    context: AiCoachPersistenceContext;
    baseHalfMoves: number;
    baseSanMoves: string[];
}): PersistedAiCoachReview {
    if (response.pgnScope !== "whole_game" && response.pgnScope !== "current_line") {
        throw new Error(`AI Coach returned an unsupported PGN scope: ${response.pgnScope}`);
    }
    const scope: AiCoachReviewScope = response.pgnScope;
    return persistedReviewSchema.parse({
        savedAt,
        question: question.trim(),
        playerColor,
        scope,
        gameFingerprint: context.gameFingerprint,
        base: {
            fen: context.currentFen,
            path: context.currentPath,
            halfMoves: baseHalfMoves,
            sanMoves: baseSanMoves,
            currentLineFingerprint: context.currentLineFingerprint,
        },
        response: {
            ...response,
            pgnScope: scope,
        },
    });
}

function samePath(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function persistedAiCoachReviewMatches(
    review: PersistedAiCoachReview,
    context: AiCoachPersistenceContext,
    playerColor?: AiCoachPlayerColor,
): boolean {
    if (review.gameFingerprint !== context.gameFingerprint) return false;
    if (playerColor && review.playerColor !== playerColor) return false;
    if (review.scope === "whole_game") return true;
    return (
        review.base.fen === context.currentFen &&
        samePath(review.base.path, context.currentPath) &&
        review.base.currentLineFingerprint === context.currentLineFingerprint
    );
}

export async function loadPersistedAiCoachReview(
    target: AiCoachPersistenceTarget,
): Promise<PersistedAiCoachReview | null> {
    const result = await commands.readAiCoachSidecar(target.sidecarPath);
    if (result.status === "error") throw new Error(result.error);
    if (!result.data) return null;
    return parseAiCoachSidecar(result.data)?.records[target.recordKey] ?? null;
}

export async function savePersistedAiCoachReview(
    target: AiCoachPersistenceTarget,
    review: PersistedAiCoachReview,
): Promise<void> {
    const result = await commands.upsertAiCoachSidecarRecord(
        target.sidecarPath,
        target.recordKey,
        JSON.stringify(review),
    );
    if (result.status === "error") throw new Error(result.error);
}

export async function removePersistedAiCoachReview(
    target: AiCoachPersistenceTarget,
): Promise<void> {
    const result = await commands.removeAiCoachSidecarRecord(target.sidecarPath, target.recordKey);
    if (result.status === "error") throw new Error(result.error);
}
