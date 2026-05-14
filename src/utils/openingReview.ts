import { basename, resolve } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ReviewLog } from "ts-fsrs";
import { z } from "zod";
import { getStats, type Position } from "@/components/files/opening";

const openingHealthDateRangeSchema = z.enum([
    "all",
    "3months",
    "6months",
    "year",
    "2years",
    "5years",
    "custom",
]);

export const OPENING_REVIEW_EXTENSION = ".opening-review.json";
export const OPENING_REVIEW_VERSION = 1;

export type OpeningReviewGamePeriod =
    | "all"
    | "week"
    | "2weeks"
    | "month"
    | "3months"
    | "6months"
    | "year";

export type OpeningReviewDailySettings = {
    reviewsPerDay: number;
    newItemsPerDay: number;
    gamePeriod: OpeningReviewGamePeriod;
    minUrgency: number;
    includeWhite: boolean;
    includeBlack: boolean;
};

export const DEFAULT_OPENING_REVIEW_DAILY_SETTINGS: OpeningReviewDailySettings = {
    reviewsPerDay: 40,
    newItemsPerDay: 10,
    gamePeriod: "all",
    minUrgency: 0,
    includeWhite: true,
    includeBlack: true,
};

const openingReviewAutoUpdateConfigSchema = z.object({
    enabled: z.boolean().default(false),
    playerDb: z.string(),
    playerId: z.number().nullable().optional(),
    playerName: z.string().nullable().optional(),
    referenceDb: z.string(),
    mode: z.enum(["self", "opponent"]).default("self"),
    color: z.enum(["any", "white", "black"]).default("any"),
    maxPlies: z.number().default(30),
    minPlayerGames: z.number().default(3),
    minReferenceGames: z.number().default(20),
    topReferenceMoves: z.number().default(3),
    dateRange: openingHealthDateRangeSchema.default("all"),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    maxPositions: z.number().optional(),
    limit: z.number().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    lastRunAt: z.number().nullable().optional(),
    lastUpdatedDatabaseAt: z.number().nullable().optional(),
    lastKnownGameCount: z.number().nullable().optional(),
    lastAdded: z.number().nullable().optional(),
    lastError: z.string().nullable().optional(),
});

const savedReviewPositionsSchema = z.custom<Position[]>((value) => Array.isArray(value), {
    message: "Expected review positions array",
});

const savedReviewLogsSchema = z
    .custom<(ReviewLog & { fen: string })[] | undefined>(
        (value) => value === undefined || Array.isArray(value),
        { message: "Expected review logs array" },
    )
    .transform((value) => value ?? []);

const openingReviewDailySettingsSchema = z.object({
    reviewsPerDay: z.number().default(DEFAULT_OPENING_REVIEW_DAILY_SETTINGS.reviewsPerDay),
    newItemsPerDay: z.number().default(DEFAULT_OPENING_REVIEW_DAILY_SETTINGS.newItemsPerDay),
    gamePeriod: z
        .enum(["all", "week", "2weeks", "month", "3months", "6months", "year"])
        .default(DEFAULT_OPENING_REVIEW_DAILY_SETTINGS.gamePeriod),
    minUrgency: z.number().default(DEFAULT_OPENING_REVIEW_DAILY_SETTINGS.minUrgency),
    includeWhite: z.boolean().default(DEFAULT_OPENING_REVIEW_DAILY_SETTINGS.includeWhite),
    includeBlack: z.boolean().default(DEFAULT_OPENING_REVIEW_DAILY_SETTINGS.includeBlack),
});

const openingReviewDeckSchema = z.object({
    version: z.literal(OPENING_REVIEW_VERSION).optional(),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    mode: z.enum(["self", "opponent"]).optional(),
    source: z.string().optional(),
    autoUpdate: openingReviewAutoUpdateConfigSchema.optional(),
    daily: openingReviewDailySettingsSchema.default(DEFAULT_OPENING_REVIEW_DAILY_SETTINGS),
    positions: savedReviewPositionsSchema,
    logs: savedReviewLogsSchema,
});

export type OpeningReviewAutoUpdateConfig = z.infer<typeof openingReviewAutoUpdateConfigSchema>;

export type OpeningReviewDeck = {
    version: typeof OPENING_REVIEW_VERSION;
    name: string;
    createdAt: number;
    updatedAt: number;
    mode?: "self" | "opponent";
    source?: string;
    autoUpdate?: OpeningReviewAutoUpdateConfig;
    daily: OpeningReviewDailySettings;
    positions: Position[];
    logs: (ReviewLog & { fen: string })[];
};

export type OpeningReviewDailyProgress = {
    dateKey: string;
    target: number;
    completed: number;
    completedNew: number;
    remaining: number;
    newRemaining: number;
};

export type OpeningReviewDeckSummary = {
    path: string;
    name: string;
    updatedAt: number;
    total: number;
    due: number;
    unseen: number;
    mode?: "self" | "opponent";
    source?: string;
    autoUpdate?: OpeningReviewAutoUpdateConfig;
};

export async function readOpeningReviewDeck(path: string): Promise<OpeningReviewDeck> {
    const raw = await readTextFile(path);
    const parsed = openingReviewDeckSchema.parse(JSON.parse(raw));
    return {
        version: OPENING_REVIEW_VERSION,
        ...parsed,
        positions: parsed.positions as unknown as Position[],
        logs: parsed.logs as unknown as OpeningReviewDeck["logs"],
    };
}

export async function writeOpeningReviewDeck(path: string, deck: OpeningReviewDeck) {
    const updatedDeck: OpeningReviewDeck = {
        ...deck,
        version: OPENING_REVIEW_VERSION,
        updatedAt: Date.now(),
    };
    await writeTextFile(path, `${JSON.stringify(updatedDeck, null, 2)}\n`);
    return updatedDeck;
}

export async function deleteOpeningReviewDeck(path: string) {
    await remove(path);
}

export async function listOpeningReviewDecks(
    directory: string,
): Promise<OpeningReviewDeckSummary[]> {
    const entries = await readDir(directory).catch(() => []);
    const decks: OpeningReviewDeckSummary[] = [];

    for (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith(OPENING_REVIEW_EXTENSION)) continue;

        const path = await resolve(directory, entry.name);
        try {
            const deck = await readOpeningReviewDeck(path);
            const stats = getStats(deck.positions);
            decks.push({
                path,
                name: deck.name,
                updatedAt: deck.updatedAt,
                total: stats.total,
                due: stats.due,
                unseen: stats.unseen,
                mode: deck.mode,
                source: deck.source,
                autoUpdate: deck.autoUpdate,
            });
        } catch {
            // Ignore malformed review files so one broken deck does not hide the rest.
        }
    }

    return decks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAvailableOpeningReviewDeckPath(directory: string, name: string) {
    const safeName = sanitizeOpeningReviewFileName(name || "Opening Review");
    let path = await resolve(directory, `${safeName}${OPENING_REVIEW_EXTENSION}`);
    let index = 2;

    while (await exists(path)) {
        path = await resolve(directory, `${safeName} ${index}${OPENING_REVIEW_EXTENSION}`);
        index += 1;
    }

    return path;
}

export async function getOpeningReviewDisplayName(path: string) {
    const fileName = await basename(path);
    return fileName.replace(OPENING_REVIEW_EXTENSION, "");
}

export function createOpeningReviewDeck({
    name,
    mode,
    source,
    autoUpdate,
    daily,
    positions,
}: {
    name: string;
    mode?: "self" | "opponent";
    source?: string;
    autoUpdate?: OpeningReviewAutoUpdateConfig;
    daily?: Partial<OpeningReviewDailySettings>;
    positions: Position[];
}): OpeningReviewDeck {
    const now = Date.now();
    return {
        version: OPENING_REVIEW_VERSION,
        name,
        createdAt: now,
        updatedAt: now,
        mode,
        source,
        autoUpdate,
        daily: {
            ...DEFAULT_OPENING_REVIEW_DAILY_SETTINGS,
            ...daily,
        },
        positions,
        logs: [],
    };
}

export function mergeOpeningReviewPositions(
    existing: OpeningReviewDeck,
    incoming: Position[],
): OpeningReviewDeck {
    const existingByKey = new Map(
        existing.positions.map((position) => [reviewPositionKey(position), position]),
    );
    const incomingKeys = new Set<string>();
    const merged: Position[] = [];

    for (const position of incoming) {
        const key = reviewPositionKey(position);
        incomingKeys.add(key);
        const previous = existingByKey.get(key);
        const openingHealth =
            previous?.openingHealth?.openingName && !position.openingHealth?.openingName
                ? {
                      ...position.openingHealth,
                      openingName: previous.openingHealth.openingName,
                  }
                : position.openingHealth;
        merged.push(
            previous
                ? {
                      ...position,
                      openingHealth,
                      card: previous.card,
                      comment: previous.comment,
                      annotations: previous.annotations,
                      shapes: previous.shapes,
                      reviewTree: previous.reviewTree,
                      openingReview: mergeOpeningReviewAttemptMetadata(previous, position),
                      importedAt: previous.importedAt ?? position.importedAt,
                  }
                : position,
        );
    }

    for (const position of existing.positions) {
        if (!incomingKeys.has(reviewPositionKey(position))) {
            merged.push(position);
        }
    }

    return {
        ...existing,
        positions: merged,
        updatedAt: Date.now(),
    };
}

export function reviewPositionKey(position: Position) {
    return position.reviewKey || `${position.fen}|${position.answerUci || position.answer}`;
}

export function getOpeningReviewDailyBatch(
    positions: Position[],
    settings: OpeningReviewDailySettings,
    options: { now?: Date; extra?: boolean } = {},
) {
    const now = options.now ?? new Date();
    const filtered = positions.filter((position) =>
        isOpeningReviewDailyEligible(position, settings, now),
    );
    const progress = getOpeningReviewDailyProgress(positions, settings, { now });
    const attemptedTodayKeys = new Set(
        filtered
            .filter((position) => wasOpeningReviewAttemptedOnDay(position, now))
            .map(openingReviewDailyPositionKey),
    );
    const unseenToday = filtered.filter(
        (position) =>
            !wasOpeningReviewAttemptedOnDay(position, now) &&
            !attemptedTodayKeys.has(openingReviewDailyPositionKey(position)),
    );
    const due = uniqueOpeningReviewDailyPositions(
        unseenToday
            .filter((position) => position.card.reps > 0 && new Date(position.card.due) <= now)
            .sort(sortOpeningReviewDueCards),
    );
    const fresh = uniqueOpeningReviewDailyPositions(
        unseenToday.filter((position) => position.card.reps === 0).sort(sortOpeningReviewNewCards),
        new Set(due.map(openingReviewDailyPositionKey)),
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

function uniqueOpeningReviewDailyPositions(positions: Position[], seen = new Set<string>()) {
    const unique: Position[] = [];
    for (const position of positions) {
        const key = openingReviewDailyPositionKey(position);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(position);
    }
    return unique;
}

function openingReviewDailyPositionKey(position: Position) {
    return position.fen.split(/\s+/).slice(0, 4).join(" ");
}

export function getOpeningReviewDailyProgress(
    positions: Position[],
    settings: OpeningReviewDailySettings,
    options: { now?: Date; prefiltered?: boolean } = {},
): OpeningReviewDailyProgress {
    const now = options.now ?? new Date();
    const completedKeys = new Set<string>();
    const completedNewKeys = new Set<string>();
    for (const position of positions) {
        if (!wasOpeningReviewAttemptedOnDay(position, now)) continue;
        const key = openingReviewDailyPositionKey(position);
        completedKeys.add(key);
        if (getOpeningReviewAttemptedCardReps(position) === 0) {
            completedNewKeys.add(key);
        }
    }
    const completed = completedKeys.size;
    const completedNew = completedNewKeys.size;
    const target = Math.max(0, settings.reviewsPerDay);
    const newTarget = Math.max(0, settings.newItemsPerDay);

    return {
        dateKey: getOpeningReviewLocalDateKey(now),
        target,
        completed,
        completedNew,
        remaining: Math.max(0, target - completed),
        newRemaining: Math.max(0, newTarget - completedNew),
    };
}

function mergeOpeningReviewAttemptMetadata(
    previous: Position,
    incoming: Position,
): Position["openingReview"] {
    const previousAttemptedAt = previous.openingReview?.lastAttemptedAt ?? 0;
    const incomingAttemptedAt = incoming.openingReview?.lastAttemptedAt ?? 0;
    const latest = previousAttemptedAt >= incomingAttemptedAt ? previous : incoming;

    return latest.openingReview ?? previous.openingReview ?? incoming.openingReview;
}

function wasOpeningReviewAttemptedOnDay(position: Position, day: Date) {
    const attemptedAt = getOpeningReviewLastAttemptedAt(position);
    return (
        attemptedAt !== null &&
        getOpeningReviewLocalDateKey(new Date(attemptedAt)) === getOpeningReviewLocalDateKey(day)
    );
}

function getOpeningReviewLastAttemptedAt(position: Position) {
    return (
        position.openingReview?.lastAttemptedAt ??
        parseOpeningReviewTimestamp(position.card.last_review)
    );
}

function getOpeningReviewAttemptedCardReps(position: Position) {
    const trackedReps = position.openingReview?.lastAttemptedCardReps;
    if (trackedReps !== undefined) return trackedReps;

    const attemptedAt = parseOpeningReviewTimestamp(position.card.last_review);
    if (attemptedAt !== null && position.card.reps <= 1) return 0;
    return position.card.reps;
}

function isOpeningReviewDailyEligible(
    position: Position,
    settings: OpeningReviewDailySettings,
    now: Date,
) {
    if (getOpeningReviewPositionUrgency(position) < settings.minUrgency) return false;

    const side = getOpeningReviewMoveSide(position);
    if (side === "white" && !settings.includeWhite) return false;
    if (side === "black" && !settings.includeBlack) return false;

    if (settings.gamePeriod === "all") return true;

    const lastPlayed = parseOpeningReviewDate(position.openingHealth?.lastPlayed);
    if (!lastPlayed) return false;
    const cutoff = getOpeningReviewPeriodCutoff(settings.gamePeriod, now);
    return lastPlayed >= cutoff;
}

function sortOpeningReviewDueCards(a: Position, b: Position) {
    return (
        getOpeningReviewPositionUrgency(b) - getOpeningReviewPositionUrgency(a) ||
        getOpeningReviewLastPlayedTime(b) - getOpeningReviewLastPlayedTime(a) ||
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime()
    );
}

function sortOpeningReviewNewCards(a: Position, b: Position) {
    return (
        getOpeningReviewPositionUrgency(b) - getOpeningReviewPositionUrgency(a) ||
        getOpeningReviewLastPlayedTime(b) - getOpeningReviewLastPlayedTime(a) ||
        (b.importedAt ?? 0) - (a.importedAt ?? 0)
    );
}

function getOpeningReviewLastPlayedTime(position: Position) {
    return parseOpeningReviewDate(position.openingHealth?.lastPlayed)?.getTime() ?? 0;
}

function getOpeningReviewPositionUrgency(position: Position) {
    const priority = position.priority ?? 0;
    if (priority > 1) return clampOpeningReviewNumber(Math.round(priority), 0, 100);
    return clampOpeningReviewNumber(Math.round(priority * 100), 0, 100);
}

function getOpeningReviewMoveSide(position: Position): "white" | "black" {
    const rawSide =
        position.openingHealth?.reviewSide ??
        position.openingHealth?.sideToMove ??
        position.sideToMove ??
        (position.fen.split(/\s+/)[1] === "b" ? "black" : "white");
    return rawSide === "black" ? "black" : "white";
}

function getOpeningReviewPeriodCutoff(period: OpeningReviewGamePeriod, now: Date) {
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

function getOpeningReviewLocalDateKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseOpeningReviewTimestamp(value: unknown) {
    if (!value) return null;
    const timestamp =
        value instanceof Date
            ? value.getTime()
            : typeof value === "number"
              ? value
              : Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
}

function parseOpeningReviewDate(value?: string | null) {
    const match = value?.match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || !month || !day) return null;

    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function clampOpeningReviewNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function sanitizeOpeningReviewFileName(name: string) {
    const cleaned = name
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || "Opening Review";
}
