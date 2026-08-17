import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    loadStatsAiReport,
    normalizeStatsAiReportResponse,
    saveStatsAiReport,
    type StatsAiReportResponse,
} from "../statsAiReport";

const STORAGE_KEY = "en-croissant-web-stats-ai-reports";

function createMemoryStorage(): Storage {
    const items = new Map<string, string>();
    return {
        get length() {
            return items.size;
        },
        clear: () => items.clear(),
        getItem: (key: string) => items.get(key) ?? null,
        key: (index: number) => [...items.keys()][index] ?? null,
        removeItem: (key: string) => {
            items.delete(key);
        },
        setItem: (key: string, value: string) => {
            items.set(key, value);
        },
    };
}

function makeReport(requestId: string, generatedAt: number): StatsAiReportResponse {
    return {
        requestId,
        model: "gpt-5.6-sol",
        generatedAt,
        report: {
            overview: `Report ${requestId}: you scored 52% over 42 blitz games.`,
            strengths: [
                { title: "Italian Game with White", detail: "72% score over 9 games." },
                { title: "Rating trend", detail: "+9.4 points per week." },
            ],
            weaknesses: [
                { title: "Sicilian with Black", detail: "41% score over 11 games." },
                { title: "Middlegame blunders", detail: "67% of blunders in the middlegame." },
            ],
            focusAreas: [
                {
                    title: "Fix the Black Sicilian",
                    detail: "It costs the most points right now.",
                    drill: "Review your six Sicilian losses this week.",
                },
                {
                    title: "Middlegame blunder checks",
                    detail: "10 of 15 blunders were middlegame.",
                    drill: "Blunder-check before every capture for 10 games.",
                },
            ],
            themes: ["losses cluster in time scrambles", "strong with White"],
        },
    };
}

describe("stats AI report localStorage cache", () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createMemoryStorage();
        vi.stubGlobal("localStorage", storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("round-trips a saved report by key", () => {
        const report = makeReport("stats-abc12345", 1_753_500_000_000);
        saveStatsAiReport("chesscom|loxty|blitz|1752969600", report);

        expect(loadStatsAiReport("chesscom|loxty|blitz|1752969600")).toEqual(report);
        expect(loadStatsAiReport("chesscom|loxty|blitz|9999999999")).toBeNull();
    });

    it("updates an existing key in place without duplicating entries", () => {
        saveStatsAiReport("key-a", makeReport("stats-first111", 1000));
        saveStatsAiReport("key-a", makeReport("stats-second22", 2000));

        expect(loadStatsAiReport("key-a")?.requestId).toBe("stats-second22");
        const store = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as {
            entries: Record<string, unknown>;
        };
        expect(Object.keys(store.entries)).toEqual(["key-a"]);
    });

    it("keeps at most 20 reports, evicting the oldest by generatedAt", () => {
        for (let index = 1; index <= 20; index += 1) {
            saveStatsAiReport(`key-${index}`, makeReport(`stats-entry-${index}`, index * 100));
        }
        saveStatsAiReport("key-21", makeReport("stats-entry-21", 2100));

        expect(loadStatsAiReport("key-1")).toBeNull();
        expect(loadStatsAiReport("key-2")).not.toBeNull();
        expect(loadStatsAiReport("key-21")?.requestId).toBe("stats-entry-21");
        const store = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as {
            entries: Record<string, unknown>;
        };
        expect(Object.keys(store.entries)).toHaveLength(20);
    });

    it("never evicts the report that was just saved, even when it is the oldest", () => {
        for (let index = 1; index <= 20; index += 1) {
            saveStatsAiReport(`key-${index}`, makeReport(`stats-entry-${index}`, 1000 + index));
        }
        saveStatsAiReport("key-old", makeReport("stats-oldcache", 1));

        expect(loadStatsAiReport("key-old")?.requestId).toBe("stats-oldcache");
        expect(loadStatsAiReport("key-1")).toBeNull();
        expect(loadStatsAiReport("key-2")).not.toBeNull();
    });

    it("returns null for corrupted stored JSON instead of throwing", () => {
        storage.setItem(STORAGE_KEY, "{not json");
        expect(loadStatsAiReport("key-a")).toBeNull();

        // A corrupted store is replaced on the next save.
        saveStatsAiReport("key-a", makeReport("stats-fresh123", 3000));
        expect(loadStatsAiReport("key-a")?.requestId).toBe("stats-fresh123");
    });

    it("drops entries that fail validation on load", () => {
        storage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                entries: {
                    "key-good": makeReport("stats-good1234", 4000),
                    "key-bad": { requestId: "stats-bad", generatedAt: 4001, report: null },
                    "key-empty-overview": {
                        ...makeReport("stats-empty123", 4002),
                        report: { ...makeReport("stats-empty123", 4002).report, overview: "  " },
                    },
                },
            }),
        );

        expect(loadStatsAiReport("key-good")?.requestId).toBe("stats-good1234");
        expect(loadStatsAiReport("key-bad")).toBeNull();
        expect(loadStatsAiReport("key-empty-overview")).toBeNull();
    });

    it("rejects stores from a different schema version", () => {
        storage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 2, entries: { "key-a": makeReport("stats-v2entry1", 1) } }),
        );
        expect(loadStatsAiReport("key-a")).toBeNull();
    });

    it("ignores storage write failures instead of throwing", () => {
        vi.stubGlobal("localStorage", {
            ...storage,
            setItem: () => {
                throw new Error("QuotaExceededError");
            },
        });
        expect(() => saveStatsAiReport("key-a", makeReport("stats-quota123", 5000))).not.toThrow();
    });

    it("is a no-op when localStorage is unavailable", () => {
        vi.stubGlobal("localStorage", undefined);
        expect(() => saveStatsAiReport("key-a", makeReport("stats-nostore1", 6000))).not.toThrow();
        expect(loadStatsAiReport("key-a")).toBeNull();
    });

    it("refuses to save an invalid report", () => {
        saveStatsAiReport("key-a", {
            requestId: "",
            model: null,
            generatedAt: 0,
            report: makeReport("stats-x", 1).report,
        });
        expect(storage.getItem(STORAGE_KEY)).toBeNull();
    });
});

describe("normalizeStatsAiReportResponse", () => {
    it("normalizes a server response and defaults a missing model to null", () => {
        const normalized = normalizeStatsAiReportResponse({
            requestId: " stats-abc12345 ",
            generatedAt: 1_753_500_000_000,
            report: makeReport("stats-x", 1).report,
        });
        expect(normalized?.requestId).toBe("stats-abc12345");
        expect(normalized?.model).toBeNull();
        expect(normalized?.report.focusAreas[0]?.drill).toBe(
            "Review your six Sicilian losses this week.",
        );
    });

    it("caps section and theme counts and drops incomplete sections", () => {
        const base = makeReport("stats-x", 1).report;
        const normalized = normalizeStatsAiReportResponse({
            requestId: "stats-abc12345",
            model: "gpt-5.6-sol",
            generatedAt: 10,
            report: {
                ...base,
                strengths: [
                    ...Array.from({ length: 6 }, (_, index) => ({
                        title: `Strength ${index + 1}`,
                        detail: "d",
                    })),
                    { title: "missing detail" },
                ],
                themes: ["a", "a", "b", "c", "d", "e", "f"],
            },
        });
        expect(normalized?.report.strengths).toHaveLength(4);
        expect(normalized?.report.themes).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("returns null when required report parts are missing", () => {
        const base = makeReport("stats-x", 1);
        expect(normalizeStatsAiReportResponse(null)).toBeNull();
        expect(normalizeStatsAiReportResponse({ ...base, report: null })).toBeNull();
        expect(
            normalizeStatsAiReportResponse({
                ...base,
                report: { ...base.report, weaknesses: [] },
            }),
        ).toBeNull();
        expect(normalizeStatsAiReportResponse({ ...base, generatedAt: "soon" })).toBeNull();
    });
});
