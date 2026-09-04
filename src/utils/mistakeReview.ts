import { basename, resolve } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import {
    bishopAttacks,
    isNormal,
    kingAttacks,
    knightAttacks,
    makeSquare,
    opposite,
    parseUci,
    pawnAttacks,
    queenAttacks,
    rookAttacks,
    squareRank,
    type Chess,
    type Color,
    type NormalMove,
    type Piece,
    type Role,
    type Square,
} from "chessops";
import { createEmptyCard, type ReviewLog } from "ts-fsrs";
import { z } from "zod";
import type {
    MistakeReviewScanRequest,
    MistakeReviewScanResult,
    MistakeReviewAnalysisMode,
    MistakeReviewSeverity,
    MistakeReviewSeverityFilter,
    MistakeReviewThresholds,
} from "@/bindings";
import { commands } from "@/bindings";
import { getStats, type Position } from "@/components/files/opening";
import { positionFromFen } from "@/utils/chessops";
import {
    engineSettingsSchema,
    engineSettingsToOptions,
    type EngineSettings,
} from "@/utils/engines";
import {
    classifyMistakeReviewMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import type { TacticalMotifEvidence } from "@/utils/tacticalMotifs/types";
import { isSharedReviewPath } from "@/web/sharedReview";
import { selectDailyReview, type PhoneReviewCard } from "@/web/mistakeReview";

async function pcReviewDeckRequest(body?: MistakeReviewDeck): Promise<MistakeReviewDeck> {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const response = await fetch("http://127.0.0.1:8787/api/mistake-review/deck", {
        method: body ? "POST" : "GET",
        connectTimeout: 10000,
        ...(body
            ? { headers: { "content-type": "application/json" }, body: stringifyReviewDeck(body) }
            : {}),
    });
    if (!response.ok) throw new Error("The PC review collection could not be saved. Please retry.");
    return response.json();
}

export const MISTAKE_REVIEW_EXTENSION = ".mistake-review.json";
export const MISTAKE_REVIEW_VERSION = 1;
export const MISTAKE_REVIEW_SOURCE = "Mistake Review";
const MISTAKE_REVIEW_IMPORTED_BATCH_WINDOW_MS = 5 * 60 * 1000;

export const DEFAULT_MISTAKE_REVIEW_THRESHOLDS: MistakeReviewThresholds = {
    inaccuracy: 50,
    mistake: 100,
    blunder: 200,
};

export const DEFAULT_MISTAKE_REVIEW_SEVERITIES: MistakeReviewSeverityFilter = {
    inaccuracy: true,
    mistake: true,
    blunder: true,
};

export const DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT = {
    enabled: false,
    minMoveSeconds: 20,
};

export type MistakeReviewAttemptLabel =
    | "best"
    | "good"
    | "okay"
    | "inaccuracy"
    | "mistake"
    | "blunder";

export type MistakeReviewGamePeriod =
    | "all"
    | "week"
    | "2weeks"
    | "month"
    | "3months"
    | "6months"
    | "year";

export type MistakeReviewTimeControl =
    | "bullet"
    | "blitz"
    | "rapid"
    | "classical"
    | "correspondence"
    | "unknown";

export type MistakeReviewDateRange =
    | "all"
    | "week"
    | "2weeks"
    | "month"
    | "3months"
    | "6months"
    | "year";

export type MistakeReviewPhase = "opening" | "middlegame" | "endgame";
export type MistakeReviewNature = "tactical" | "positional";
export type MistakeReviewNatureConfidence = "high" | "medium" | "low";
export type MistakeReviewNatureAspect = "allowed" | "missed" | "both";

export type MistakeReviewNatureClassification = {
    nature: MistakeReviewNature;
    confidence: MistakeReviewNatureConfidence;
    reason: string;
    tacticalSignals: string[];
    aspect: MistakeReviewNatureAspect;
    allowedNature: MistakeReviewNature;
    allowedReason: string;
    missedNature: MistakeReviewNature;
    missedReason: string;
};

export type MistakeReviewTimeManagementSettings = {
    enabled: boolean;
    minMoveSeconds: number;
};

export const MISTAKE_REVIEW_PHASES: readonly {
    id: MistakeReviewPhase;
    label: string;
}[] = [
    { id: "opening", label: "Opening" },
    { id: "middlegame", label: "Middlegame" },
    { id: "endgame", label: "Endgame" },
] as const;

export const MISTAKE_REVIEW_NATURES: readonly {
    id: MistakeReviewNature;
    label: string;
    description: string;
}[] = [
    {
        id: "tactical",
        label: "Tactical",
        description:
            "Immediate, evaluation-relevant resources such as mate, material, promotion, or forcing threats, including quiet tactically motivated moves.",
    },
    {
        id: "positional",
        label: "Positional",
        description:
            "Tactically viable choices whose difference is driven mainly by non-immediate factors such as structure, activity, king safety, space, exchanges, or plans.",
    },
] as const;

const MISTAKE_REVIEW_OPENING_MAX_FULLMOVE = 10;
const MISTAKE_REVIEW_ENDGAME_MIN_FULLMOVE = 31;
const MISTAKE_REVIEW_ENDGAME_NON_PAWN_MAX = 6;
const MISTAKE_REVIEW_NATURE_PV_PLIES = 8;
const MISTAKE_REVIEW_NATURE_CLASSIFIER_VERSION = 3;
const MISTAKE_REVIEW_NATURE_CACHE_LIMIT = 5000;
const MISTAKE_REVIEW_NATURE_COUNT_CLASSIFY_LIMIT = 1000;
const mistakeReviewNatureClassificationCache = new Map<string, MistakeReviewNatureClassification>();
const mistakeReviewNatureDisplayCache = new WeakMap<Position, MistakeReviewNatureClassification>();

export type MistakeReviewDailySettings = {
    reviewsPerDay: number;
    newItemsPerDay: number;
    gamePeriod: MistakeReviewGamePeriod;
    minWinProbabilityDrop: number;
    includeInaccuracies: boolean;
    includeMistakes: boolean;
    includeBlunders: boolean;
};

export type MistakeReviewSettings = {
    playerDb: string;
    playerId: number;
    playerName?: string | null;
    enginePath: string;
    engineName?: string | null;
    engineSettings?: EngineSettings;
    analysisMode: MistakeReviewAnalysisMode;
    fastDepth: number;
    deepDepth: number;
    multiPv: number;
    timeControls: MistakeReviewTimeControl[];
    dateRange: MistakeReviewDateRange;
    thresholds: MistakeReviewThresholds;
    includeSeverities: MistakeReviewSeverityFilter;
    minWinProbabilityDrop: number;
    timeManagement: MistakeReviewTimeManagementSettings;
};

export type MistakeReviewAutoUpdateConfig = MistakeReviewSettings & {
    enabled: boolean;
    createdAt?: number;
    updatedAt?: number;
    lastRunAt?: number | null;
    lastUpdatedDatabaseAt?: number | null;
    lastKnownGameCount?: number | null;
    lastAnalyzedGameId?: number | null;
    lastAdded?: number | null;
    lastError?: string | null;
};

const savedReviewPositionsSchema = z.custom<Position[]>((value) => Array.isArray(value), {
    message: "Expected review positions array",
});

const savedReviewLogsSchema = z
    .custom<(ReviewLog & { fen: string })[] | undefined>(
        (value) => value === undefined || Array.isArray(value),
        { message: "Expected review logs array" },
    )
    .transform((value) => value ?? []);

const mistakeReviewThresholdSchema = z.object({
    inaccuracy: z.number().default(DEFAULT_MISTAKE_REVIEW_THRESHOLDS.inaccuracy),
    mistake: z.number().default(DEFAULT_MISTAKE_REVIEW_THRESHOLDS.mistake),
    blunder: z.number().default(DEFAULT_MISTAKE_REVIEW_THRESHOLDS.blunder),
});

const mistakeReviewSeverityFilterSchema = z.object({
    inaccuracy: z.boolean().default(true),
    mistake: z.boolean().default(true),
    blunder: z.boolean().default(true),
});

const mistakeReviewTimeManagementSchema = z.object({
    enabled: z.boolean().default(DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.enabled),
    minMoveSeconds: z.number().default(DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds),
});

const mistakeReviewDailySettingsSchema = z.object({
    reviewsPerDay: z.number().default(40),
    newItemsPerDay: z.number().default(10),
    gamePeriod: z
        .enum(["all", "week", "2weeks", "month", "3months", "6months", "year"])
        .default("all"),
    minWinProbabilityDrop: z.number().default(0),
    includeInaccuracies: z.boolean().default(true),
    includeMistakes: z.boolean().default(true),
    includeBlunders: z.boolean().default(true),
});

const mistakeReviewSettingsSchema = z.object({
    playerDb: z.string(),
    playerId: z.number(),
    playerName: z.string().nullable().optional(),
    enginePath: z.string(),
    engineName: z.string().nullable().optional(),
    engineSettings: engineSettingsSchema.optional(),
    analysisMode: z.enum(["single", "layered"]).default("single"),
    fastDepth: z.number().default(12),
    deepDepth: z.number().default(17),
    multiPv: z.number().default(3),
    timeControls: z
        .enum(["bullet", "blitz", "rapid", "classical", "correspondence", "unknown"])
        .array()
        .default([]),
    dateRange: z
        .enum(["all", "week", "2weeks", "month", "3months", "6months", "year"])
        .default("all"),
    thresholds: mistakeReviewThresholdSchema.default(DEFAULT_MISTAKE_REVIEW_THRESHOLDS),
    includeSeverities: mistakeReviewSeverityFilterSchema.default(DEFAULT_MISTAKE_REVIEW_SEVERITIES),
    minWinProbabilityDrop: z.number().default(5),
    timeManagement: mistakeReviewTimeManagementSchema.default(
        DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
    ),
});

const mistakeReviewAutoUpdateConfigSchema = mistakeReviewSettingsSchema.extend({
    enabled: z.boolean().default(false),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    lastRunAt: z.number().nullable().optional(),
    lastUpdatedDatabaseAt: z.number().nullable().optional(),
    lastKnownGameCount: z.number().nullable().optional(),
    lastAnalyzedGameId: z.number().nullable().optional(),
    lastAdded: z.number().nullable().optional(),
    lastError: z.string().nullable().optional(),
});

const mistakeReviewDeckSchema = z.object({
    version: z.literal(MISTAKE_REVIEW_VERSION).optional(),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastAddedAt: z.number().nullable().optional(),
    lastAddedCount: z.number().nullable().optional(),
    source: z.string().optional(),
    settings: mistakeReviewSettingsSchema,
    daily: mistakeReviewDailySettingsSchema.default({
        reviewsPerDay: 40,
        newItemsPerDay: 10,
        gamePeriod: "all",
        minWinProbabilityDrop: 0,
        includeInaccuracies: true,
        includeMistakes: true,
        includeBlunders: true,
    }),
    autoUpdate: mistakeReviewAutoUpdateConfigSchema.optional(),
    positions: savedReviewPositionsSchema,
    logs: savedReviewLogsSchema,
});

export type MistakeReviewDeck = {
    version: typeof MISTAKE_REVIEW_VERSION;
    name: string;
    createdAt: number;
    updatedAt: number;
    lastAddedAt?: number | null;
    lastAddedCount?: number | null;
    source?: string;
    settings: MistakeReviewSettings;
    daily: MistakeReviewDailySettings;
    autoUpdate?: MistakeReviewAutoUpdateConfig;
    positions: Position[];
    logs: (ReviewLog & { fen: string })[];
};

export type MistakeReviewDeckSummary = {
    path: string;
    name: string;
    updatedAt: number;
    lastAddedAt?: number | null;
    lastAddedCount?: number | null;
    total: number;
    due: number;
    unseen: number;
    playerName?: string | null;
    engineName?: string | null;
    autoUpdate?: MistakeReviewAutoUpdateConfig;
};

type CachedMistakeReviewDeckSummary = MistakeReviewDeckSummary & {
    cacheVersion: 1;
    lastModified: number | null;
};

const MISTAKE_REVIEW_SUMMARY_CACHE_PREFIX = "mistake-review-summary-v1:";
const LARGE_REVIEW_DECK_COMPACT_THRESHOLD = 500;

async function getReviewDeckLastModified(path: string) {
    try {
        const result = await commands.getFileMetadata(path);
        return result.status === "ok" ? result.data.last_modified : null;
    } catch {
        return null;
    }
}

function getMistakeReviewSummaryCacheKey(path: string) {
    return `${MISTAKE_REVIEW_SUMMARY_CACHE_PREFIX}${path}`;
}

function readCachedMistakeReviewSummary(path: string, lastModified: number | null) {
    if (typeof localStorage === "undefined") return null;

    try {
        const raw = localStorage.getItem(getMistakeReviewSummaryCacheKey(path));
        if (!raw) return null;
        const cached = JSON.parse(raw) as CachedMistakeReviewDeckSummary;
        if (cached.cacheVersion !== 1 || cached.lastModified !== lastModified) return null;
        const { cacheVersion: _cacheVersion, lastModified: _lastModified, ...summary } = cached;
        return summary;
    } catch {
        return null;
    }
}

async function writeCachedMistakeReviewSummary(path: string, summary: MistakeReviewDeckSummary) {
    if (typeof localStorage === "undefined") return;

    const cached: CachedMistakeReviewDeckSummary = {
        ...summary,
        cacheVersion: 1,
        lastModified: await getReviewDeckLastModified(path),
    };

    try {
        localStorage.setItem(getMistakeReviewSummaryCacheKey(path), JSON.stringify(cached));
    } catch {
        // Summary caching is an optimization only.
    }
}

function getMistakeReviewDeckSummary(
    path: string,
    deck: MistakeReviewDeck,
): MistakeReviewDeckSummary {
    const stats = getStats(deck.positions);
    const lastAdded = getMistakeReviewLastAdded(deck);
    return {
        path,
        name: deck.name,
        updatedAt: deck.updatedAt,
        lastAddedAt: lastAdded?.at ?? null,
        lastAddedCount: lastAdded?.count ?? null,
        total: stats.total,
        due: stats.due,
        unseen: stats.unseen,
        playerName: deck.settings.playerName,
        engineName: deck.settings.engineName,
        autoUpdate: deck.autoUpdate,
    };
}

function stringifyReviewDeck(deck: { positions: unknown[] }) {
    return deck.positions.length >= LARGE_REVIEW_DECK_COMPACT_THRESHOLD
        ? `${JSON.stringify(deck)}\n`
        : `${JSON.stringify(deck, null, 2)}\n`;
}

export type MistakeReviewDailyProgress = {
    dateKey: string;
    target: number;
    completed: number;
    completedNew: number;
    remaining: number;
    newRemaining: number;
};

export type MistakeReviewPhaseCounts = Record<
    MistakeReviewPhase,
    {
        total: number;
        due: number;
    }
>;

export type MistakeReviewNatureCounts = Record<
    MistakeReviewNature,
    {
        total: number;
        due: number;
    }
>;

export type MistakeReviewMotifCounts = Record<
    string,
    {
        total: number;
        due: number;
    }
>;

export type MistakeReviewTimeManagementSummary = {
    readyCount: number;
    clockDataCount: number;
};

export async function readMistakeReviewDeck(path: string): Promise<MistakeReviewDeck> {
    const raw = await readTextFile(path);
    if (isSharedReviewPath(path) && JSON.parse(raw).source === "pc-online-review-v1") {
        try {
            return await pcReviewDeckRequest();
        } catch {
            /* Saved file remains readable offline. */
        }
    }
    const parsed = mistakeReviewDeckSchema.parse(JSON.parse(raw));
    return {
        version: MISTAKE_REVIEW_VERSION,
        ...parsed,
        positions: parsed.positions as unknown as Position[],
        logs: parsed.logs as unknown as MistakeReviewDeck["logs"],
    };
}

export async function writeMistakeReviewDeck(path: string, deck: MistakeReviewDeck) {
    if (isSharedReviewPath(path) && deck.source === "pc-online-review-v1") {
        const saved = await pcReviewDeckRequest(deck);
        await writeCachedMistakeReviewSummary(path, getMistakeReviewDeckSummary(path, saved));
        return saved;
    }
    const updatedDeck: MistakeReviewDeck = {
        ...deck,
        version: MISTAKE_REVIEW_VERSION,
        updatedAt: Date.now(),
    };
    await writeTextFile(path, stringifyReviewDeck(updatedDeck));
    await writeCachedMistakeReviewSummary(path, getMistakeReviewDeckSummary(path, updatedDeck));
    return updatedDeck;
}

export function needsMistakeReviewDeckNatureMigration(deck: MistakeReviewDeck) {
    return deck.positions.some(shouldMigrateMistakeReviewNatureClassification);
}

export async function migrateMistakeReviewDeckNatureClassifications(
    deck: MistakeReviewDeck,
    options: { chunkSize?: number } = {},
) {
    const chunkSize = Math.max(1, Math.trunc(options.chunkSize ?? 8));
    let positions = deck.positions;
    let updatedCount = 0;

    for (let index = 0; index < deck.positions.length; index += 1) {
        const position = deck.positions[index];
        if (!shouldMigrateMistakeReviewNatureClassification(position)) continue;

        const classification = classifyMistakeReviewNature(position);
        if (positions === deck.positions) positions = [...deck.positions];
        positions[index] = applyMistakeReviewNatureClassification(position, classification);
        updatedCount += 1;

        if (updatedCount % chunkSize === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return {
        deck: updatedCount > 0 ? { ...deck, positions } : deck,
        updatedCount,
    };
}

export function needsMistakeReviewDeckMotifMigration(deck: MistakeReviewDeck) {
    return deck.positions.some(shouldMigrateMistakeReviewMotifClassification);
}

export async function migrateMistakeReviewDeckMotifClassifications(
    deck: MistakeReviewDeck,
    options: { chunkSize?: number } = {},
) {
    const chunkSize = Math.max(1, Math.trunc(options.chunkSize ?? 2));
    let positions = deck.positions;
    let updatedCount = 0;

    for (let index = 0; index < deck.positions.length; index += 1) {
        const position = deck.positions[index];
        if (!shouldMigrateMistakeReviewMotifClassification(position)) continue;

        const classification = classifyMistakeReviewMotifs(getMistakeReviewMotifInput(position));
        if (positions === deck.positions) positions = [...deck.positions];
        positions[index] = applyMistakeReviewMotifClassification(position, classification);
        updatedCount += 1;

        if (updatedCount % chunkSize === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return {
        deck: updatedCount > 0 ? { ...deck, positions } : deck,
        updatedCount,
    };
}

export async function deleteMistakeReviewDeck(path: string) {
    await remove(path);
}

export async function listMistakeReviewDecks(
    directory: string,
): Promise<MistakeReviewDeckSummary[]> {
    const entries = await readDir(directory).catch(() => []);
    const decks: MistakeReviewDeckSummary[] = [];

    const summaries = await Promise.all(
        entries.map(async (entry) => {
            if (!entry.isFile || !entry.name.endsWith(MISTAKE_REVIEW_EXTENSION)) return null;

            const path = await resolve(directory, entry.name);
            try {
                const lastModified = await getReviewDeckLastModified(path);
                const cached = readCachedMistakeReviewSummary(path, lastModified);
                if (cached) {
                    return cached;
                }

                const deck = await readMistakeReviewDeck(path);
                const summary = getMistakeReviewDeckSummary(path, deck);
                await writeCachedMistakeReviewSummary(path, summary);
                return summary;
            } catch {
                // Ignore malformed mistake decks so one broken file does not hide the rest.
                return null;
            }
        }),
    );

    for (const summary of summaries) {
        if (summary) decks.push(summary);
    }

    return decks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAvailableMistakeReviewDeckPath(directory: string, name: string) {
    const safeName = sanitizeMistakeReviewFileName(name || "Mistake Review");
    let path = await resolve(directory, `${safeName}${MISTAKE_REVIEW_EXTENSION}`);
    let index = 2;

    while (await exists(path)) {
        path = await resolve(directory, `${safeName} ${index}${MISTAKE_REVIEW_EXTENSION}`);
        index += 1;
    }

    return path;
}

export async function getMistakeReviewDisplayName(path: string) {
    const fileName = await basename(path);
    return fileName.replace(MISTAKE_REVIEW_EXTENSION, "");
}

export function createMistakeReviewDeck({
    name,
    settings,
    autoUpdate,
    daily,
    positions,
}: {
    name: string;
    settings: MistakeReviewSettings;
    autoUpdate?: MistakeReviewAutoUpdateConfig;
    daily?: Partial<MistakeReviewDailySettings>;
    positions: Position[];
}): MistakeReviewDeck {
    const now = Date.now();
    const lastAddedCount = positions.length;
    return {
        version: MISTAKE_REVIEW_VERSION,
        name,
        createdAt: now,
        updatedAt: now,
        lastAddedAt: lastAddedCount > 0 ? now : null,
        lastAddedCount: lastAddedCount > 0 ? lastAddedCount : null,
        source: MISTAKE_REVIEW_SOURCE,
        settings,
        autoUpdate,
        daily: {
            reviewsPerDay: 40,
            newItemsPerDay: 10,
            gamePeriod: "all",
            minWinProbabilityDrop: 0,
            includeInaccuracies: true,
            includeMistakes: true,
            includeBlunders: true,
            ...daily,
        },
        positions,
        logs: [],
    };
}

export function mistakeReviewRequestFromSettings(
    settings: MistakeReviewSettings,
    options?: { requestId?: string; sinceGameId?: number | null; maxGames?: number | null },
): MistakeReviewScanRequest {
    const dateBounds = getMistakeReviewScanDateBounds(settings.dateRange);
    return {
        requestId: options?.requestId ?? null,
        playerDb: settings.playerDb,
        playerId: settings.playerId,
        playerName: settings.playerName ?? null,
        enginePath: settings.enginePath,
        engineName: settings.engineName ?? null,
        engineOptions: engineSettingsToOptions(settings.engineSettings),
        fastDepth: settings.fastDepth,
        deepDepth: settings.deepDepth,
        analysisMode: settings.analysisMode,
        multiPv: settings.multiPv,
        timeControls: settings.timeControls,
        startDate: dateBounds.startDate,
        endDate: dateBounds.endDate,
        thresholds: settings.thresholds,
        includeSeverities: settings.includeSeverities,
        minWinProbabilityDrop: settings.minWinProbabilityDrop,
        timeManagement: settings.timeManagement,
        sinceGameId: options?.sinceGameId ?? null,
        maxGames: options?.maxGames ?? null,
    };
}

export function createMistakeReviewPosition(
    result: MistakeReviewScanResult,
    settings: MistakeReviewSettings,
): Position {
    const severityLabel = mistakeReviewSeverityLabel(result.severity);
    const natureClassification = classifyMistakeReviewNature(result);
    const motifClassification = classifyMistakeReviewMotifs(result);
    const natureLabel = mistakeReviewNatureLabel(natureClassification.nature);
    const dateText = result.date ? ` on ${result.date}` : "";
    const occurrenceText =
        result.occurrenceCount > 1 ? `${result.occurrenceCount} occurrences` : "1 occurrence";
    const moveTimeText = formatMistakeReviewMoveTime(result.moveTimeSeconds);
    const isLongThinkCard =
        settings.timeManagement.enabled &&
        !isMistakeReviewCorrespondenceTimeControl(result.timeControl) &&
        typeof result.moveTimeSeconds === "number" &&
        result.moveTimeSeconds >= settings.timeManagement.minMoveSeconds;

    return {
        fen: result.fen,
        answer: result.bestMoveSan,
        answerUci: result.bestMoveUci || undefined,
        card: createEmptyCard(),
        sideToMove: result.sideToMove === "black" ? "black" : "white",
        moveSequence: result.moveSequence || undefined,
        tags: isLongThinkCard
            ? [severityLabel, natureLabel, "Long think", MISTAKE_REVIEW_SOURCE]
            : [severityLabel, natureLabel, MISTAKE_REVIEW_SOURCE],
        source: MISTAKE_REVIEW_SOURCE,
        reviewKey: result.reviewKey,
        priority:
            getMistakeReviewSeverityWeight(result.severity) * 100_000 +
            result.cpLoss +
            Math.round(result.moveTimeSeconds ?? 0),
        reason: isLongThinkCard
            ? `Long-think ${severityLabel.toLowerCase()}: ${result.playedMoveSan} lost ${Math.round(
                  result.cpLoss,
              )} cp after ${moveTimeText}.`
            : `${severityLabel}: ${result.playedMoveSan} lost ${Math.round(result.cpLoss)} cp.`,
        evidence: `${moveTimeText ? `Spent ${moveTimeText}; ` : ""}${occurrenceText}; latest against ${
            result.opponent || "Unknown"
        }${dateText}. ${natureLabel}, ${natureClassification.confidence} confidence: ${
            natureClassification.reason
        }`,
        importedAt: Date.now(),
        mistakeReview: {
            playerDb: settings.playerDb,
            playerId: settings.playerId,
            playerName: settings.playerName,
            playerColor: result.playerColor === "black" ? "black" : "white",
            playedMoveSan: result.playedMoveSan,
            playedMoveUci: result.playedMoveUci,
            bestMoveSan: result.bestMoveSan,
            bestMoveUci: result.bestMoveUci,
            pvSan: result.pvSan,
            pvUci: result.pvUci,
            refutationSan: result.refutationSan,
            refutationUci: result.refutationUci,
            severity: result.severity,
            cpLoss: result.cpLoss,
            winProbabilityDrop: result.winProbabilityDrop,
            cpBefore: result.cpBefore,
            cpAfter: result.cpAfter,
            requestedDepth: result.requestedDepth,
            reachedDepth: result.reachedDepth,
            analysisMode: result.analysisMode,
            fastDepth: result.fastDepth,
            multiPv: result.multiPv,
            timeControls: settings.timeControls,
            dateRange: settings.dateRange,
            engineName: result.engineName,
            enginePath: settings.enginePath,
            engineSettings: settings.engineSettings,
            phase: classifyMistakeReviewPhaseFromFen(result.fen),
            nature: natureClassification.nature,
            natureConfidence: natureClassification.confidence,
            natureReason: natureClassification.reason,
            tacticalSignals: natureClassification.tacticalSignals,
            natureAspect: natureClassification.aspect,
            allowedNature: natureClassification.allowedNature,
            allowedNatureReason: natureClassification.allowedReason,
            missedNature: natureClassification.missedNature,
            missedNatureReason: natureClassification.missedReason,
            natureClassifierVersion: MISTAKE_REVIEW_NATURE_CLASSIFIER_VERSION,
            allowedMotifs: motifClassification.allowedMotifs,
            missedMotifs: motifClassification.missedMotifs,
            motifClassifierVersion: motifClassification.motifClassifierVersion,
            gameId: result.gameId,
            lastGameId: result.lastGameId,
            ply: result.ply,
            moveNumber: result.moveNumber,
            gameIds: result.gameIds,
            occurrenceCount: result.occurrenceCount,
            date: result.date,
            time: result.time,
            openingName: result.openingName,
            opponent: result.opponent,
            timeControl: result.timeControl,
            whiteName: result.whiteName,
            blackName: result.blackName,
            whiteElo: result.whiteElo,
            blackElo: result.blackElo,
            gameResult: result.gameResult,
            moveTimeSeconds: result.moveTimeSeconds,
            clockBeforeSeconds: result.clockBeforeSeconds,
            clockAfterSeconds: result.clockAfterSeconds,
            longThinkThresholdSeconds: result.longThinkThresholdSeconds,
            timeManagement: settings.timeManagement,
            thresholds: settings.thresholds,
        },
        engine: {
            source: "local",
            lossCp: result.cpLoss,
            depth: result.reachedDepth,
            bestMoveSan: result.bestMoveSan,
            bestMoveUci: result.bestMoveUci,
        },
    };
}

export function formatMistakeReviewMoveTime(seconds: number | null | undefined) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
    if (seconds < 60) {
        const rounded = seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10;
        return `${rounded}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.round(seconds % 60);
    return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function formatMistakeReviewMoveTimeWords(seconds: number | null | undefined) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
    if (seconds < 60) {
        const rounded = seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10;
        return `${rounded} second${rounded === 1 ? "" : "s"}`;
    }

    const totalSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    const minuteText = `${minutes} minute${minutes === 1 ? "" : "s"}`;
    if (remainingSeconds === 0) return minuteText;
    return `${minuteText} ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
}

export function formatMistakeReviewTimeManagementFeedback(
    mistake: Position["mistakeReview"] | null | undefined,
) {
    const timeText = formatMistakeReviewMoveTimeWords(mistake?.moveTimeSeconds);
    const playedMove = mistake?.playedMoveSan?.trim();
    const severity = mistake?.severity;
    if (!timeText || !playedMove || !severity) return null;

    return `In the game, you spent ${timeText} on this move and played ${playedMove}, which was ${formatMistakeReviewQualityPhrase(
        severity,
    )}.`;
}

export function mergeMistakeReviewPositions(
    existing: MistakeReviewDeck,
    incoming: Position[],
): MistakeReviewDeck {
    const existingByKey = new Map(
        existing.positions.map((position) => [mistakeReviewPositionKey(position), position]),
    );
    const incomingKeys = new Set<string>();
    const merged: Position[] = [];
    let addedCount = 0;

    for (const position of incoming) {
        const key = mistakeReviewPositionKey(position);
        incomingKeys.add(key);
        const previous = existingByKey.get(key);
        if (!previous) addedCount += 1;
        merged.push(previous ? mergeMistakeReviewPosition(previous, position) : position);
    }

    const now = Date.now();
    for (const position of existing.positions) {
        if (!incomingKeys.has(mistakeReviewPositionKey(position))) {
            merged.push(position);
        }
    }

    return {
        ...existing,
        positions: merged,
        updatedAt: now,
        lastAddedAt: addedCount > 0 ? now : existing.lastAddedAt,
        lastAddedCount: addedCount > 0 ? addedCount : existing.lastAddedCount,
    };
}

export function mistakeReviewPositionKey(position: Position) {
    return (
        position.reviewKey ||
        `${normalizeFenKey(position.fen)}|${position.mistakeReview?.playedMoveUci || position.answerUci || position.answer}`
    );
}

export function getMistakeReviewDailyBatch(
    positions: Position[],
    settings: MistakeReviewDailySettings,
    options: { now?: Date; extra?: boolean } = {},
) {
    return getMistakeReviewDailyBatchEntries(positions, settings, options).map(
        (entry) => entry.position,
    );
}

export function getMistakeReviewDailyBatchIndices(
    positions: Position[],
    settings: MistakeReviewDailySettings,
    options: { now?: Date; extra?: boolean } = {},
) {
    return getMistakeReviewDailyBatchEntries(positions, settings, options).map(
        (entry) => entry.index,
    );
}

function getMistakeReviewDailyBatchEntries(
    positions: Position[],
    settings: MistakeReviewDailySettings,
    options: { now?: Date; extra?: boolean } = {},
) {
    const now = options.now ?? new Date();
    if (
        !options.extra &&
        positions.length &&
        positions.every((p) => p.reviewKey?.startsWith("pc:"))
    ) {
        const cards = positions.map(
            (p) =>
                ({
                    id: p.reviewKey!,
                    gameKey: p.reviewKey!.split(":")[1],
                    fen: p.fen,
                    gameDate: p.mistakeReview?.date ?? "",
                    createdAt: p.importedAt ?? now.getTime(),
                    drop: p.mistakeReview?.winProbabilityDrop ?? 0,
                    reviews: p.card.reps,
                    due: new Date(p.card.due).getTime(),
                    lastReviewed: p.card.last_review
                        ? new Date(p.card.last_review).getTime()
                        : undefined,
                }) as PhoneReviewCard,
        );
        return selectDailyReview(cards, now.getTime()).map((c) => {
            const index = positions.findIndex((p) => p.reviewKey === c.id);
            return { position: positions[index], index };
        });
    }
    const progress = getMistakeReviewDailyProgress(positions, settings, { now });
    const target = options.extra ? Number.POSITIVE_INFINITY : progress.remaining;
    if (!options.extra && target <= 0) return [];

    const attemptedTodayKeys = new Set<string>();
    for (const position of positions) {
        if (
            isMistakeReviewDailyEligible(position, settings, now) &&
            wasMistakeReviewAttemptedOnDay(position, now)
        ) {
            attemptedTodayKeys.add(mistakeReviewDailyPositionKey(position));
        }
    }

    const dueByKey = new Map<string, { position: Position; index: number }>();

    positions.forEach((position, index) => {
        if (!isMistakeReviewDailyEligible(position, settings, now)) return;
        const key = mistakeReviewDailyPositionKey(position);
        if (attemptedTodayKeys.has(key) || wasMistakeReviewAttemptedOnDay(position, now)) return;
        if (position.card.reps <= 0 || new Date(position.card.due) > now) return;

        const entry = { position, index };
        const previous = dueByKey.get(key);
        if (!previous || sortMistakeReviewDueCards(position, previous.position) < 0) {
            dueByKey.set(key, entry);
        }
    });

    const dueSeen = new Set([...attemptedTodayKeys, ...dueByKey.keys()]);
    const due: { position: Position; index: number }[] = [];
    const dueLimit = options.extra ? Number.POSITIVE_INFINITY : target;
    for (const entry of dueByKey.values()) {
        addSortedMistakeReviewDailyEntry(
            due,
            entry,
            (left, right) => sortMistakeReviewDueCards(left.position, right.position),
            dueLimit,
        );
    }

    const freshSeen = new Set(attemptedTodayKeys);
    const freshByKey = new Map<string, { position: Position; index: number }>();

    positions.forEach((position, index) => {
        if (!isMistakeReviewDailyEligible(position, settings, now)) return;
        const key = mistakeReviewDailyPositionKey(position);
        if (
            dueSeen.has(key) ||
            freshSeen.has(key) ||
            wasMistakeReviewAttemptedOnDay(position, now) ||
            position.card.reps !== 0
        ) {
            return;
        }

        freshSeen.add(key);
        const entry = { position, index };
        const previous = freshByKey.get(key);
        if (!previous || sortMistakeReviewNewCards(position, previous.position) < 0) {
            freshByKey.set(key, entry);
        }
    });

    const fresh: { position: Position; index: number }[] = [];
    const freshLimit = options.extra
        ? Number.POSITIVE_INFINITY
        : Math.min(progress.newRemaining, target);
    for (const entry of freshByKey.values()) {
        addSortedMistakeReviewDailyEntry(
            fresh,
            entry,
            (left, right) => sortMistakeReviewNewCards(left.position, right.position),
            freshLimit,
        );
    }

    if (options.extra) {
        return [...due, ...fresh];
    }

    const selectedDue = due.slice(0, target);
    const remaining = Math.max(0, target - selectedDue.length);
    const selectedNew = fresh.slice(0, Math.min(progress.newRemaining, remaining));
    return [...selectedDue, ...selectedNew];
}

function addSortedMistakeReviewDailyEntry<T>(
    entries: T[],
    entry: T,
    compare: (left: T, right: T) => number,
    limit: number,
) {
    const cappedLimit = Math.max(0, Math.trunc(limit));
    if (cappedLimit <= 0) return;

    if (!Number.isFinite(limit)) {
        entries.push(entry);
        entries.sort(compare);
        return;
    }

    if (entries.length >= cappedLimit && compare(entry, entries[entries.length - 1]!) >= 0) {
        return;
    }

    const insertAt = entries.findIndex((candidate) => compare(entry, candidate) < 0);
    if (insertAt === -1) {
        entries.push(entry);
    } else {
        entries.splice(insertAt, 0, entry);
    }

    if (entries.length > cappedLimit) {
        entries.length = cappedLimit;
    }
}

function mistakeReviewDailyPositionKey(position: Position) {
    return normalizeFenKey(position.fen);
}

export function getMistakeReviewDailyProgress(
    positions: Position[],
    settings: MistakeReviewDailySettings,
    options: { now?: Date; prefiltered?: boolean } = {},
): MistakeReviewDailyProgress {
    const now = options.now ?? new Date();
    const completedKeys = new Set<string>();
    const completedNewKeys = new Set<string>();
    for (const position of positions) {
        if (!wasMistakeReviewAttemptedOnDay(position, now)) continue;
        const key = mistakeReviewDailyPositionKey(position);
        completedKeys.add(key);
        if ((position.mistakeReview?.lastAttemptedCardReps ?? position.card.reps) === 0) {
            completedNewKeys.add(key);
        }
    }
    const completed = completedKeys.size;
    const completedNew = completedNewKeys.size;
    const target = Math.max(0, settings.reviewsPerDay);
    const newTarget = Math.max(0, settings.newItemsPerDay);

    return {
        dateKey: getMistakeReviewLocalDateKey(now),
        target,
        completed,
        completedNew,
        remaining: Math.max(0, target - completed),
        newRemaining: Math.max(0, newTarget - completedNew),
    };
}

export function getMistakeReviewPhaseBatch(
    positions: Position[],
    phaseInput: MistakeReviewPhase,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewPhaseBatchEntries(positions, phaseInput, options).map(
        (entry) => entry.position,
    );
}

export function getMistakeReviewPhaseBatchIndices(
    positions: Position[],
    phaseInput: MistakeReviewPhase,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewPhaseBatchEntries(positions, phaseInput, options).map(
        (entry) => entry.index,
    );
}

function getMistakeReviewPhaseBatchEntries(
    positions: Position[],
    phaseInput: MistakeReviewPhase,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    const phase = normalizeMistakeReviewPhase(phaseInput);
    if (!phase) return [];

    const now = options.now ?? new Date();
    const phasePositions = positions
        .map((position, index) => ({ position, index }))
        .filter(
            (entry) =>
                entry.position.mistakeReview && getMistakeReviewPhase(entry.position) === phase,
        );
    const repsFor = (entry: { position: Position }) =>
        Math.max(0, Math.trunc(Number(entry.position.card.reps) || 0));
    const due = phasePositions
        .filter(
            (entry) => repsFor(entry) > 0 && isMistakeReviewSrsPracticeReady(entry.position, now),
        )
        .sort((a, b) => sortMistakeReviewPhaseDueCards(a.position, b.position));
    const fresh = phasePositions
        .filter(
            (entry) =>
                repsFor(entry) === 0 &&
                isMistakeReviewSrsPracticeReady(entry.position, now, options.includeScheduled),
        )
        .sort((a, b) => sortMistakeReviewNewCards(a.position, b.position));
    const scheduled = phasePositions
        .filter(
            (entry) =>
                options.includeScheduled &&
                repsFor(entry) > 0 &&
                !isMistakeReviewSrsPracticeReady(entry.position, now),
        )
        .sort((a, b) => sortMistakeReviewPhaseScheduledCards(a.position, b.position));

    return [...due, ...fresh, ...scheduled];
}

export function getMistakeReviewTimeManagementBatch(
    positions: Position[],
    options: { minMoveSeconds?: number; now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewTimeManagementBatchEntries(positions, options).map(
        (entry) => entry.position,
    );
}

export function getMistakeReviewTimeManagementBatchIndices(
    positions: Position[],
    options: { minMoveSeconds?: number; now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewTimeManagementBatchEntries(positions, options).map(
        (entry) => entry.index,
    );
}

type MistakeReviewTimeManagementBatchEntry = { position: Position; index: number };

type MistakeReviewTimeManagementBatchGroup = {
    due: MistakeReviewTimeManagementBatchEntry | null;
    fresh: MistakeReviewTimeManagementBatchEntry | null;
    scheduled: MistakeReviewTimeManagementBatchEntry | null;
    attemptedToday: boolean;
    hasScheduledReview: boolean;
};

function getMistakeReviewTimeManagementBatchEntries(
    positions: Position[],
    options: { minMoveSeconds?: number; now?: Date; includeScheduled?: boolean } = {},
) {
    const minMoveSeconds =
        typeof options.minMoveSeconds === "number" && Number.isFinite(options.minMoveSeconds)
            ? Math.max(0, options.minMoveSeconds)
            : DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds;
    const now = options.now ?? new Date();
    const nowTime = now.getTime();
    const groups = new Map<string, MistakeReviewTimeManagementBatchGroup>();

    positions.forEach((position, index) => {
        if (!isMistakeReviewTimeManagementPosition(position, minMoveSeconds)) return;

        const key = normalizeFenKey(position.fen);
        let group = groups.get(key);
        if (!group) {
            group = {
                due: null,
                fresh: null,
                scheduled: null,
                attemptedToday: false,
                hasScheduledReview: false,
            };
            groups.set(key, group);
        }

        const entry = { position, index };
        const reps = Math.max(0, Math.trunc(Number(position.card.reps) || 0));
        const dueAt = new Date(position.card.due).getTime();
        const lastAttemptedAt = getMistakeReviewLastAttemptedAt(position);
        const isDue = reps > 0 && Number.isFinite(dueAt) && dueAt <= nowTime;
        const isFresh = reps === 0 && lastAttemptedAt === null;

        group.attemptedToday ||= wasMistakeReviewAttemptedOnDay(position, now);
        group.hasScheduledReview ||= !isFresh;

        if (isDue) {
            if (
                !group.due ||
                sortMistakeReviewTimeManagementCards(position, group.due.position) < 0
            ) {
                group.due = entry;
            }
        } else if (isFresh) {
            if (
                !group.fresh ||
                sortMistakeReviewTimeManagementCards(position, group.fresh.position) < 0
            ) {
                group.fresh = entry;
            }
        } else if (
            !group.scheduled ||
            sortMistakeReviewScheduledTimeManagementCards(position, group.scheduled.position) < 0
        ) {
            group.scheduled = entry;
        }
    });

    const entries: MistakeReviewTimeManagementBatchEntry[] = [];
    for (const group of groups.values()) {
        if (!options.includeScheduled && group.attemptedToday) continue;

        if (group.due) {
            entries.push(group.due);
        } else if (group.hasScheduledReview) {
            if (options.includeScheduled && group.scheduled) {
                entries.push(group.scheduled);
            }
        } else if (group.fresh) {
            entries.push(group.fresh);
        }
    }

    return entries.sort((a, b) => sortMistakeReviewTimeManagementCards(a.position, b.position));
}

export function getMistakeReviewTimeManagementSummary(
    positions: Position[],
    options: { minMoveSeconds?: number; now?: Date; includeScheduled?: boolean } = {},
): MistakeReviewTimeManagementSummary {
    const readyCount = getMistakeReviewTimeManagementBatchEntries(positions, options).length;
    const clockDataKeys = new Set<string>();

    for (const position of positions) {
        if (isMistakeReviewTimeManagementPosition(position, 0)) {
            clockDataKeys.add(normalizeFenKey(position.fen));
        }
    }

    return { readyCount, clockDataCount: clockDataKeys.size };
}

export function getMistakeReviewNatureBatch(
    positions: Position[],
    natureInput: MistakeReviewNature,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewNatureBatchEntries(positions, natureInput, options).map(
        (entry) => entry.position,
    );
}

export function getMistakeReviewNatureBatchIndices(
    positions: Position[],
    natureInput: MistakeReviewNature,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewNatureBatchEntries(positions, natureInput, options).map(
        (entry) => entry.index,
    );
}

export function getMistakeReviewMotifBatch(
    positions: Position[],
    motifIdInput: string,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewMotifBatchEntries(positions, motifIdInput, options).map(
        (entry) => entry.position,
    );
}

export function getMistakeReviewMotifBatchIndices(
    positions: Position[],
    motifIdInput: string,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    return getMistakeReviewMotifBatchEntries(positions, motifIdInput, options).map(
        (entry) => entry.index,
    );
}

function getMistakeReviewMotifBatchEntries(
    positions: Position[],
    motifIdInput: string,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    const motifId = motifIdInput.trim();
    if (!motifId) return [];

    const now = options.now ?? new Date();
    const motifPositions = positions
        .map((position, index) => ({ position, index }))
        .filter(
            (entry) =>
                entry.position.mistakeReview &&
                getMistakeReviewMotifs(entry.position).some((motif) => motif.id === motifId),
        );
    const repsFor = (entry: { position: Position }) =>
        Math.max(0, Math.trunc(Number(entry.position.card.reps) || 0));
    const due = motifPositions
        .filter(
            (entry) => repsFor(entry) > 0 && isMistakeReviewSrsPracticeReady(entry.position, now),
        )
        .sort((a, b) => sortMistakeReviewPhaseDueCards(a.position, b.position));
    const fresh = motifPositions
        .filter(
            (entry) =>
                repsFor(entry) === 0 &&
                isMistakeReviewSrsPracticeReady(entry.position, now, options.includeScheduled),
        )
        .sort((a, b) => sortMistakeReviewNewCards(a.position, b.position));
    const scheduled = motifPositions
        .filter(
            (entry) =>
                options.includeScheduled &&
                repsFor(entry) > 0 &&
                !isMistakeReviewSrsPracticeReady(entry.position, now),
        )
        .sort((a, b) => sortMistakeReviewPhaseScheduledCards(a.position, b.position));

    return [...due, ...fresh, ...scheduled];
}

function getMistakeReviewNatureBatchEntries(
    positions: Position[],
    natureInput: MistakeReviewNature,
    options: { now?: Date; includeScheduled?: boolean } = {},
) {
    const nature = normalizeMistakeReviewNature(natureInput);
    if (!nature) return [];

    const now = options.now ?? new Date();
    const naturePositions = positions
        .map((position, index) => ({ position, index }))
        .filter(
            (entry) =>
                entry.position.mistakeReview && getMistakeReviewNature(entry.position) === nature,
        );
    const repsFor = (entry: { position: Position }) =>
        Math.max(0, Math.trunc(Number(entry.position.card.reps) || 0));
    const due = naturePositions
        .filter(
            (entry) => repsFor(entry) > 0 && isMistakeReviewSrsPracticeReady(entry.position, now),
        )
        .sort((a, b) => sortMistakeReviewPhaseDueCards(a.position, b.position));
    const fresh = naturePositions
        .filter(
            (entry) =>
                repsFor(entry) === 0 &&
                isMistakeReviewSrsPracticeReady(entry.position, now, options.includeScheduled),
        )
        .sort((a, b) => sortMistakeReviewNewCards(a.position, b.position));
    const scheduled = naturePositions
        .filter(
            (entry) =>
                options.includeScheduled &&
                repsFor(entry) > 0 &&
                !isMistakeReviewSrsPracticeReady(entry.position, now),
        )
        .sort((a, b) => sortMistakeReviewPhaseScheduledCards(a.position, b.position));

    return [...due, ...fresh, ...scheduled];
}

function isMistakeReviewSrsPracticeReady(position: Position, now: Date, includeScheduled = false) {
    if (includeScheduled) return true;

    const dueAt = new Date(position.card.due).getTime();
    if (Number.isFinite(dueAt) && dueAt <= now.getTime()) return true;

    const reps = Math.max(0, Math.trunc(Number(position.card.reps) || 0));
    return reps === 0 && getMistakeReviewLastAttemptedAt(position) === null;
}

export function isMistakeReviewCorrespondenceTimeControl(value: string | null | undefined) {
    const normalized = value?.trim().toLowerCase();
    return (
        normalized === "-" ||
        normalized === "daily" ||
        normalized === "correspondence" ||
        Boolean(normalized?.includes("/"))
    );
}

export function getMistakeReviewPhaseCounts(
    positions: Position[],
    options: { now?: Date } = {},
): MistakeReviewPhaseCounts {
    const now = options.now ?? new Date();
    const counts = Object.fromEntries(
        MISTAKE_REVIEW_PHASES.map((phase) => [phase.id, { total: 0, due: 0 }]),
    ) as MistakeReviewPhaseCounts;

    for (const position of positions) {
        if (!position.mistakeReview) continue;
        const phase = getMistakeReviewPhase(position);
        const row = counts[phase];
        row.total += 1;
        if (position.card.reps > 0 && new Date(position.card.due) <= now) {
            row.due += 1;
        }
    }

    return counts;
}

export function getMistakeReviewNatureCounts(
    positions: Position[],
    options: { now?: Date } = {},
): MistakeReviewNatureCounts {
    const now = options.now ?? new Date();
    const classifyMissingNature = positions.length <= MISTAKE_REVIEW_NATURE_COUNT_CLASSIFY_LIMIT;
    const counts = Object.fromEntries(
        MISTAKE_REVIEW_NATURES.map((nature) => [nature.id, { total: 0, due: 0 }]),
    ) as MistakeReviewNatureCounts;

    for (const position of positions) {
        if (!position.mistakeReview) continue;
        const nature =
            getStoredMistakeReviewNature(position) ??
            (classifyMissingNature ? getMistakeReviewNature(position) : null);
        if (!nature) continue;
        const row = counts[nature];
        row.total += 1;
        if (position.card.reps > 0 && new Date(position.card.due) <= now) {
            row.due += 1;
        }
    }

    return counts;
}

export function getMistakeReviewMotifCounts(
    positions: Position[],
    options: { now?: Date } = {},
): MistakeReviewMotifCounts {
    const now = options.now ?? new Date();
    const counts: MistakeReviewMotifCounts = {};

    for (const position of positions) {
        if (!position.mistakeReview) continue;
        const motifIds = new Set(getMistakeReviewMotifs(position).map((motif) => motif.id));
        for (const motifId of motifIds) {
            const row = (counts[motifId] ??= { total: 0, due: 0 });
            row.total += 1;
            if (position.card.reps > 0 && new Date(position.card.due) <= now) {
                row.due += 1;
            }
        }
    }

    return counts;
}

export function getMistakeReviewAllowedMotifs(position: Position): TacticalMotifEvidence[] {
    return position.mistakeReview?.allowedMotifs ?? [];
}

export function getMistakeReviewMissedMotifs(position: Position): TacticalMotifEvidence[] {
    return position.mistakeReview?.missedMotifs ?? [];
}

export function getMistakeReviewMotifs(position: Position): TacticalMotifEvidence[] {
    return [...getMistakeReviewAllowedMotifs(position), ...getMistakeReviewMissedMotifs(position)];
}

function getStoredMistakeReviewNature(position: Position): MistakeReviewNature | null {
    const metadata = position.mistakeReview;
    return normalizeMistakeReviewNature(
        metadata?.nature ??
            metadata?.mistakeNature ??
            metadata?.category ??
            metadata?.summary?.nature ??
            null,
    );
}

export function getMistakeReviewPhase(position: Position): MistakeReviewPhase {
    const metadata = position.mistakeReview;
    const explicit = normalizeMistakeReviewPhase(
        metadata?.phase ??
            metadata?.gamePhase ??
            metadata?.positionPhase ??
            metadata?.summary?.phase,
    );
    if (explicit) return explicit;
    return classifyMistakeReviewPhaseFromFen(position.fen);
}

export function getMistakeReviewNature(position: Position): MistakeReviewNature {
    return getMistakeReviewNatureDisplayClassification(position).nature;
}

export function getMistakeReviewNatureConfidence(
    position: Position,
): MistakeReviewNatureConfidence {
    return getMistakeReviewNatureDisplayClassification(position).confidence;
}

export function getMistakeReviewNatureReason(position: Position) {
    return getMistakeReviewNatureDisplayClassification(position).reason;
}

export function getMistakeReviewNatureAspect(position: Position): MistakeReviewNatureAspect {
    return getMistakeReviewNatureDisplayClassification(position).aspect;
}

function getMistakeReviewNatureDisplayClassification(position: Position) {
    const cached = mistakeReviewNatureDisplayCache.get(position);
    if (cached) return cached;

    const metadata = position.mistakeReview;
    const explicitNature = normalizeMistakeReviewNature(
        metadata?.nature ??
            metadata?.mistakeNature ??
            metadata?.category ??
            metadata?.summary?.nature ??
            metadata?.summary?.mistakeNature,
    );
    const explicitConfidence = normalizeMistakeReviewNatureConfidence(
        metadata?.natureConfidence ?? metadata?.summary?.natureConfidence,
    );
    const explicitAspect = normalizeMistakeReviewNatureAspect(metadata?.natureAspect);
    let fallback: MistakeReviewNatureClassification | null = null;
    const getFallback = () => {
        fallback ??= classifyMistakeReviewNatureFromText(position);
        return fallback;
    };

    const nature = explicitNature ?? getFallback().nature;
    const allowedNature = normalizeMistakeReviewNature(metadata?.allowedNature);
    const missedNature = normalizeMistakeReviewNature(metadata?.missedNature);
    const aspect =
        explicitAspect ??
        inferMistakeReviewNatureAspect(allowedNature, missedNature, getFallback().aspect, nature);

    const classification: MistakeReviewNatureClassification = {
        nature,
        confidence: explicitConfidence ?? getFallback().confidence,
        reason: metadata?.natureReason ?? getFallback().reason,
        tacticalSignals: metadata?.tacticalSignals ?? getFallback().tacticalSignals,
        aspect,
        allowedNature: allowedNature ?? getFallback().allowedNature,
        allowedReason: metadata?.allowedNatureReason ?? getFallback().allowedReason,
        missedNature: missedNature ?? getFallback().missedNature,
        missedReason: metadata?.missedNatureReason ?? getFallback().missedReason,
    };

    mistakeReviewNatureDisplayCache.set(position, classification);
    return classification;
}

function shouldMigrateMistakeReviewNatureClassification(position: Position) {
    const metadata = position.mistakeReview;
    return Boolean(
        metadata && metadata.natureClassifierVersion !== MISTAKE_REVIEW_NATURE_CLASSIFIER_VERSION,
    );
}

function shouldMigrateMistakeReviewMotifClassification(position: Position) {
    const metadata = position.mistakeReview;
    return Boolean(
        metadata && metadata.motifClassifierVersion !== MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    );
}

function getMistakeReviewMotifInput(position: Position) {
    const metadata = position.mistakeReview;
    return {
        fen: position.fen,
        bestMoveSan: metadata?.bestMoveSan ?? position.answer,
        bestMoveUci: metadata?.bestMoveUci ?? position.answerUci,
        playedMoveSan: metadata?.playedMoveSan,
        playedMoveUci: metadata?.playedMoveUci,
        pvSan: metadata?.pvSan,
        pvUci: metadata?.pvUci,
        refutationSan: metadata?.refutationSan,
        refutationUci: metadata?.refutationUci,
        cpLoss: metadata?.cpLoss,
        cpBefore: metadata?.cpBefore,
        cpAfter: metadata?.cpAfter,
        winProbabilityDrop: metadata?.winProbabilityDrop,
        reachedDepth: metadata?.reachedDepth,
    };
}

function applyMistakeReviewMotifClassification(
    position: Position,
    classification: ReturnType<typeof classifyMistakeReviewMotifs>,
): Position {
    if (!position.mistakeReview) return position;

    return {
        ...position,
        mistakeReview: {
            ...position.mistakeReview,
            allowedMotifs: classification.allowedMotifs,
            missedMotifs: classification.missedMotifs,
            motifClassifierVersion: classification.motifClassifierVersion,
        },
    };
}

function applyMistakeReviewNatureClassification(
    position: Position,
    classification: MistakeReviewNatureClassification,
): Position {
    if (!position.mistakeReview) return position;

    return {
        ...position,
        tags: upsertMistakeReviewNatureTag(position.tags, classification.nature),
        evidence: updateMistakeReviewEvidenceNature(position.evidence, classification),
        mistakeReview: {
            ...position.mistakeReview,
            nature: classification.nature,
            natureConfidence: classification.confidence,
            natureReason: classification.reason,
            tacticalSignals: classification.tacticalSignals,
            natureAspect: classification.aspect,
            allowedNature: classification.allowedNature,
            allowedNatureReason: classification.allowedReason,
            missedNature: classification.missedNature,
            missedNatureReason: classification.missedReason,
            natureClassifierVersion: MISTAKE_REVIEW_NATURE_CLASSIFIER_VERSION,
        },
    };
}

function upsertMistakeReviewNatureTag(tags: string[] | undefined, nature: MistakeReviewNature) {
    const label = mistakeReviewNatureLabel(nature);
    const existingTags = tags ?? [];
    const filtered = existingTags.filter((tag) => !normalizeMistakeReviewNature(tag));
    const sourceIndex = filtered.findIndex((tag) => tag === MISTAKE_REVIEW_SOURCE);
    if (sourceIndex < 0) return [...filtered, label];

    return [...filtered.slice(0, sourceIndex), label, ...filtered.slice(sourceIndex)];
}

function updateMistakeReviewEvidenceNature(
    evidence: string | undefined,
    classification: MistakeReviewNatureClassification,
) {
    if (!evidence) return evidence;

    const natureText = `${mistakeReviewNatureLabel(classification.nature)}, ${
        classification.confidence
    } confidence: ${classification.reason}`;
    return evidence.replace(
        /(Tactical|Positional), (high|medium|low) confidence: .*$/i,
        natureText,
    );
}

function classifyMistakeReviewNatureFromText(
    position: Position,
): MistakeReviewNatureClassification {
    const metadata = position.mistakeReview;
    return classifyMistakeReviewNature({
        fen: position.fen,
        bestMoveSan: metadata?.bestMoveSan ?? position.answer,
        bestMoveUci: metadata?.bestMoveUci ?? position.answerUci,
        playedMoveSan: metadata?.playedMoveSan,
        playedMoveUci: metadata?.playedMoveUci,
        pvSan: normalizeMistakeReviewMoveList(metadata?.pvSan),
        pvUci: normalizeMistakeReviewMoveList(metadata?.pvUci),
        refutationSan: normalizeMistakeReviewMoveList(metadata?.refutationSan),
        refutationUci: normalizeMistakeReviewMoveList(metadata?.refutationUci),
        cpLoss: metadata?.cpLoss ?? position.engine?.lossCp,
        winProbabilityDrop: metadata?.winProbabilityDrop,
        reachedDepth: metadata?.reachedDepth,
    });
}

function inferMistakeReviewNatureAspect(
    allowedNature: MistakeReviewNature | null,
    missedNature: MistakeReviewNature | null,
    fallback: MistakeReviewNatureAspect,
    nature: MistakeReviewNature,
) {
    if (allowedNature === "tactical" && missedNature === "tactical") return "both";
    if (allowedNature === "tactical") return "allowed";
    if (missedNature === "tactical") return "missed";
    if (nature === "tactical") return fallback;
    return fallback;
}

function normalizeMistakeReviewMoveList(value?: string[] | null) {
    return (value ?? []).filter(
        (move): move is string => typeof move === "string" && move.trim().length > 0,
    );
}

export function isMistakeReviewTimeManagementPosition(
    position: Position,
    minMoveSeconds = DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds,
) {
    const metadata = position.mistakeReview;
    const moveTime = position.mistakeReview?.moveTimeSeconds;
    if (
        isMistakeReviewCorrespondenceTimeControl(metadata?.timeControl) ||
        metadata?.timeControls?.some(isMistakeReviewCorrespondenceTimeControl)
    ) {
        return false;
    }

    return (
        typeof moveTime === "number" &&
        Number.isFinite(moveTime) &&
        moveTime >= Math.max(0, minMoveSeconds)
    );
}

export function classifyMistakeReviewAttempt(
    cpLoss: number,
    thresholds: MistakeReviewThresholds = DEFAULT_MISTAKE_REVIEW_THRESHOLDS,
    exactBest = false,
): MistakeReviewAttemptLabel {
    if (exactBest || cpLoss <= 20) return "best";
    if (cpLoss < 35) return "good";
    if (cpLoss < 50) return "okay";
    if (cpLoss >= thresholds.blunder) return "blunder";
    if (cpLoss >= thresholds.mistake) return "mistake";
    return "inaccuracy";
}

export function isMistakeReviewPassingLabel(label: MistakeReviewAttemptLabel) {
    return label === "best" || label === "good";
}

export function mistakeReviewSeverityLabel(
    severity: MistakeReviewSeverity | MistakeReviewAttemptLabel,
) {
    switch (severity) {
        case "best":
            return "Best";
        case "good":
            return "Good";
        case "okay":
            return "Okay";
        case "inaccuracy":
            return "Inaccuracy";
        case "mistake":
            return "Mistake";
        case "blunder":
            return "Blunder";
    }
}

export function mistakeReviewNatureLabel(nature: MistakeReviewNature) {
    return nature === "tactical" ? "Tactical" : "Positional";
}

export function mistakeReviewNatureColor(nature: MistakeReviewNature) {
    return nature === "tactical" ? "red" : "indigo";
}

export function mistakeReviewNatureAspectLabel(aspect: MistakeReviewNatureAspect) {
    switch (aspect) {
        case "allowed":
            return "Allowed";
        case "missed":
            return "Missed";
        case "both":
            return "Allowed + missed";
    }
}

export function classifyMistakeReviewNature(
    input:
        | MistakeReviewScanResult
        | Position
        | {
              bestMoveSan?: string | null;
              bestMoveUci?: string | null;
              playedMoveSan?: string | null;
              playedMoveUci?: string | null;
              fen?: string | null;
              pvSan?: string[] | null;
              pvUci?: string[] | null;
              refutationSan?: string[] | null;
              refutationUci?: string[] | null;
              cpLoss?: number | null;
              winProbabilityDrop?: number | null;
              reachedDepth?: number | null;
          },
): MistakeReviewNatureClassification {
    const cacheKey = getMistakeReviewNatureClassificationCacheKey(input);
    const cached = mistakeReviewNatureClassificationCache.get(cacheKey);
    if (cached) return cached;

    const classification = computeMistakeReviewNature(input);
    mistakeReviewNatureClassificationCache.set(cacheKey, classification);
    if (mistakeReviewNatureClassificationCache.size > MISTAKE_REVIEW_NATURE_CACHE_LIMIT) {
        const oldestKey = mistakeReviewNatureClassificationCache.keys().next().value;
        if (oldestKey) mistakeReviewNatureClassificationCache.delete(oldestKey);
    }
    return classification;
}

function computeMistakeReviewNature(
    input:
        | MistakeReviewScanResult
        | Position
        | {
              bestMoveSan?: string | null;
              bestMoveUci?: string | null;
              playedMoveSan?: string | null;
              playedMoveUci?: string | null;
              fen?: string | null;
              pvSan?: string[] | null;
              pvUci?: string[] | null;
              refutationSan?: string[] | null;
              refutationUci?: string[] | null;
              cpLoss?: number | null;
              winProbabilityDrop?: number | null;
              reachedDepth?: number | null;
          },
): MistakeReviewNatureClassification {
    const metadata = "mistakeReview" in input ? input.mistakeReview : undefined;
    const bestMoveSan =
        ("bestMoveSan" in input ? input.bestMoveSan : undefined) ??
        metadata?.bestMoveSan ??
        ("answer" in input ? input.answer : undefined) ??
        "";
    const bestMoveUci =
        ("bestMoveUci" in input ? input.bestMoveUci : undefined) ??
        metadata?.bestMoveUci ??
        ("answerUci" in input ? input.answerUci : undefined) ??
        "";
    const playedMoveSan =
        ("playedMoveSan" in input ? input.playedMoveSan : undefined) ??
        metadata?.playedMoveSan ??
        "";
    const playedMoveUci =
        ("playedMoveUci" in input ? input.playedMoveUci : undefined) ??
        metadata?.playedMoveUci ??
        "";
    const fen = ("fen" in input ? input.fen : undefined) ?? "";
    const pvSan = (("pvSan" in input ? input.pvSan : undefined) ?? metadata?.pvSan ?? []).filter(
        (move): move is string => typeof move === "string" && move.trim().length > 0,
    );
    const pvUci = (("pvUci" in input ? input.pvUci : undefined) ?? metadata?.pvUci ?? []).filter(
        (move): move is string => typeof move === "string" && move.trim().length > 0,
    );
    const refutationSan = (
        ("refutationSan" in input ? input.refutationSan : undefined) ??
        metadata?.refutationSan ??
        []
    ).filter((move): move is string => typeof move === "string" && move.trim().length > 0);
    const refutationUci = (
        ("refutationUci" in input ? input.refutationUci : undefined) ??
        metadata?.refutationUci ??
        []
    ).filter((move): move is string => typeof move === "string" && move.trim().length > 0);
    const cpLoss = ("cpLoss" in input ? input.cpLoss : undefined) ?? metadata?.cpLoss ?? undefined;
    const winProbabilityDrop =
        ("winProbabilityDrop" in input ? input.winProbabilityDrop : undefined) ??
        metadata?.winProbabilityDrop ??
        undefined;
    const reachedDepth =
        ("reachedDepth" in input ? input.reachedDepth : undefined) ??
        metadata?.reachedDepth ??
        undefined;
    const firstPvSan = pvSan[0] ?? "";
    const correctionSan = bestMoveSan || firstPvSan;
    const largeLoss = typeof cpLoss === "number" && cpLoss >= 180;
    const sharpWinDrop = typeof winProbabilityDrop === "number" && winProbabilityDrop >= 12;
    const sharpEvaluationSwing = largeLoss || sharpWinDrop;
    const allowedSignals = getMistakeReviewRefutationTacticalSignals(
        fen,
        playedMoveUci,
        playedMoveSan,
        refutationUci,
        refutationSan,
    );
    const allowedBoardSignals = allowedSignals.length
        ? allowedSignals
        : getMistakeReviewBoardTacticalSignals(fen, playedMoveUci, playedMoveSan);
    const missedSignals = getMistakeReviewMissedTacticalSignals(fen, bestMoveUci, pvUci, pvSan);
    const allowedSanSignal = getMistakeReviewSanLineTacticalSignal(
        refutationSan,
        "opponent refutation",
    );
    const missedSanSignal = getMistakeReviewSanLineTacticalSignal(pvSan, "best line");
    const allAllowedSignals = dedupeMistakeReviewTacticalSignals([
        ...allowedBoardSignals,
        ...(allowedSanSignal ? [allowedSanSignal] : []),
    ]);
    const allMissedSignals = dedupeMistakeReviewTacticalSignals([
        ...missedSignals,
        ...(missedSanSignal ? [missedSanSignal] : []),
    ]);
    const strongestAllowedSignal = getStrongestMistakeReviewTacticalSignal(allAllowedSignals);
    const strongestMissedSignal = getStrongestMistakeReviewTacticalSignal(allMissedSignals);
    const allowedScore = strongestAllowedSignal?.score ?? 0;
    const missedScore = strongestMissedSignal?.score ?? 0;
    const allowedTactical = allowedScore >= 4 || (allowedScore >= 3 && sharpEvaluationSwing);
    const missedTactical = missedScore >= 4 || (missedScore >= 3 && sharpEvaluationSwing);
    const allowedReason =
        strongestAllowedSignal?.reason ??
        "opponent refutation has no verified immediate material, mating, promotion, or forcing-threat outcome";
    const missedReason =
        strongestMissedSignal?.reason ??
        `${correctionSan ? `best move ${correctionSan}` : "best line"} has no verified immediate material, mating, promotion, or forcing-threat outcome`;
    const tacticalSignals = [
        ...allAllowedSignals.map((signal) => `Allowed: ${signal.reason}`),
        ...allMissedSignals.map((signal) => `Missed: ${signal.reason}`),
    ];

    if (allowedTactical || missedTactical) {
        const strongestSignal = getStrongestMistakeReviewTacticalSignal([
            ...allAllowedSignals,
            ...allMissedSignals,
        ]);
        const aspect =
            allowedTactical && missedTactical ? "both" : allowedTactical ? "allowed" : "missed";
        const quietDefensiveCorrection =
            aspect === "allowed" && correctionSan && !isMistakeReviewForcingSan(correctionSan)
                ? ` Quiet best move ${correctionSan} is tactically motivated because it prevents that concrete outcome.`
                : "";
        return {
            nature: "tactical",
            confidence:
                strongestSignal?.confidence ??
                (Math.max(allowedScore, missedScore) >= 6 ? "high" : "medium"),
            reason:
                aspect === "allowed"
                    ? `Allowed tactical resource: ${allowedReason}.${quietDefensiveCorrection}`
                    : aspect === "missed"
                      ? `Missed tactical resource: ${missedReason}`
                      : `Allowed tactical resource: ${allowedReason}. Missed tactical resource: ${missedReason}`,
            tacticalSignals,
            aspect,
            allowedNature: allowedTactical ? "tactical" : "positional",
            allowedReason,
            missedNature: missedTactical ? "tactical" : "positional",
            missedReason,
        };
    }

    const positionalAssessment = getMistakeReviewPositionalAssessment({
        fen,
        playedMoveUci,
        correctionSan,
        pvSan,
        pvUci,
        refutationSan,
        refutationUci,
        reachedDepth,
        strongestTacticalScore: Math.max(allowedScore, missedScore),
        sharpEvaluationSwing,
    });

    return {
        nature: "positional",
        confidence: positionalAssessment.confidence,
        reason: positionalAssessment.reason,
        tacticalSignals,
        aspect: refutationSan.length || refutationUci.length ? "both" : "missed",
        allowedNature: "positional",
        allowedReason,
        missedNature: "positional",
        missedReason,
    };
}

function getMistakeReviewNatureClassificationCacheKey(
    input:
        | MistakeReviewScanResult
        | Position
        | {
              bestMoveSan?: string | null;
              bestMoveUci?: string | null;
              playedMoveSan?: string | null;
              playedMoveUci?: string | null;
              fen?: string | null;
              pvSan?: string[] | null;
              pvUci?: string[] | null;
              refutationSan?: string[] | null;
              refutationUci?: string[] | null;
              cpLoss?: number | null;
              winProbabilityDrop?: number | null;
              reachedDepth?: number | null;
          },
) {
    const metadata = "mistakeReview" in input ? input.mistakeReview : undefined;
    const field = <K extends string>(key: K) =>
        key in input ? (input as Record<K, unknown>)[key] : undefined;
    const list = (value: unknown) => (Array.isArray(value) ? value.join(" ") : "");
    return JSON.stringify([
        MISTAKE_REVIEW_NATURE_CLASSIFIER_VERSION,
        field("fen") ?? "",
        field("bestMoveSan") ?? metadata?.bestMoveSan ?? field("answer") ?? "",
        field("bestMoveUci") ?? metadata?.bestMoveUci ?? field("answerUci") ?? "",
        field("playedMoveSan") ?? metadata?.playedMoveSan ?? "",
        field("playedMoveUci") ?? metadata?.playedMoveUci ?? "",
        list(field("pvSan") ?? metadata?.pvSan),
        list(field("pvUci") ?? metadata?.pvUci),
        list(field("refutationSan") ?? metadata?.refutationSan),
        list(field("refutationUci") ?? metadata?.refutationUci),
        field("cpLoss") ?? metadata?.cpLoss ?? "",
        field("winProbabilityDrop") ?? metadata?.winProbabilityDrop ?? "",
        field("reachedDepth") ?? metadata?.reachedDepth ?? "",
    ]);
}

export function formatMistakeReviewLastSeen(position?: Position | null) {
    const attemptedAt = getMistakeReviewLastAttemptedAt(position);
    if (!attemptedAt) return "Never";

    const elapsedMs = Math.max(0, Date.now() - attemptedAt);
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    if (elapsedMinutes < 1) return "Just now";
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

    const elapsedHours = Math.floor(elapsedMs / 3600000);
    if (elapsedHours < 24) return `${elapsedHours}h ago`;

    const elapsedDays = Math.floor(elapsedMs / 86400000);
    if (elapsedDays < 7) return `${elapsedDays}d ago`;

    const elapsedWeeks = Math.floor(elapsedDays / 7);
    if (elapsedWeeks < 8) return `${elapsedWeeks}w ago`;

    const elapsedMonths = Math.floor(elapsedDays / 30);
    if (elapsedMonths < 12) return `${elapsedMonths}mo ago`;

    const elapsedYears = Math.floor(elapsedDays / 365);
    return `${elapsedYears}y ago`;
}

export function getMistakeReviewSeverityWeight(severity?: string) {
    switch (severity) {
        case "blunder":
            return 3;
        case "mistake":
            return 2;
        case "inaccuracy":
            return 1;
        default:
            return 0;
    }
}

function formatMistakeReviewQualityPhrase(severity: MistakeReviewAttemptLabel) {
    switch (severity) {
        case "best":
            return "best";
        case "good":
            return "good";
        case "okay":
            return "okay";
        case "inaccuracy":
            return "an inaccuracy";
        case "mistake":
            return "a mistake";
        case "blunder":
            return "a blunder";
    }
}

function getMistakeReviewLastAdded(deck: MistakeReviewDeck) {
    const explicitAt = parseMistakeReviewTimestamp(deck.lastAddedAt);
    const explicitCount = parseMistakeReviewAddedCount(deck.lastAddedCount);
    if (explicitAt !== null && explicitCount !== null) {
        return { at: explicitAt, count: explicitCount };
    }

    const autoUpdateAt = parseMistakeReviewTimestamp(
        deck.autoUpdate?.lastRunAt ?? deck.autoUpdate?.updatedAt,
    );
    const autoUpdateCount = parseMistakeReviewAddedCount(deck.autoUpdate?.lastAdded);
    if (autoUpdateAt !== null && autoUpdateCount !== null) {
        return { at: autoUpdateAt, count: autoUpdateCount };
    }

    return inferMistakeReviewLastAddedFromPositions(deck.positions);
}

function inferMistakeReviewLastAddedFromPositions(positions: Position[]) {
    let latestImportedAt: number | null = null;

    for (const position of positions) {
        const importedAt = parseMistakeReviewTimestamp(position.importedAt);
        if (importedAt === null) continue;
        latestImportedAt =
            latestImportedAt === null ? importedAt : Math.max(latestImportedAt, importedAt);
    }

    if (latestImportedAt === null) return null;

    let count = 0;
    for (const position of positions) {
        const importedAt = parseMistakeReviewTimestamp(position.importedAt);
        if (
            importedAt !== null &&
            latestImportedAt - importedAt <= MISTAKE_REVIEW_IMPORTED_BATCH_WINDOW_MS
        ) {
            count += 1;
        }
    }

    return count > 0 ? { at: latestImportedAt, count } : null;
}

function parseMistakeReviewAddedCount(value: unknown) {
    const count = typeof value === "number" ? value : Number(value);
    return Number.isFinite(count) && count > 0 ? Math.trunc(count) : null;
}

function getMistakeReviewLastAttemptedAt(position?: Position | null) {
    return (
        position?.mistakeReview?.lastAttemptedAt ??
        parseMistakeReviewTimestamp(position?.card.last_review)
    );
}

function parseMistakeReviewTimestamp(value: unknown) {
    if (!value) return null;
    const timestamp =
        value instanceof Date
            ? value.getTime()
            : typeof value === "number"
              ? value
              : Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
}

function mergeMistakeReviewPosition(previous: Position, incoming: Position): Position {
    const previousIds = previous.mistakeReview?.gameIds ?? [];
    const incomingIds = incoming.mistakeReview?.gameIds ?? [];
    const gameIds = Array.from(new Set([...previousIds, ...incomingIds])).sort((a, b) => a - b);
    const occurrenceCount = Math.max(
        previous.mistakeReview?.occurrenceCount ?? previousIds.length,
        incoming.mistakeReview?.occurrenceCount ?? incomingIds.length,
        gameIds.length,
    );

    return {
        ...incoming,
        card: previous.card,
        comment: previous.comment,
        annotations: previous.annotations,
        shapes: previous.shapes,
        reviewTree: previous.reviewTree,
        moveSequence: incoming.moveSequence || previous.moveSequence,
        importedAt: previous.importedAt ?? incoming.importedAt,
        mistakeReview: {
            ...incoming.mistakeReview,
            gameIds,
            occurrenceCount,
            lastAttemptedAt:
                Math.max(
                    previous.mistakeReview?.lastAttemptedAt ?? 0,
                    incoming.mistakeReview?.lastAttemptedAt ?? 0,
                ) || undefined,
            lastAttemptedCardReps:
                previous.mistakeReview?.lastAttemptedAt &&
                previous.mistakeReview?.lastAttemptedAt >=
                    (incoming.mistakeReview?.lastAttemptedAt ?? 0)
                    ? previous.mistakeReview?.lastAttemptedCardReps
                    : incoming.mistakeReview?.lastAttemptedCardReps,
        },
    };
}

function wasMistakeReviewAttemptedOnDay(position: Position, day: Date) {
    const attemptedAt = getMistakeReviewLastAttemptedAt(position);
    return (
        attemptedAt !== null &&
        getMistakeReviewLocalDateKey(new Date(attemptedAt)) === getMistakeReviewLocalDateKey(day)
    );
}

function getMistakeReviewLocalDateKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isMistakeReviewDailyEligible(
    position: Position,
    settings: MistakeReviewDailySettings,
    now: Date,
) {
    const metadata = position.mistakeReview;
    if (!metadata) return false;
    if ((metadata.winProbabilityDrop ?? 0) < settings.minWinProbabilityDrop) return false;
    if (!isMistakeReviewSeverityIncluded(metadata.severity, settings)) return false;
    if (settings.gamePeriod === "all") return true;

    const playedAt = parseMistakeReviewDate(metadata.date);
    if (!playedAt) return false;
    const cutoff = getMistakeReviewPeriodCutoff(settings.gamePeriod, now);
    return playedAt >= cutoff;
}

function isMistakeReviewSeverityIncluded(
    severity: string | undefined,
    settings: MistakeReviewDailySettings,
) {
    switch (severity) {
        case "inaccuracy":
            return settings.includeInaccuracies;
        case "mistake":
            return settings.includeMistakes;
        case "blunder":
            return settings.includeBlunders;
        default:
            return false;
    }
}

function normalizeMistakeReviewPhase(value?: string | null): MistakeReviewPhase | null {
    const raw = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    if (raw === "opening") return "opening";
    if (raw === "middlegame" || raw === "middle" || raw === "midgame") return "middlegame";
    if (raw === "endgame") return "endgame";
    return null;
}

function normalizeMistakeReviewNature(value?: string | null): MistakeReviewNature | null {
    const raw = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    if (raw === "tactical" || raw === "tactic" || raw === "tactics") return "tactical";
    if (raw === "positional" || raw === "position" || raw === "strategic" || raw === "strategy") {
        return "positional";
    }
    return null;
}

function normalizeMistakeReviewNatureConfidence(
    value?: string | null,
): MistakeReviewNatureConfidence | null {
    const raw = String(value || "")
        .trim()
        .toLowerCase();
    if (raw === "high" || raw === "medium" || raw === "low") return raw;
    return null;
}

function normalizeMistakeReviewNatureAspect(
    value?: string | null,
): MistakeReviewNatureAspect | null {
    const raw = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    if (raw === "allowed" || raw === "allow") return "allowed";
    if (raw === "missed" || raw === "miss") return "missed";
    if (raw === "both" || raw === "allowedmissed" || raw === "missedallowed") return "both";
    return null;
}

function isMistakeReviewForcingSan(value?: string | null) {
    const san = value?.trim();
    if (!san) return false;
    return /[x+#=]/.test(san);
}

type MistakeReviewBoardTacticalSignal = {
    reason: string;
    score: number;
    confidence: MistakeReviewNatureConfidence;
};

function getMistakeReviewSanLineTacticalSignal(
    moves: string[],
    lineLabel: string,
): MistakeReviewBoardTacticalSignal | null {
    const line = moves.slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES).map((move) => move.trim());
    const firstMove = line[0];
    if (!firstMove) return null;

    const firstMoveIsQuiet = !isMistakeReviewForcingSan(firstMove);
    const actorMoves = line.filter((_, index) => index % 2 === 0);
    const actorMateIndex = line.findIndex((move, index) => index % 2 === 0 && /#/.test(move));
    if (actorMateIndex >= 0) {
        return {
            reason: firstMoveIsQuiet
                ? `${lineLabel} begins with quiet ${firstMove}, which is tactically motivated because the continuation reaches mate within ${actorMateIndex + 1} plies`
                : `${lineLabel} beginning ${firstMove} reaches mate within ${actorMateIndex + 1} plies`,
            score: 8,
            confidence: "high",
        };
    }

    const actorPromotionIndex = line.findIndex((move, index) => index % 2 === 0 && /=/.test(move));
    if (actorPromotionIndex >= 0) {
        return {
            reason: firstMoveIsQuiet
                ? `${lineLabel} begins with quiet ${firstMove}, which is tactically motivated because it prepares promotion within ${actorPromotionIndex + 1} plies`
                : `${lineLabel} beginning ${firstMove} reaches promotion within ${actorPromotionIndex + 1} plies`,
            score: 6,
            confidence: "high",
        };
    }

    const forcingMoves = line.filter(isMistakeReviewForcingSan);
    if (/[+#]/.test(firstMove)) {
        return {
            reason:
                forcingMoves.length >= 2
                    ? `${lineLabel} begins with immediate check ${firstMove} and contains ${forcingMoves.length} forcing moves within ${line.length} plies`
                    : `${lineLabel} begins with immediate check ${firstMove}, but the supplied line does not verify a concrete follow-up`,
            score: forcingMoves.length >= 2 ? 5 : 3,
            confidence: forcingMoves.length >= 2 ? "high" : "medium",
        };
    }

    const laterActorCheck = actorMoves.slice(1).find((move) => /[+#]/.test(move));
    if (firstMoveIsQuiet && laterActorCheck && forcingMoves.length >= 2) {
        return {
            reason: `${lineLabel} begins with quiet ${firstMove}, which is tactically motivated because it prepares the concrete continuation ${laterActorCheck}`,
            score: forcingMoves.length >= 3 ? 4 : 3,
            confidence: "medium",
        };
    }

    if (
        /x/.test(firstMove) &&
        forcingMoves.length >= 3 &&
        line.some((move) => /[+#=]/.test(move))
    ) {
        return {
            reason: `${lineLabel} beginning ${firstMove} forms a concrete sequence with ${forcingMoves.length} forcing moves`,
            score: 4,
            confidence: "medium",
        };
    }

    return null;
}

function dedupeMistakeReviewTacticalSignals(signals: MistakeReviewBoardTacticalSignal[]) {
    const byReason = new Map<string, MistakeReviewBoardTacticalSignal>();
    for (const signal of signals) {
        const previous = byReason.get(signal.reason);
        if (!previous || signal.score > previous.score) byReason.set(signal.reason, signal);
    }
    return Array.from(byReason.values()).sort((a, b) => b.score - a.score);
}

function getStrongestMistakeReviewTacticalSignal(signals: MistakeReviewBoardTacticalSignal[]) {
    return signals.reduce<MistakeReviewBoardTacticalSignal | undefined>(
        (strongest, signal) => (!strongest || signal.score > strongest.score ? signal : strongest),
        undefined,
    );
}

function getMistakeReviewPositionalAssessment(input: {
    fen: string;
    playedMoveUci: string;
    correctionSan: string;
    pvSan: string[];
    pvUci: string[];
    refutationSan: string[];
    refutationUci: string[];
    reachedDepth?: number;
    strongestTacticalScore: number;
    sharpEvaluationSwing: boolean;
}): { confidence: MistakeReviewNatureConfidence; reason: string } {
    const [position] = positionFromFen(input.fen);
    const bestLegalPlies = position ? getMistakeReviewLegalLinePlies(position, input.pvUci) : 0;
    const playedContext = getMistakeReviewPlayedMoveContext(input.fen, input.playedMoveUci);
    const refutationLegalPlies = playedContext
        ? getMistakeReviewLegalLinePlies(playedContext.after, input.refutationUci)
        : 0;
    const hasTextLine = input.pvSan.length >= 4 || input.refutationSan.length >= 4;
    const hasVerifiedLine = bestLegalPlies >= 2 || refutationLegalPlies >= 2;
    const bestExpectedPlies = Math.min(input.pvUci.length, MISTAKE_REVIEW_NATURE_PV_PLIES);
    const refutationExpectedPlies = Math.min(
        input.refutationUci.length,
        MISTAKE_REVIEW_NATURE_PV_PLIES,
    );
    const hasCompleteVerifiedLines =
        bestExpectedPlies >= 4 &&
        refutationExpectedPlies >= 4 &&
        bestLegalPlies === bestExpectedPlies &&
        refutationLegalPlies === refutationExpectedPlies;
    const depthIsReliable = typeof input.reachedDepth === "number" && input.reachedDepth >= 14;
    const hasEnoughEvidence = Boolean(input.correctionSan) && (hasTextLine || hasVerifiedLine);

    if (!hasEnoughEvidence) {
        return {
            confidence: "low",
            reason: "Insufficient engine-line evidence to verify an immediate tactic; provisionally classified as positional with low confidence.",
        };
    }

    const mixedEvidence = input.strongestTacticalScore > 0 || input.sharpEvaluationSwing;
    const confidence: MistakeReviewNatureConfidence =
        hasCompleteVerifiedLines && depthIsReliable && !mixedEvidence
            ? "high"
            : mixedEvidence
              ? "low"
              : "medium";
    const correctionText = input.correctionSan
        ? `Best move ${input.correctionSan}`
        : "The best line";
    const evidenceText = hasCompleteVerifiedLines
        ? "Across the verified tactical window"
        : "In the supplied engine line";
    const mixedText = mixedEvidence
        ? " Concrete activity or a sharp evaluation swing remains, so the positional label is provisional rather than proof that no deeper tactic exists."
        : "";

    return {
        confidence,
        reason: `${correctionText} has no verified material or mating outcome and no immediate evaluation-relevant forcing threat. ${evidenceText}, positional considerations such as structure, activity, king safety, space, exchanges, or plans therefore determine the remaining decision.${mixedText}`,
    };
}

function getMistakeReviewLegalLinePlies(position: Chess, lineUci: string[]) {
    const replay = position.clone();
    let plies = 0;
    for (const moveText of lineUci.slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES)) {
        const move = parseUci(moveText);
        if (!move || !isNormal(move) || !replay.isLegal(move)) break;
        replay.play(move);
        plies += 1;
    }
    return plies;
}

type MistakeReviewPlayedMoveContext = {
    after: Chess;
    playerColor: Color;
    opponentColor: Color;
    movedTo?: Square;
    playedMoveText: string;
};

function getMistakeReviewBoardTacticalSignals(
    fen?: string | null,
    playedMoveUci?: string | null,
    playedMoveSan?: string | null,
): MistakeReviewBoardTacticalSignal[] {
    const context = getMistakeReviewPlayedMoveContext(fen, playedMoveUci, playedMoveSan);
    if (!context) return [];

    const signals = [
        getMistakeReviewImmediateMateSignal(context),
        getMistakeReviewImmediateMaterialSignal(context),
        getMistakeReviewForkSignal(context),
    ].filter((signal): signal is MistakeReviewBoardTacticalSignal => Boolean(signal));

    return signals.sort((a, b) => b.score - a.score);
}

function getMistakeReviewRefutationTacticalSignals(
    fen?: string | null,
    playedMoveUci?: string | null,
    playedMoveSan?: string | null,
    refutationUci: string[] = [],
    refutationSan: string[] = [],
): MistakeReviewBoardTacticalSignal[] {
    const context = getMistakeReviewPlayedMoveContext(fen, playedMoveUci, playedMoveSan);
    if (!context || refutationUci.length === 0) return [];

    return getMistakeReviewLineTacticalSignals(
        context,
        refutationUci,
        refutationSan,
        "opponent refutation",
    );
}

function getMistakeReviewMissedTacticalSignals(
    fen?: string | null,
    bestMoveUci?: string | null,
    pvUci: string[] = [],
    pvSan: string[] = [],
): MistakeReviewBoardTacticalSignal[] {
    if (!fen) return [];

    const [position] = positionFromFen(fen);
    if (!position) return [];

    const lineUci = pvUci.length ? pvUci : bestMoveUci ? [bestMoveUci] : [];
    if (lineUci.length === 0) return [];

    const context: MistakeReviewPlayedMoveContext = {
        after: position.clone(),
        playerColor: opposite(position.turn),
        opponentColor: position.turn,
        playedMoveText: "best line",
    };

    return getMistakeReviewLineTacticalSignals(context, lineUci, pvSan, "missed best line");
}

function getMistakeReviewLineTacticalSignals(
    context: MistakeReviewPlayedMoveContext,
    lineUci: string[],
    lineSan: string[],
    reasonPrefix: string,
): MistakeReviewBoardTacticalSignal[] {
    const signals: MistakeReviewBoardTacticalSignal[] = [];
    let position = context.after.clone();
    const startingActorMaterial = getMistakeReviewMaterialAdvantage(
        position,
        context.opponentColor,
    );
    let replayedPlies = 0;
    let actorMoveCount = 0;
    let firstActorMoveText = "";
    let firstActorMoveWasQuiet = false;

    for (let ply = 0; ply < Math.min(lineUci.length, MISTAKE_REVIEW_NATURE_PV_PLIES); ply += 1) {
        const move = parseUci(lineUci[ply]);
        if (!move || !isNormal(move) || !position.isLegal(move)) break;

        const movedPiece = position.board.get(move.from);
        if (!movedPiece) break;

        const capturedPiece = position.board.get(move.to);
        const before = position.clone();
        const after = position.clone();
        after.play(move);

        if (movedPiece.color === context.opponentColor) {
            actorMoveCount += 1;
            const moveText =
                lineSan[ply]?.trim() ||
                formatMistakeReviewMoveSquares(move.from, move.to, Boolean(capturedPiece));
            const moveWasQuiet = !isMistakeReviewForcingSan(moveText);
            if (actorMoveCount === 1) {
                firstActorMoveText = moveText;
                firstActorMoveWasQuiet = moveWasQuiet;
            }
            const materialSignal = getMistakeReviewMaterialCaptureSignalForMove(
                context,
                after,
                move,
                movedPiece,
                capturedPiece,
                moveText,
                reasonPrefix,
            );
            const forkSignal = getMistakeReviewForkMoveSignal(
                context,
                before,
                after,
                move,
                movedPiece,
                moveText,
                `${reasonPrefix} ${moveText}`,
            );
            const threatSignal = getMistakeReviewThreateningPieceSignalForMove(
                context,
                before,
                after,
                move,
                movedPiece,
                moveText,
                reasonPrefix,
            );
            const mateThreatSignal =
                actorMoveCount === 1 && moveWasQuiet
                    ? getMistakeReviewMateThreatSignalForMove(
                          after,
                          movedPiece.color,
                          moveText,
                          reasonPrefix,
                      )
                    : null;
            for (const signal of [materialSignal, forkSignal, threatSignal, mateThreatSignal]) {
                if (!signal) continue;
                signals.push(
                    actorMoveCount === 1 && moveWasQuiet && signal !== mateThreatSignal
                        ? {
                              ...signal,
                              reason: `quiet ${moveText} is tactically motivated: ${signal.reason}`,
                          }
                        : signal,
                );
            }
        }

        position = after;
        replayedPlies += 1;
    }

    if (replayedPlies > 0) {
        const actorMaterialGain =
            getMistakeReviewMaterialAdvantage(position, context.opponentColor) -
            startingActorMaterial;
        const quietMotivation = firstActorMoveWasQuiet && firstActorMoveText;
        if (position.isCheckmate() && position.turn === context.playerColor) {
            signals.push({
                reason: quietMotivation
                    ? `${reasonPrefix} begins with quiet ${firstActorMoveText}, which is tactically motivated because the verified line ends in mate within ${replayedPlies} plies`
                    : `${reasonPrefix} ends in mate within ${replayedPlies} plies`,
                score: 9,
                confidence: "high",
            });
        } else if (actorMaterialGain >= 2) {
            signals.push({
                reason: quietMotivation
                    ? `${reasonPrefix} begins with quiet ${firstActorMoveText}, which is tactically motivated because the verified line wins about ${formatMistakeReviewMaterialPoints(actorMaterialGain)} of material within ${replayedPlies} plies`
                    : `${reasonPrefix} wins about ${formatMistakeReviewMaterialPoints(actorMaterialGain)} of material within ${replayedPlies} plies`,
                score: 5 + Math.min(actorMaterialGain, 4),
                confidence: "high",
            });
        } else if (actorMaterialGain >= 1) {
            signals.push({
                reason: quietMotivation
                    ? `${reasonPrefix} begins with quiet ${firstActorMoveText}, which may be tactically motivated because the verified line wins a pawn within ${replayedPlies} plies`
                    : `${reasonPrefix} wins a pawn within ${replayedPlies} plies`,
                score: 3,
                confidence: "medium",
            });
        }
    }

    return dedupeMistakeReviewTacticalSignals(signals);
}

function getMistakeReviewPlayedMoveContext(
    fen?: string | null,
    playedMoveUci?: string | null,
    playedMoveSan?: string | null,
): MistakeReviewPlayedMoveContext | null {
    if (!fen || !playedMoveUci) return null;

    const [position] = positionFromFen(fen);
    const move = parseUci(playedMoveUci);
    if (!position || !move || !isNormal(move) || !position.isLegal(move)) return null;

    const movingPiece = position.board.get(move.from);
    if (!movingPiece) return null;

    const after = position.clone();
    after.play(move);

    return {
        after,
        playerColor: movingPiece.color,
        opponentColor: after.turn,
        movedTo: move.to,
        playedMoveText: playedMoveSan?.trim() || `${makeSquare(move.from)}-${makeSquare(move.to)}`,
    };
}

function getMistakeReviewImmediateMateSignal(
    context: MistakeReviewPlayedMoveContext,
): MistakeReviewBoardTacticalSignal | null {
    for (const [from, dests] of context.after.allDests()) {
        const attacker = context.after.board.get(from);
        if (!attacker || attacker.color !== context.opponentColor) continue;

        for (const to of dests) {
            const response = makeMistakeReviewNormalMove(attacker, from, to);
            const after = context.after.clone();
            after.play(response);
            if (!after.isCheckmate()) continue;

            const responseText = formatMistakeReviewMoveSquares(
                from,
                to,
                Boolean(context.after.board.get(to)),
            );
            return {
                reason: `played ${context.playedMoveText} allows immediate mate by ${responseText}`,
                score: 9,
                confidence: "high",
            };
        }
    }

    return null;
}

function getMistakeReviewMateThreatSignalForMove(
    after: Chess,
    attackerColor: Color,
    moveText: string,
    reasonPrefix: string,
): MistakeReviewBoardTacticalSignal | null {
    const threatPosition = after.clone();
    threatPosition.turn = attackerColor;
    threatPosition.epSquare = undefined;

    for (const [from, dests] of threatPosition.allDests()) {
        const attacker = threatPosition.board.get(from);
        if (!attacker || attacker.color !== attackerColor) continue;

        for (const to of dests) {
            const threatMove = makeMistakeReviewNormalMove(attacker, from, to);
            const threatAfter = threatPosition.clone();
            threatAfter.play(threatMove);
            if (!threatAfter.isCheckmate()) continue;

            const threatText = formatMistakeReviewMoveSquares(
                from,
                to,
                Boolean(threatPosition.board.get(to)),
            );
            return {
                reason: `${reasonPrefix} quiet ${moveText} is tactically motivated because it creates the immediate mate threat ${threatText}`,
                score: 7,
                confidence: "high",
            };
        }
    }

    return null;
}

function getMistakeReviewImmediateMaterialSignal(
    context: MistakeReviewPlayedMoveContext,
): MistakeReviewBoardTacticalSignal | null {
    let best:
        | (MistakeReviewBoardTacticalSignal & {
              gain: number;
              targetValue: number;
              isMovedPiece: boolean;
          })
        | null = null;

    for (const [from, dests] of context.after.allDests()) {
        const attacker = context.after.board.get(from);
        if (!attacker || attacker.color !== context.opponentColor) continue;

        for (const to of dests) {
            const target = context.after.board.get(to);
            if (!target || target.color !== context.playerColor || target.role === "king") {
                continue;
            }

            const targetValue = mistakeReviewPieceValue(target.role);
            const attackerValue = mistakeReviewPieceValue(attacker.role);
            const gain = targetValue - attackerValue;
            const isMovedPiece = to === context.movedTo;
            if (targetValue < 3 || gain < 1) continue;

            const reason = isMovedPiece
                ? `played ${context.playedMoveText} leaves the ${formatMistakeReviewRole(
                      target.role,
                  )} on ${makeSquare(to)} capturable by a ${formatMistakeReviewRole(attacker.role)}`
                : `opponent can immediately win the ${formatMistakeReviewRole(
                      target.role,
                  )} on ${makeSquare(to)} with a ${formatMistakeReviewRole(attacker.role)}`;
            const confidence: MistakeReviewNatureConfidence =
                isMovedPiece || gain >= 2 ? "high" : "medium";
            const candidate = {
                reason,
                gain,
                targetValue,
                isMovedPiece,
                score: 4 + Math.min(gain, 3) + (isMovedPiece ? 1 : 0),
                confidence,
            };

            if (
                !best ||
                candidate.score > best.score ||
                (candidate.score === best.score && candidate.targetValue > best.targetValue)
            ) {
                best = candidate;
            }
        }
    }

    return best
        ? {
              reason: best.reason,
              score: best.score,
              confidence: best.confidence,
          }
        : null;
}

function getMistakeReviewForkSignal(
    context: MistakeReviewPlayedMoveContext,
): MistakeReviewBoardTacticalSignal | null {
    let best: MistakeReviewBoardTacticalSignal | null = null;

    for (const [from, dests] of context.after.allDests()) {
        const attacker = context.after.board.get(from);
        if (!attacker || attacker.color !== context.opponentColor || attacker.role === "king") {
            continue;
        }

        for (const to of dests) {
            const response = makeMistakeReviewNormalMove(attacker, from, to);
            const responsePosition = context.after.clone();
            responsePosition.play(response);
            const movedAttacker = responsePosition.board.get(to);
            if (!movedAttacker || movedAttacker.color !== context.opponentColor) continue;

            const responseText = formatMistakeReviewMoveSquares(
                from,
                to,
                Boolean(context.after.board.get(to)),
            );
            const signal = getMistakeReviewForkMoveSignal(
                context,
                context.after,
                responsePosition,
                response,
                movedAttacker,
                responseText,
                `opponent can play ${responseText}`,
            );
            if (signal && (!best || signal.score > best.score)) best = signal;
        }
    }

    return best
        ? {
              reason: best.reason,
              score: best.score,
              confidence: best.confidence,
          }
        : null;
}

function getMistakeReviewMaterialCaptureSignalForMove(
    context: MistakeReviewPlayedMoveContext,
    after: Chess,
    move: NormalMove,
    movedPiece: Piece,
    capturedPiece: Piece | undefined,
    responseText: string,
    reasonPrefix: string,
): MistakeReviewBoardTacticalSignal | null {
    if (
        !capturedPiece ||
        capturedPiece.color !== context.playerColor ||
        capturedPiece.role === "king" ||
        movedPiece.role === "king"
    ) {
        return null;
    }

    const capturedValue = mistakeReviewPieceValue(capturedPiece.role);
    const movedValue = mistakeReviewPieceValue(movedPiece.role);
    const gain = capturedValue - movedValue;
    const canRecapture = hasMistakeReviewLegalCaptureOnSquare(after, context.playerColor, move.to);
    if (capturedValue < 3 && gain < 2) return null;
    if (canRecapture && gain < 2) return null;

    return {
        reason: `${reasonPrefix} ${responseText} wins the ${formatMistakeReviewRole(
            capturedPiece.role,
        )} on ${makeSquare(move.to)}`,
        score: 5 + Math.min(Math.max(gain, 1), 4) + (canRecapture ? 0 : 1),
        confidence: !canRecapture || gain >= 2 ? "high" : "medium",
    };
}

function getMistakeReviewForkMoveSignal(
    context: MistakeReviewPlayedMoveContext,
    before: Chess,
    after: Chess,
    move: NormalMove,
    movedPiece: Piece,
    responseText: string,
    reasonPrefix: string,
): MistakeReviewBoardTacticalSignal | null {
    if (movedPiece.role === "king") return null;

    const targets = getMistakeReviewAttackedTargets(
        after,
        move.to,
        movedPiece,
        context.playerColor,
    );
    const materialTargets = targets
        .filter((target) => target.piece.role !== "king")
        .filter(
            (target) =>
                !getMistakeReviewAttackedTargets(
                    before,
                    move.from,
                    movedPiece,
                    context.playerColor,
                ).some((beforeTarget) => beforeTarget.square === target.square),
        )
        .sort(
            (a, b) => mistakeReviewPieceValue(b.piece.role) - mistakeReviewPieceValue(a.piece.role),
        );
    const attacksKing = after.isCheck() || targets.some((target) => target.piece.role === "king");

    if (attacksKing && materialTargets.length > 0) {
        const target = materialTargets[0];
        const targetValue = mistakeReviewPieceValue(target.piece.role);
        return {
            reason: `${reasonPrefix}, creating a fork: check plus attack on the ${formatMistakeReviewRole(
                target.piece.role,
            )} at ${makeSquare(target.square)}`,
            score: 5 + Math.min(targetValue, 4),
            confidence: "high",
        };
    }

    if (materialTargets.length < 2) return null;

    const [first, second] = materialTargets;
    const firstValue = mistakeReviewPieceValue(first.piece.role);
    const secondValue = mistakeReviewPieceValue(second.piece.role);
    if (firstValue + secondValue < 8 && firstValue < 9) return null;

    return {
        reason: `${reasonPrefix}, forking the ${formatMistakeReviewRole(
            first.piece.role,
        )} at ${makeSquare(first.square)} and the ${formatMistakeReviewRole(
            second.piece.role,
        )} at ${makeSquare(second.square)}`,
        score: 5 + Math.min(firstValue + secondValue, 5),
        confidence: firstValue >= 9 || secondValue >= 5 ? "high" : "medium",
    };
}

function getMistakeReviewThreateningPieceSignalForMove(
    context: MistakeReviewPlayedMoveContext,
    before: Chess,
    after: Chess,
    move: NormalMove,
    movedPiece: Piece,
    responseText: string,
    reasonPrefix: string,
): MistakeReviewBoardTacticalSignal | null {
    if (movedPiece.role === "king") return null;

    const beforeTargets = getMistakeReviewAttackedTargets(
        before,
        move.from,
        movedPiece,
        context.playerColor,
    );
    const afterTargets = getMistakeReviewAttackedTargets(
        after,
        move.to,
        movedPiece,
        context.playerColor,
    )
        .filter((target) => target.piece.role !== "king")
        .filter(
            (target) =>
                !beforeTargets.some((beforeTarget) => beforeTarget.square === target.square),
        )
        .sort(
            (a, b) => mistakeReviewPieceValue(b.piece.role) - mistakeReviewPieceValue(a.piece.role),
        );

    for (const target of afterTargets) {
        const targetValue = mistakeReviewPieceValue(target.piece.role);
        const movedValue = mistakeReviewPieceValue(movedPiece.role);
        const looseOrUnderdefended = isMistakeReviewLooseOrUnderdefended(
            after,
            target.square,
            context.playerColor,
            context.opponentColor,
        );
        if (targetValue - movedValue < 2 && !looseOrUnderdefended) continue;

        return {
            reason: `${reasonPrefix} ${responseText} threatens the ${formatMistakeReviewRole(
                target.piece.role,
            )} on ${makeSquare(target.square)}`,
            score: 4 + Math.min(Math.max(targetValue - movedValue, 1), 4),
            confidence: targetValue >= 5 || looseOrUnderdefended ? "high" : "medium",
        };
    }

    return null;
}

function makeMistakeReviewNormalMove(piece: Piece, from: Square, to: Square): NormalMove {
    const move: NormalMove = { from, to };
    if (piece.role === "pawn" && (squareRank(to) === 0 || squareRank(to) === 7)) {
        move.promotion = "queen";
    }
    return move;
}

function hasMistakeReviewLegalCaptureOnSquare(position: Chess, color: Color, square: Square) {
    if (position.turn !== color) return false;

    for (const dests of position.allDests().values()) {
        if (dests.has(square)) return true;
    }

    return false;
}

function getMistakeReviewAttackedTargets(
    position: MistakeReviewPlayedMoveContext["after"],
    square: Square,
    attacker: Piece,
    targetColor: Color,
) {
    const attackedSquares = getMistakeReviewAttackedSquares(position, square, attacker);
    const targets: { square: Square; piece: Piece }[] = [];

    for (const targetSquare of attackedSquares) {
        const piece = position.board.get(targetSquare);
        if (piece?.color === targetColor) {
            targets.push({ square: targetSquare, piece });
        }
    }

    return targets;
}

function getMistakeReviewAttackedSquares(position: Chess, square: Square, attacker: Piece) {
    return attacker.role === "pawn"
        ? pawnAttacks(attacker.color, square)
        : attacker.role === "knight"
          ? knightAttacks(square)
          : attacker.role === "bishop"
            ? bishopAttacks(square, position.board.occupied)
            : attacker.role === "rook"
              ? rookAttacks(square, position.board.occupied)
              : attacker.role === "queen"
                ? queenAttacks(square, position.board.occupied)
                : kingAttacks(square);
}

function isMistakeReviewLooseOrUnderdefended(
    position: Chess,
    targetSquare: Square,
    defenderColor: Color,
    attackerColor: Color,
) {
    const attackers = getMistakeReviewPseudoAttackers(position, targetSquare, attackerColor).length;
    if (attackers === 0) return false;

    const defenders = getMistakeReviewPseudoAttackers(position, targetSquare, defenderColor).length;
    return defenders === 0 || attackers > defenders;
}

function getMistakeReviewPseudoAttackers(position: Chess, targetSquare: Square, color: Color) {
    const attackers: Square[] = [];

    for (const [square, piece] of position.board) {
        if (piece.color !== color) continue;
        if (getMistakeReviewAttackedSquares(position, square, piece).has(targetSquare)) {
            attackers.push(square);
        }
    }

    return attackers;
}

function getMistakeReviewMaterialAdvantage(position: Chess, color: Color) {
    let balance = 0;
    for (const [, piece] of position.board) {
        if (piece.role === "king") continue;
        const value = mistakeReviewPieceValue(piece.role);
        balance += piece.color === color ? value : -value;
    }
    return balance;
}

function formatMistakeReviewMaterialPoints(points: number) {
    const rounded = Math.round(points * 10) / 10;
    return `${rounded} ${rounded === 1 ? "point" : "points"}`;
}

function mistakeReviewPieceValue(role: Role) {
    switch (role) {
        case "pawn":
            return 1;
        case "knight":
        case "bishop":
            return 3;
        case "rook":
            return 5;
        case "queen":
            return 9;
        case "king":
            return 100;
    }
}

function formatMistakeReviewRole(role: Role) {
    switch (role) {
        case "pawn":
            return "pawn";
        case "knight":
            return "knight";
        case "bishop":
            return "bishop";
        case "rook":
            return "rook";
        case "queen":
            return "queen";
        case "king":
            return "king";
    }
}

function formatMistakeReviewMoveSquares(from: Square, to: Square, isCapture: boolean) {
    return `${makeSquare(from)}${isCapture ? "x" : "-"}${makeSquare(to)}`;
}

function classifyMistakeReviewPhaseFromFen(fen: string): MistakeReviewPhase {
    const fullmove = parseMistakeReviewFenFullmove(fen);
    if (typeof fullmove === "number" && fullmove <= MISTAKE_REVIEW_OPENING_MAX_FULLMOVE) {
        return "opening";
    }

    const nonPawnPieces = countMistakeReviewFenNonPawnPieces(fen);
    if (
        (typeof fullmove === "number" && fullmove >= MISTAKE_REVIEW_ENDGAME_MIN_FULLMOVE) ||
        (typeof nonPawnPieces === "number" && nonPawnPieces <= MISTAKE_REVIEW_ENDGAME_NON_PAWN_MAX)
    ) {
        return "endgame";
    }

    return "middlegame";
}

function parseMistakeReviewFenFullmove(fen: string) {
    const parts = String(fen || "")
        .trim()
        .split(/\s+/);
    if (parts.length < 6) return null;
    const fullmove = Number.parseInt(parts[5] ?? "", 10);
    return Number.isFinite(fullmove) ? fullmove : null;
}

function countMistakeReviewFenNonPawnPieces(fen: string) {
    const board = String(fen || "")
        .trim()
        .split(/\s+/)[0];
    if (!board) return null;
    const matches = board.match(/[nbrqNBRQ]/g);
    return matches?.length ?? 0;
}

function sortMistakeReviewDueCards(a: Position, b: Position) {
    return (
        getMistakeReviewSeverityWeight(b.mistakeReview?.severity) -
            getMistakeReviewSeverityWeight(a.mistakeReview?.severity) ||
        getMistakeReviewPlayedAtTime(b) - getMistakeReviewPlayedAtTime(a) ||
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime()
    );
}

function sortMistakeReviewNewCards(a: Position, b: Position) {
    return (
        getMistakeReviewSeverityWeight(b.mistakeReview?.severity) -
            getMistakeReviewSeverityWeight(a.mistakeReview?.severity) ||
        getMistakeReviewPlayedAtTime(b) - getMistakeReviewPlayedAtTime(a)
    );
}

function getMistakeReviewPlayedAtTime(position: Position) {
    return parseMistakeReviewDate(position.mistakeReview?.date)?.getTime() ?? 0;
}

function sortMistakeReviewPhaseDueCards(a: Position, b: Position) {
    return (
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime() ||
        getMistakeReviewSeverityWeight(b.mistakeReview?.severity) -
            getMistakeReviewSeverityWeight(a.mistakeReview?.severity)
    );
}

function sortMistakeReviewPhaseScheduledCards(a: Position, b: Position) {
    return (
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime() ||
        getMistakeReviewSeverityWeight(b.mistakeReview?.severity) -
            getMistakeReviewSeverityWeight(a.mistakeReview?.severity)
    );
}

function sortMistakeReviewTimeManagementCards(a: Position, b: Position) {
    return (
        Number(b.mistakeReview?.moveTimeSeconds ?? 0) -
            Number(a.mistakeReview?.moveTimeSeconds ?? 0) ||
        getMistakeReviewSeverityWeight(b.mistakeReview?.severity) -
            getMistakeReviewSeverityWeight(a.mistakeReview?.severity) ||
        (b.mistakeReview?.winProbabilityDrop ?? 0) - (a.mistakeReview?.winProbabilityDrop ?? 0) ||
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime()
    );
}

function sortMistakeReviewScheduledTimeManagementCards(a: Position, b: Position) {
    return (
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime() ||
        sortMistakeReviewTimeManagementCards(a, b)
    );
}

function getMistakeReviewPeriodCutoff(period: MistakeReviewGamePeriod, now: Date) {
    const cutoff = new Date(now);
    switch (period) {
        case "week":
            cutoff.setDate(cutoff.getDate() - 7);
            break;
        case "2weeks":
            cutoff.setDate(cutoff.getDate() - 14);
            break;
        case "month":
            cutoff.setMonth(cutoff.getMonth() - 1);
            break;
        case "3months":
            cutoff.setMonth(cutoff.getMonth() - 3);
            break;
        case "6months":
            cutoff.setMonth(cutoff.getMonth() - 6);
            break;
        case "year":
            cutoff.setFullYear(cutoff.getFullYear() - 1);
            break;
        case "all":
            break;
    }
    return cutoff;
}

function getMistakeReviewScanDateBounds(range: MistakeReviewDateRange) {
    if (range === "all") return { startDate: null, endDate: null };

    const now = new Date();
    const start = new Date(now);
    switch (range) {
        case "week":
            start.setDate(start.getDate() - 7);
            break;
        case "2weeks":
            start.setDate(start.getDate() - 14);
            break;
        case "month":
            start.setMonth(start.getMonth() - 1);
            break;
        case "3months":
            start.setMonth(start.getMonth() - 3);
            break;
        case "6months":
            start.setMonth(start.getMonth() - 6);
            break;
        case "year":
            start.setFullYear(start.getFullYear() - 1);
            break;
    }

    return {
        startDate: formatMistakeReviewDbDate(start),
        endDate: formatMistakeReviewDbDate(now),
    };
}

function formatMistakeReviewDbDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
}

function parseMistakeReviewDate(value?: string | null) {
    if (!value) return null;
    const normalized = value.replace(/\./g, "-").replace(/\?/g, "0");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeFenKey(fen: string) {
    return fen.split(/\s+/).slice(0, 4).join(" ");
}

function sanitizeMistakeReviewFileName(name: string) {
    const cleaned = name
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || "Mistake Review";
}
