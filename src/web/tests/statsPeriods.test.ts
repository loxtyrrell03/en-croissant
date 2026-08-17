import { describe, expect, test } from "vitest";
import {
    getStatsPeriodDays,
    getStatsWindow,
    isStatsPeriodKey,
    STATS_PERIOD_OPTIONS,
} from "@/web/statsPeriods";

function sec(year: number, month: number, day: number, hour = 0, minute = 0) {
    return Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);
}

describe("stats periods", () => {
    test("offers short rolling windows without rounding to calendar days", () => {
        const now = sec(2026, 8, 6, 14, 30);
        expect(getStatsWindow("1h", now)).toEqual({
            start: now - 3600,
            end: now,
            label: "Last hour",
        });
        expect(getStatsWindow("6h", now).start).toBe(now - 6 * 3600);
        expect(getStatsWindow("24h", now).start).toBe(now - 24 * 3600);
        expect(getStatsWindow("3d", now).start).toBe(now - 3 * 86400);
    });

    test("anchors Today to local midnight", () => {
        const now = sec(2026, 8, 6, 14, 30);
        expect(getStatsWindow("today", now)).toEqual({
            start: sec(2026, 8, 6),
            end: now,
            label: "Today",
        });
    });

    test("supports an inclusive custom range and clamps it to the last year", () => {
        const now = sec(2026, 8, 6, 14, 30);
        const custom = getStatsWindow("custom", now, {
            start: "2026-05-03",
            end: "2026-06-11",
        });
        expect(custom.start).toBe(sec(2026, 5, 3));
        expect(custom.end).toBe(sec(2026, 6, 12) - 1);
        expect(custom.label).toContain("2026");

        const clamped = getStatsWindow("custom", now, {
            start: "2020-01-01",
            end: "2030-01-01",
        });
        expect(clamped.start).toBe(sec(2025, 8, 7));
        expect(clamped.end).toBe(now);
    });

    test("reports archive coverage and validates persisted choices", () => {
        expect(getStatsPeriodDays("1h")).toBe(1);
        // Calendar windows over-fetch one day so a 25-hour DST day cannot
        // trim the first games from Today/This week/Last week.
        expect(getStatsPeriodDays("today")).toBe(2);
        expect(getStatsPeriodDays("last-week")).toBe(15);
        expect(getStatsPeriodDays("custom")).toBe(365);
        expect(isStatsPeriodKey("24h")).toBe(true);
        expect(isStatsPeriodKey("fortnight-ish")).toBe(false);
        expect(STATS_PERIOD_OPTIONS.map((option) => option.value).slice(0, 5)).toEqual([
            "1h",
            "6h",
            "24h",
            "today",
            "3d",
        ]);
    });
});
