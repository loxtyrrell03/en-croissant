import type { AnalyzedGameEntry } from "./statsStrength";
import type { StatsGame } from "./statsRating";

type PcStatsConfig = {
    accounts: { chesscom?: string; lichess?: string };
    historyDays?: number;
    depth?: number;
    nodesPerPosition?: number;
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

export function mergeAnalyzedEntries(
    ...groups: readonly AnalyzedGameEntry[][]
): AnalyzedGameEntry[] {
    const byKey = new Map<string, AnalyzedGameEntry>();
    for (const entries of groups) {
        for (const entry of entries) {
            const existing = byKey.get(entry.key);
            if (!existing || entry.ts >= existing.ts) byKey.set(entry.key, entry);
        }
    }
    return Array.from(byKey.values()).sort((a, b) => b.end - a.end);
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
