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
        description: "Forcing corrections with checks, captures, promotions, or sharp PVs.",
    },
    {
        id: "positional",
        label: "Positional",
        description: "Quiet corrections where the engine line is not immediately forcing.",
    },
] as const;

const MISTAKE_REVIEW_OPENING_MAX_FULLMOVE = 10;
const MISTAKE_REVIEW_ENDGAME_MIN_FULLMOVE = 31;
const MISTAKE_REVIEW_ENDGAME_NON_PAWN_MAX = 6;
const MISTAKE_REVIEW_NATURE_PV_PLIES = 4;
const MISTAKE_REVIEW_NATURE_CLASSIFIER_VERSION = 2;
const MISTAKE_REVIEW_NATURE_CACHE_LIMIT = 5000;
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

function getMistakeReviewDeckSummary(path: string, deck: MistakeReviewDeck): MistakeReviewDeckSummary {
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

export async function readMistakeReviewDeck(path: string): Promise<MistakeReviewDeck> {
    const raw = await readTextFile(path);
    const parsed = mistakeReviewDeckSchema.parse(JSON.parse(raw));
    return {
        version: MISTAKE_REVIEW_VERSION,
        ...parsed,
        positions: parsed.positions as unknown as Position[],
        logs: parsed.logs as unknown as MistakeReviewDeck["logs"],
    };
}

export async function writeMistakeReviewDeck(path: string, deck: MistakeReviewDeck) {
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

export async function deleteMistakeReviewDeck(path: string) {
    await remove(path);
}

export async function listMistakeReviewDecks(
    directory: string,
): Promise<MistakeReviewDeckSummary[]> {
    const entries = await readDir(directory).catch(() => []);
    const decks: MistakeReviewDeckSummary[] = [];

    const summaries = await Promise.all(entries.map(async (entry) => {
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
    }));

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
    const now = options.now ?? new Date();
    const filtered = positions.filter((position) =>
        isMistakeReviewDailyEligible(position, settings, now),
    );
    const progress = getMistakeReviewDailyProgress(positions, settings, { now });
    const attemptedTodayKeys = new Set(
        filtered
            .filter((position) => wasMistakeReviewAttemptedOnDay(position, now))
            .map(mistakeReviewDailyPositionKey),
    );
    const unseenToday = filtered.filter(
        (position) =>
            !wasMistakeReviewAttemptedOnDay(position, now) &&
            !attemptedTodayKeys.has(mistakeReviewDailyPositionKey(position)),
    );
    const due = uniqueMistakeReviewDailyPositions(
        unseenToday
            .filter((position) => position.card.reps > 0 && new Date(position.card.due) <= now)
            .sort(sortMistakeReviewDueCards),
    );
    const fresh = uniqueMistakeReviewDailyPositions(
        unseenToday.filter((position) => position.card.reps === 0).sort(sortMistakeReviewNewCards),
        new Set(due.map(mistakeReviewDailyPositionKey)),
    );

    if (options.extra) {
        return [...due, ...fresh];
    }

    const target = progress.remaining;
    const selectedDue = due.slice(0, target);
    const remaining = Math.max(0, target - selectedDue.length);
    const selectedNew = fresh.slice(0, Math.min(progress.newRemaining, remaining));
    return [...selectedDue, ...selectedNew];
}

function uniqueMistakeReviewDailyPositions(positions: Position[], seen = new Set<string>()) {
    const unique: Position[] = [];
    for (const position of positions) {
        const key = mistakeReviewDailyPositionKey(position);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(position);
    }
    return unique;
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
    options: { now?: Date } = {},
) {
    const phase = normalizeMistakeReviewPhase(phaseInput);
    if (!phase) return [];

    const now = options.now ?? new Date();
    const phasePositions = positions.filter(
        (position) => position.mistakeReview && getMistakeReviewPhase(position) === phase,
    );
    const repsFor = (position: Position) =>
        Math.max(0, Math.trunc(Number(position.card.reps) || 0));
    const due = phasePositions
        .filter((position) => repsFor(position) > 0 && new Date(position.card.due) <= now)
        .sort((a, b) => sortMistakeReviewPhaseDueCards(a, b));
    const fresh = phasePositions
        .filter((position) => repsFor(position) === 0)
        .sort(sortMistakeReviewNewCards);
    const scheduled = phasePositions
        .filter((position) => repsFor(position) > 0 && new Date(position.card.due) > now)
        .sort((a, b) => sortMistakeReviewPhaseScheduledCards(a, b));

    return [...due, ...fresh, ...scheduled];
}

export function getMistakeReviewTimeManagementBatch(
    positions: Position[],
    options: { minMoveSeconds?: number } = {},
) {
    const minMoveSeconds =
        typeof options.minMoveSeconds === "number" && Number.isFinite(options.minMoveSeconds)
            ? Math.max(0, options.minMoveSeconds)
            : DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds;

    return positions
        .filter((position) => isMistakeReviewTimeManagementPosition(position, minMoveSeconds))
        .sort(sortMistakeReviewTimeManagementCards);
}

export function getMistakeReviewNatureBatch(
    positions: Position[],
    natureInput: MistakeReviewNature,
    options: { now?: Date } = {},
) {
    const nature = normalizeMistakeReviewNature(natureInput);
    if (!nature) return [];

    const now = options.now ?? new Date();
    const naturePositions = positions.filter(
        (position) => position.mistakeReview && getMistakeReviewNature(position) === nature,
    );
    const repsFor = (position: Position) =>
        Math.max(0, Math.trunc(Number(position.card.reps) || 0));
    const due = naturePositions
        .filter((position) => repsFor(position) > 0 && new Date(position.card.due) <= now)
        .sort((a, b) => sortMistakeReviewPhaseDueCards(a, b));
    const fresh = naturePositions
        .filter((position) => repsFor(position) === 0)
        .sort(sortMistakeReviewNewCards);
    const scheduled = naturePositions
        .filter((position) => repsFor(position) > 0 && new Date(position.card.due) > now)
        .sort((a, b) => sortMistakeReviewPhaseScheduledCards(a, b));

    return [...due, ...fresh, ...scheduled];
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
    const counts = Object.fromEntries(
        MISTAKE_REVIEW_NATURES.map((nature) => [nature.id, { total: 0, due: 0 }]),
    ) as MistakeReviewNatureCounts;

    for (const position of positions) {
        if (!position.mistakeReview) continue;
        const nature = getMistakeReviewNature(position);
        const row = counts[nature];
        row.total += 1;
        if (position.card.reps > 0 && new Date(position.card.due) <= now) {
            row.due += 1;
        }
    }

    return counts;
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
    const bestMoveSan = metadata?.bestMoveSan ?? position.answer ?? "";
    const playedMoveSan = metadata?.playedMoveSan ?? "";
    const pvSan = normalizeMistakeReviewMoveList(metadata?.pvSan);
    const refutationSan = normalizeMistakeReviewMoveList(metadata?.refutationSan);
    const cpLoss = metadata?.cpLoss ?? position.engine?.lossCp;
    const winProbabilityDrop = metadata?.winProbabilityDrop;
    const firstPvSan = pvSan[0] ?? "";
    const correctionSan = bestMoveSan || firstPvSan;
    const bestIsForcing = isMistakeReviewForcingSan(correctionSan);
    const firstPvIsForcing = isMistakeReviewForcingSan(firstPvSan);
    const playedIsForcing = isMistakeReviewForcingSan(playedMoveSan);
    const forcingPvMoves = pvSan
        .slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES)
        .filter(isMistakeReviewForcingSan);
    const forcingRefutationMoves = refutationSan
        .slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES)
        .filter(isMistakeReviewForcingSan);
    const hasMateSignal = [
        correctionSan,
        playedMoveSan,
        ...pvSan.slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES),
        ...refutationSan.slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES),
    ].some((move) => /#/.test(move));
    const largeLoss = typeof cpLoss === "number" && cpLoss >= 180;
    const sharpWinDrop = typeof winProbabilityDrop === "number" && winProbabilityDrop >= 12;
    const missedScore =
        (bestIsForcing ? 3 : 0) +
        (!bestIsForcing && firstPvIsForcing ? 2 : 0) +
        (forcingPvMoves.length >= 2 ? 2 : 0) +
        (hasMateSignal && pvSan.some((move) => /#/.test(move)) ? 3 : 0) +
        ((largeLoss || sharpWinDrop) && forcingPvMoves.length > 0 ? 1 : 0) +
        (playedIsForcing && bestIsForcing ? 1 : 0);
    const allowedScore =
        (forcingRefutationMoves.length >= 1 && (largeLoss || sharpWinDrop) ? 2 : 0) +
        (forcingRefutationMoves.length >= 2 ? 2 : 0) +
        (hasMateSignal && refutationSan.some((move) => /#/.test(move)) ? 3 : 0);
    const missedTactical = missedScore >= 4 || (missedScore >= 3 && (largeLoss || sharpWinDrop));
    const allowedTactical = allowedScore >= 4 || (allowedScore >= 3 && (largeLoss || sharpWinDrop));
    const allowedReason = forcingRefutationMoves.length
        ? `opponent refutation has ${forcingRefutationMoves.length} forcing move${
              forcingRefutationMoves.length === 1 ? "" : "s"
          } early`
        : "opponent refutation is not immediately forcing";
    const missedReason =
        bestIsForcing && correctionSan
            ? `best move ${correctionSan} is forcing`
            : forcingPvMoves.length
              ? `best line has ${forcingPvMoves.length} forcing move${
                    forcingPvMoves.length === 1 ? "" : "s"
                } early`
              : `${correctionSan ? `best move ${correctionSan}` : "best line"} is quiet`;

    if (allowedTactical || missedTactical) {
        const aspect =
            allowedTactical && missedTactical ? "both" : allowedTactical ? "allowed" : "missed";
        return {
            nature: "tactical",
            confidence: Math.max(allowedScore, missedScore) >= 5 ? "high" : "medium",
            reason:
                aspect === "allowed"
                    ? `Allowed tactical resource: ${allowedReason}`
                    : aspect === "missed"
                      ? `Missed tactical resource: ${missedReason}`
                      : `Allowed and missed tactical resources: ${allowedReason}`,
            tacticalSignals: [
                ...(allowedTactical ? [`Allowed: ${allowedReason}`] : []),
                ...(missedTactical ? [`Missed: ${missedReason}`] : []),
            ],
            aspect,
            allowedNature: allowedTactical ? "tactical" : "positional",
            allowedReason,
            missedNature: missedTactical ? "tactical" : "positional",
            missedReason,
        };
    }

    const quietCorrectionText = correctionSan
        ? `best move ${correctionSan} is quiet`
        : "engine correction is quiet";
    return {
        nature: "positional",
        confidence: forcingPvMoves.length === 0 && !largeLoss && !sharpWinDrop ? "high" : "medium",
        reason:
            forcingPvMoves.length === 0
                ? `${quietCorrectionText}; early PV has no checks, captures, or promotions.`
                : `${quietCorrectionText}; only ${forcingPvMoves.length} forcing move${
                      forcingPvMoves.length === 1 ? "" : "s"
                  } appears early in the PV.`,
        tacticalSignals: [],
        aspect: refutationSan.length ? "both" : "missed",
        allowedNature: "positional",
        allowedReason,
        missedNature: "positional",
        missedReason,
    };
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
    const firstPvSan = pvSan[0] ?? "";
    const correctionSan = bestMoveSan || firstPvSan;
    const bestIsForcing = isMistakeReviewForcingSan(correctionSan);
    const firstPvIsForcing = isMistakeReviewForcingSan(firstPvSan);
    const playedIsForcing = isMistakeReviewForcingSan(playedMoveSan);
    const forcingPvMoves = pvSan
        .slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES)
        .filter(isMistakeReviewForcingSan);
    const forcingRefutationMoves = refutationSan
        .slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES)
        .filter(isMistakeReviewForcingSan);
    const hasMateSignal = [
        correctionSan,
        playedMoveSan,
        ...pvSan.slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES),
        ...refutationSan.slice(0, MISTAKE_REVIEW_NATURE_PV_PLIES),
    ].some((move) => /#/.test(move));
    const largeLoss = typeof cpLoss === "number" && cpLoss >= 180;
    const sharpWinDrop = typeof winProbabilityDrop === "number" && winProbabilityDrop >= 12;
    const tacticalSignals: string[] = [];
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

    for (const signal of allowedBoardSignals) {
        tacticalSignals.push(`Allowed: ${signal.reason}`);
    }
    for (const signal of missedSignals) {
        tacticalSignals.push(`Missed: ${signal.reason}`);
    }
    if (bestIsForcing && correctionSan) {
        tacticalSignals.push(`best move ${correctionSan} is forcing`);
    }
    if (!bestIsForcing && firstPvIsForcing && firstPvSan) {
        tacticalSignals.push(`PV starts with forcing move ${firstPvSan}`);
    }
    if (forcingPvMoves.length >= 2) {
        tacticalSignals.push(
            `${forcingPvMoves.length} forcing moves in the first ${MISTAKE_REVIEW_NATURE_PV_PLIES} PV plies`,
        );
    }
    if (forcingRefutationMoves.length > 0) {
        tacticalSignals.push(
            `opponent refutation starts with ${forcingRefutationMoves.length} forcing move${
                forcingRefutationMoves.length === 1 ? "" : "s"
            }`,
        );
    }
    if (hasMateSignal) {
        tacticalSignals.push("mate threat appears in the engine line");
    }
    if ((largeLoss || sharpWinDrop) && forcingPvMoves.length > 0) {
        tacticalSignals.push("large evaluation swing with an immediate forcing line");
    }
    if (playedIsForcing && bestIsForcing && playedMoveSan) {
        tacticalSignals.push(`game move ${playedMoveSan} was also forcing`);
    }

    const allowedScore =
        allowedBoardSignals.reduce((score, signal) => score + signal.score, 0) +
        (forcingRefutationMoves.length >= 1 && (largeLoss || sharpWinDrop) ? 2 : 0) +
        (forcingRefutationMoves.length >= 2 ? 2 : 0) +
        (hasMateSignal && refutationSan.some((move) => /#/.test(move)) ? 3 : 0);
    const missedScore =
        missedSignals.reduce((score, signal) => score + signal.score, 0) +
        (bestIsForcing ? 3 : 0) +
        (!bestIsForcing && firstPvIsForcing ? 2 : 0) +
        (forcingPvMoves.length >= 2 ? 2 : 0) +
        (forcingPvMoves.length >= 3 ? 1 : 0) +
        (hasMateSignal && pvSan.some((move) => /#/.test(move)) ? 3 : 0) +
        ((largeLoss || sharpWinDrop) && forcingPvMoves.length > 0 ? 1 : 0) +
        (playedIsForcing && bestIsForcing ? 1 : 0);

    const tacticalScore = allowedScore + missedScore;
    const allowedTactical = allowedScore >= 4 || (allowedScore >= 3 && (largeLoss || sharpWinDrop));
    const missedTactical = missedScore >= 4 || (missedScore >= 3 && (largeLoss || sharpWinDrop));
    const allowedReason =
        allowedBoardSignals[0]?.reason ??
        (forcingRefutationMoves.length
            ? `opponent refutation has ${forcingRefutationMoves.length} forcing move${
                  forcingRefutationMoves.length === 1 ? "" : "s"
              } early`
            : "opponent refutation is not immediately forcing");
    const missedReason =
        missedSignals[0]?.reason ??
        (bestIsForcing && correctionSan
            ? `best move ${correctionSan} is forcing`
            : forcingPvMoves.length
              ? `best line has ${forcingPvMoves.length} forcing move${
                    forcingPvMoves.length === 1 ? "" : "s"
                } early`
              : `${correctionSan ? `best move ${correctionSan}` : "best line"} is quiet`);

    if (allowedTactical || missedTactical) {
        const strongestSignal = [...allowedBoardSignals, ...missedSignals].sort(
            (a, b) => b.score - a.score,
        )[0];
        const aspect =
            allowedTactical && missedTactical ? "both" : allowedTactical ? "allowed" : "missed";
        return {
            nature: "tactical",
            confidence:
                strongestSignal?.confidence ??
                (Math.max(allowedScore, missedScore) >= 6 ? "high" : "medium"),
            reason:
                aspect === "allowed"
                    ? `Allowed tactical resource: ${allowedReason}`
                    : aspect === "missed"
                      ? `Missed tactical resource: ${missedReason}`
                      : `Allowed and missed tactical resources: ${allowedReason}`,
            tacticalSignals,
            aspect,
            allowedNature: allowedTactical ? "tactical" : "positional",
            allowedReason,
            missedNature: missedTactical ? "tactical" : "positional",
            missedReason,
        };
    }

    if (tacticalScore >= 3 && (largeLoss || sharpWinDrop)) {
        const aspect = allowedScore > missedScore ? "allowed" : "missed";
        return {
            nature: "tactical",
            confidence: "medium",
            reason:
                aspect === "allowed"
                    ? `Allowed tactical resource: ${allowedReason}`
                    : `Missed tactical resource: ${missedReason}`,
            tacticalSignals,
            aspect,
            allowedNature: allowedScore >= 3 ? "tactical" : "positional",
            allowedReason,
            missedNature: missedScore >= 3 ? "tactical" : "positional",
            missedReason,
        };
    }

    const quietCorrectionText = correctionSan
        ? `best move ${correctionSan} is quiet`
        : "engine correction is quiet";
    const reason =
        forcingPvMoves.length === 0
            ? `${quietCorrectionText}; early PV has no checks, captures, or promotions.`
            : `${quietCorrectionText}; only ${forcingPvMoves.length} forcing move${
                  forcingPvMoves.length === 1 ? "" : "s"
              } appears early in the PV.`;

    return {
        nature: "positional",
        confidence:
            forcingPvMoves.length === 0 && !largeLoss && !sharpWinDrop
                ? "high"
                : forcingPvMoves.length <= 1
                  ? "medium"
                  : "low",
        reason,
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
            const moveText =
                lineSan[ply]?.trim() ||
                formatMistakeReviewMoveSquares(move.from, move.to, Boolean(capturedPiece));
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
            if (materialSignal) signals.push(materialSignal);
            if (forkSignal) signals.push(forkSignal);
            if (threatSignal) signals.push(threatSignal);
        }

        position = after;
    }

    return signals.sort((a, b) => b.score - a.score);
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
