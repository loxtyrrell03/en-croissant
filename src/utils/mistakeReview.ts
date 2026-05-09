import { basename, resolve } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
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
import { getStats, type Position, positionSchema } from "@/components/files/opening";

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

const MISTAKE_REVIEW_OPENING_MAX_FULLMOVE = 10;
const MISTAKE_REVIEW_ENDGAME_MIN_FULLMOVE = 31;
const MISTAKE_REVIEW_ENDGAME_NON_PAWN_MAX = 6;

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

const reviewLogSchema = z
    .object({
        fen: z.string(),
    })
    .passthrough();

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
    positions: positionSchema.array(),
    logs: reviewLogSchema.array().default([]),
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
    await writeTextFile(path, `${JSON.stringify(updatedDeck, null, 2)}\n`);
    return updatedDeck;
}

export async function deleteMistakeReviewDeck(path: string) {
    await remove(path);
}

export async function listMistakeReviewDecks(
    directory: string,
): Promise<MistakeReviewDeckSummary[]> {
    const entries = await readDir(directory).catch(() => []);
    const decks: MistakeReviewDeckSummary[] = [];

    for (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith(MISTAKE_REVIEW_EXTENSION)) continue;

        const path = await resolve(directory, entry.name);
        try {
            const deck = await readMistakeReviewDeck(path);
            const stats = getStats(deck.positions);
            const lastAdded = getMistakeReviewLastAdded(deck);
            decks.push({
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
            });
        } catch {
            // Ignore malformed mistake decks so one broken file does not hide the rest.
        }
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
            ? [severityLabel, "Long think", MISTAKE_REVIEW_SOURCE]
            : [severityLabel, MISTAKE_REVIEW_SOURCE],
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
        }${dateText}.`,
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
    const progress = getMistakeReviewDailyProgress(filtered, settings, { now, prefiltered: true });
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
            .sort((a, b) => sortMistakeReviewDueCards(a, b, now)),
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
    const eligible = options.prefiltered
        ? positions
        : positions.filter((position) => isMistakeReviewDailyEligible(position, settings, now));
    const completedKeys = new Set<string>();
    const completedNewKeys = new Set<string>();
    for (const position of eligible) {
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

function sortMistakeReviewDueCards(a: Position, b: Position, now: Date) {
    return (
        getMistakeReviewSeverityWeight(b.mistakeReview?.severity) -
            getMistakeReviewSeverityWeight(a.mistakeReview?.severity) ||
        now.getTime() -
            new Date(b.card.due).getTime() -
            (now.getTime() - new Date(a.card.due).getTime())
    );
}

function sortMistakeReviewNewCards(a: Position, b: Position) {
    return (
        getMistakeReviewSeverityWeight(b.mistakeReview?.severity) -
            getMistakeReviewSeverityWeight(a.mistakeReview?.severity) ||
        (parseMistakeReviewDate(b.mistakeReview?.date)?.getTime() ?? 0) -
            (parseMistakeReviewDate(a.mistakeReview?.date)?.getTime() ?? 0)
    );
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
