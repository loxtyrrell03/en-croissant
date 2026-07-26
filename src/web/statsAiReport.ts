import { getWebServerUrl } from "./serverUrl";
import type { PeriodReport } from "./statsReport";

export type StatsAiReportSection = { title: string; detail: string; drill?: string };

export type StatsAiReport = {
    overview: string;
    strengths: StatsAiReportSection[];
    weaknesses: StatsAiReportSection[];
    focusAreas: StatsAiReportSection[];
    themes: string[];
};

export type StatsAiReportResponse = {
    requestId: string;
    model: string | null;
    report: StatsAiReport;
    generatedAt: number;
};

export type StatsAiReportRequestPayload = {
    requestId: string;
    periodLabel: string;
    source: "chesscom" | "lichess";
    username: string;
    timeClass: string;
    question?: string;
    aggregate: PeriodReport;
};

const STATS_AI_REPORT_STORAGE_KEY = "en-croissant-web-stats-ai-reports";
const MAX_SAVED_STATS_AI_REPORTS = 20;

export async function askStatsAiReport({
    payload,
    signal,
}: {
    payload: StatsAiReportRequestPayload;
    signal?: AbortSignal;
}): Promise<StatsAiReportResponse> {
    // The PC report generation is a long-running model call (240s+ server
    // timeouts, like the coach) — never add a client timeout, only the signal.
    const response = await fetch(getWebServerUrl("api/chess-coach/stats-report"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const error = asRecord(body)?.error;
        throw new Error(typeof error === "string" && error ? error : "The PC stats coach failed.");
    }
    const normalized = normalizeStatsAiReportResponse(body);
    if (!normalized) throw new Error("The PC returned an unreadable stats report.");
    return normalized;
}

export function saveStatsAiReport(key: string, value: StatsAiReportResponse): void {
    const storage = getStatsAiReportStorage();
    const normalized = normalizeStatsAiReportResponse(value);
    if (!storage || !key || !normalized) return;
    const entries = readStatsAiReportEntries(storage);
    entries[key] = normalized;
    const staleKeys = Object.keys(entries)
        .filter((entryKey) => entryKey !== key)
        .sort((left, right) => entries[left].generatedAt - entries[right].generatedAt);
    while (Object.keys(entries).length > MAX_SAVED_STATS_AI_REPORTS && staleKeys.length > 0) {
        delete entries[staleKeys.shift() as string];
    }
    try {
        storage.setItem(STATS_AI_REPORT_STORAGE_KEY, JSON.stringify({ version: 1, entries }));
    } catch {
        // Quota or privacy-mode storage failures must never break the report UI.
    }
}

export function loadStatsAiReport(key: string): StatsAiReportResponse | null {
    const storage = getStatsAiReportStorage();
    if (!storage || !key) return null;
    return readStatsAiReportEntries(storage)[key] ?? null;
}

export function normalizeStatsAiReportResponse(value: unknown): StatsAiReportResponse | null {
    const record = asRecord(value);
    if (!record) return null;
    const requestId = cleanString(record.requestId);
    const generatedAt = finiteNumber(record.generatedAt);
    const report = normalizeStatsAiReport(record.report);
    if (!requestId || generatedAt <= 0 || !report) return null;
    return {
        requestId,
        model: cleanString(record.model) || null,
        report,
        generatedAt,
    };
}

export function normalizeStatsAiReport(value: unknown): StatsAiReport | null {
    const record = asRecord(value);
    if (!record) return null;
    const overview = cleanString(record.overview);
    const strengths = normalizeStatsAiReportSections(record.strengths, 4);
    const weaknesses = normalizeStatsAiReportSections(record.weaknesses, 4);
    const focusAreas = normalizeStatsAiReportSections(record.focusAreas, 3);
    if (!overview || strengths.length === 0 || weaknesses.length === 0 || focusAreas.length === 0) {
        return null;
    }
    const themes: string[] = [];
    for (const theme of Array.isArray(record.themes) ? record.themes : []) {
        const cleaned = cleanString(theme);
        if (!cleaned || themes.includes(cleaned) || themes.length >= 5) continue;
        themes.push(cleaned);
    }
    return { overview, strengths, weaknesses, focusAreas, themes };
}

function normalizeStatsAiReportSections(value: unknown, limit: number): StatsAiReportSection[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).flatMap((item): StatsAiReportSection[] => {
        const section = asRecord(item);
        if (!section) return [];
        const title = cleanString(section.title);
        const detail = cleanString(section.detail);
        if (!title || !detail) return [];
        const drill = cleanString(section.drill);
        return [drill ? { title, detail, drill } : { title, detail }];
    });
}

function readStatsAiReportEntries(storage: Storage): Record<string, StatsAiReportResponse> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(storage.getItem(STATS_AI_REPORT_STORAGE_KEY) ?? "null");
    } catch {
        return {};
    }
    const store = asRecord(parsed);
    const rawEntries = asRecord(store?.entries);
    if (store?.version !== 1 || !rawEntries) return {};
    const entries: Record<string, StatsAiReportResponse> = {};
    for (const [key, value] of Object.entries(rawEntries)) {
        const normalized = normalizeStatsAiReportResponse(value);
        if (key && normalized) entries[key] = normalized;
    }
    return entries;
}

function getStatsAiReportStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function cleanString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
