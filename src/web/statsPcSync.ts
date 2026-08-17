import type { AnalyzedGameEntry } from "./statsStrength";
import type { StatsGame } from "./statsRating";

type PcStatsConfig = {
    accounts: { chesscom?: string; lichess?: string };
    historyDays?: number;
    depth?: number;
    nodesPerPosition?: number;
};

export type PcStatsStatus = {
    running: boolean;
    games: number;
    analyzedGames: number;
    gamesUpdatedAt: number;
    entriesUpdatedAt: number;
    status?: {
        state?: string;
        analysisComplete?: boolean;
        eligibleGames?: number;
        eligibleAnalyzedGames?: number;
        skippedGames?: number;
        failedGames?: number;
        queuedGames?: number;
        completedGames?: number;
    };
};

export async function loadPcStatsConfig(signal?: AbortSignal): Promise<PcStatsConfig | null> {
    const response = await fetch(`${pcStatsBase}/api/stats-sync/config`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as PcStatsConfig;
}

export async function loadPcStatsStatus(signal?: AbortSignal): Promise<PcStatsStatus | null> {
    const response = await fetch(`${pcStatsBase}/api/stats-sync/status`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as PcStatsStatus;
}

const pcStatsBase =
    window.location.hostname === "tauri.localhost" || window.location.hostname === "localhost"
        ? "http://127.0.0.1:8787"
        : "";

export async function loadPcAnalyzedEntries(signal?: AbortSignal): Promise<AnalyzedGameEntry[]> {
    const response = await fetch(`${pcStatsBase}/api/stats-sync/entries`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { entries?: AnalyzedGameEntry[] };
    return Array.isArray(payload.entries) ? payload.entries : [];
}

export async function loadPcStatsGames(signal?: AbortSignal): Promise<StatsGame[]> {
    const response = await fetch(`${pcStatsBase}/api/stats-sync/games`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { games?: StatsGame[] };
    return Array.isArray(payload.games) ? payload.games : [];
}

export async function loadPcProviderAccuracies(signal?: AbortSignal): Promise<Map<string, number>> {
    const response = await fetch(`${pcStatsBase}/api/stats-sync/accuracies`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
    });
    if (!response.ok) return new Map();
    const payload = (await response.json()) as {
        accuracies?: Array<{ url?: string | null; accuracy?: number | null }>;
    };
    const values = new Map<string, number>();
    for (const game of payload.accuracies || []) {
        if (game.url && typeof game.accuracy === "number" && Number.isFinite(game.accuracy)) {
            values.set(normalizeGameUrl(game.url), game.accuracy);
        }
    }
    return values;
}

export async function savePcAnalyzedEntries(entries: AnalyzedGameEntry[]): Promise<void> {
    if (!entries.length) return;
    const response = await fetch(`${pcStatsBase}/api/stats-sync/entries`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
    });
    if (!response.ok) throw new Error(`PC stats storage returned HTTP ${response.status}.`);
}

export async function configurePcStatsSync(config: PcStatsConfig): Promise<void> {
    const response = await fetch(`${pcStatsBase}/api/stats-sync/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error(`PC stats configuration returned HTTP ${response.status}.`);
}

export async function runPcStatsSync(signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${pcStatsBase}/api/stats-sync/run`, {
        method: "POST",
        headers: { accept: "application/json" },
        signal,
    });
    if (!response.ok) throw new Error(`PC stats analysis returned HTTP ${response.status}.`);
}

export function mergeAnalyzedEntries(
    ...groups: readonly AnalyzedGameEntry[][]
): AnalyzedGameEntry[] {
    const byKey = new Map<string, AnalyzedGameEntry>();
    for (const entries of groups) {
        for (const entry of entries) {
            const existing = byKey.get(entry.key);
            if (!existing || compareAnalyzedEntryQuality(entry, existing) >= 0) {
                byKey.set(entry.key, entry);
            }
        }
    }
    return Array.from(byKey.values()).sort((a, b) => b.end - a.end);
}

// A phone/manual result can have a newer timestamp while being much shallower
// than the saved PC batch. Analysis quality must win before recency so opening
// views, Strength, and the background worker all retain the 1M-node result.
export function compareAnalyzedEntryQuality(
    left: AnalyzedGameEntry,
    right: AnalyzedGameEntry,
): number {
    const leftQuality = analyzedEntryQuality(left);
    const rightQuality = analyzedEntryQuality(right);
    for (let index = 0; index < leftQuality.length; index += 1) {
        const difference = leftQuality[index] - rightQuality[index];
        if (difference !== 0) return difference;
    }
    return left.ts - right.ts;
}

export function isCompleteAnalyzedEntry(
    entry: AnalyzedGameEntry | undefined,
): entry is AnalyzedGameEntry & Required<Pick<AnalyzedGameEntry, "advanced" | "opponentQuality">> {
    return Boolean(entry?.advanced && entry.opponentQuality?.advanced);
}

function analyzedEntryQuality(entry: AnalyzedGameEntry): number[] {
    const batch = entry.batchAnalysis;
    return [
        batch ? 1 : 0,
        Math.max(0, Number(batch?.targetDepth) || 0),
        batch?.nodeLimit === null
            ? Number.MAX_SAFE_INTEGER
            : Math.max(0, Number(batch?.nodeLimit) || 0),
        isCompleteAnalyzedEntry(entry) ? 1 : 0,
        Math.max(0, Number(entry.stats.analysisDepth) || 0),
        Math.max(0, Number(entry.stats.scoredCount) || 0),
    ];
}

export function accuracyByGameUrl(entries: readonly AnalyzedGameEntry[]) {
    const values = new Map<string, number>();
    for (const entry of entries) {
        if (entry.url && entry.stats.accuracy != null)
            values.set(normalizeGameUrl(entry.url), entry.stats.accuracy);
    }
    return values;
}

function normalizeGameUrl(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/\/$/, "")
        .replace(/\/analysis(?:\/[^/]*)?$/, "");
}

export function findAccuracyForUrl(values: ReadonlyMap<string, number>, url: string) {
    return values.get(normalizeGameUrl(url)) ?? null;
}

export function mergeAccuracyMaps(
    fallback: ReadonlyMap<string, number>,
    preferred: ReadonlyMap<string, number>,
) {
    return new Map([...fallback, ...preferred]);
}
