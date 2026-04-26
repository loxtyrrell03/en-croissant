import { basename, resolve } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ReviewLog } from "ts-fsrs";
import { z } from "zod";
import { getStats, type Position, positionSchema } from "@/components/files/opening";

export const OPENING_REVIEW_EXTENSION = ".opening-review.json";
export const OPENING_REVIEW_VERSION = 1;

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

const reviewLogSchema = z
    .object({
        fen: z.string(),
    })
    .passthrough();

const openingReviewDeckSchema = z.object({
    version: z.literal(OPENING_REVIEW_VERSION).optional(),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    mode: z.enum(["self", "opponent"]).optional(),
    source: z.string().optional(),
    autoUpdate: openingReviewAutoUpdateConfigSchema.optional(),
    positions: positionSchema.array(),
    logs: reviewLogSchema.array().default([]),
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
    positions: Position[];
    logs: (ReviewLog & { fen: string })[];
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
    positions,
}: {
    name: string;
    mode?: "self" | "opponent";
    source?: string;
    autoUpdate?: OpeningReviewAutoUpdateConfig;
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
        merged.push(
            previous
                ? {
                      ...position,
                      card: previous.card,
                      comment: previous.comment,
                      annotations: previous.annotations,
                      shapes: previous.shapes,
                      reviewTree: previous.reviewTree,
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

function sanitizeOpeningReviewFileName(name: string) {
    const cleaned = name
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || "Opening Review";
}
