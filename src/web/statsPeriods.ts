import { getWeekWindow } from "./statsReport";

export type StatsPeriodKey =
    | "1h"
    | "6h"
    | "24h"
    | "today"
    | "3d"
    | "week"
    | "last-week"
    | "7"
    | "14"
    | "30"
    | "90"
    | "180"
    | "365";

export type StatsWindow = { start: number; end: number; label: string };

type StatsPeriodOption = {
    value: StatsPeriodKey;
    label: string;
    coverageDays: number;
    durationSeconds?: number;
};

export const STATS_PERIOD_OPTIONS: StatsPeriodOption[] = [
    { value: "1h", label: "Last hour", coverageDays: 1, durationSeconds: 3600 },
    { value: "6h", label: "Last 6 hours", coverageDays: 1, durationSeconds: 6 * 3600 },
    { value: "24h", label: "Last 24 hours", coverageDays: 1, durationSeconds: 24 * 3600 },
    { value: "today", label: "Today", coverageDays: 2 },
    { value: "3d", label: "Last 3 days", coverageDays: 3, durationSeconds: 3 * 86400 },
    { value: "week", label: "This week", coverageDays: 8 },
    { value: "last-week", label: "Last week", coverageDays: 15 },
    { value: "7", label: "7 days", coverageDays: 7, durationSeconds: 7 * 86400 },
    { value: "14", label: "14 days", coverageDays: 14, durationSeconds: 14 * 86400 },
    { value: "30", label: "30 days", coverageDays: 30, durationSeconds: 30 * 86400 },
    { value: "90", label: "3 months", coverageDays: 90, durationSeconds: 90 * 86400 },
    { value: "180", label: "6 months", coverageDays: 180, durationSeconds: 180 * 86400 },
    { value: "365", label: "1 year", coverageDays: 365, durationSeconds: 365 * 86400 },
];

export function isStatsPeriodKey(value: unknown): value is StatsPeriodKey {
    return STATS_PERIOD_OPTIONS.some((option) => option.value === value);
}

export function getStatsPeriodDays(period: StatsPeriodKey): number {
    return STATS_PERIOD_OPTIONS.find((option) => option.value === period)?.coverageDays ?? 30;
}

export function getStatsWindow(period: StatsPeriodKey, nowSec: number): StatsWindow {
    if (period === "week") return getWeekWindow(0, nowSec);
    if (period === "last-week") return getWeekWindow(-1, nowSec);
    if (period === "today") {
        const now = new Date(nowSec * 1000);
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return {
            start: Math.floor(start.getTime() / 1000),
            end: nowSec,
            label: "Today",
        };
    }

    const option = STATS_PERIOD_OPTIONS.find((entry) => entry.value === period);
    const durationSeconds = option?.durationSeconds ?? 30 * 86400;
    return {
        start: nowSec - durationSeconds,
        end: nowSec,
        label: option?.label ?? "Last 30 days",
    };
}
