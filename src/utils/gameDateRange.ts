/** Calendar selections, independent of a source's day/month/year resolution. */
export const GAME_DATE_PERIODS = [
    ["all", "All time"],
    ["1m", "Last month"],
    ["3m", "Last 3 months"],
    ["6m", "Last 6 months"],
    ["1y", "Last year"],
    ["2y", "Last 2 years"],
    ["5y", "Last 5 years"],
    ["custom", "Custom range…"],
] as const;
export type GameDatePeriod = (typeof GAME_DATE_PERIODS)[number][0];
export type GameDatePrecision = "day" | "month" | "year";
export type GameDateRange = { period: GameDatePeriod; since: string; until: string };
export const ALL_GAME_DATES: GameDateRange = { period: "all", since: "", until: "" };
type LegacyDate = string | Date | undefined | null;

export function calendarDate(date: Date): string {
    if (!Number.isFinite(date.getTime())) return "";
    return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function daysInMonth(year: number, month: number) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}
export function isCalendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}
export function expandGameDateBound(raw: LegacyDate, end = false): string {
    if (raw instanceof Date) return calendarDate(raw);
    if (!raw) return "";
    const value = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return calendarDate(new Date(value));
    const match = /^(\d{4})(?:[.-](\d{1,2})(?:[.-](\d{1,2}))?)?$/.exec(value);
    if (!match) return "";
    const year = Number(match[1]),
        month = Number(match[2] ?? (end ? 12 : 1));
    const day = Number(match[3] ?? (end ? daysInMonth(year, month) : 1));
    const date = `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isCalendarDate(date) ? date : "";
}
export function validCustomGameDates(since: string, until: string): boolean {
    return (
        (!since || isCalendarDate(since)) &&
        (!until || isCalendarDate(until)) &&
        (!since || !until || since <= until)
    );
}
export function isGameDateRange(raw: unknown): raw is GameDateRange {
    if (!raw || typeof raw !== "object") return false;
    const value = raw as GameDateRange;
    return (
        GAME_DATE_PERIODS.some(([period]) => period === value.period) &&
        typeof value.since === "string" &&
        typeof value.until === "string" &&
        (value.period === "custom"
            ? validCustomGameDates(value.since, value.until)
            : value.since === "" && value.until === "")
    );
}
export function normalizeGameDateRange(
    raw: unknown,
    legacySince?: LegacyDate,
    legacyUntil?: LegacyDate,
): GameDateRange {
    if (isGameDateRange(raw)) return raw;
    const since = expandGameDateBound(legacySince),
        until = expandGameDateBound(legacyUntil, true);
    return (since || until) && validCustomGameDates(since, until)
        ? { period: "custom", since, until }
        : ALL_GAME_DATES;
}
/** Invalid stored filters stay repairable; they must not silently become All time. */
export function storedGameDateRange(
    raw: GameDateRange | undefined,
    legacySince?: LegacyDate,
    legacyUntil?: LegacyDate,
): GameDateRange {
    if (raw !== undefined) return raw;
    const since = expandGameDateBound(legacySince),
        until = expandGameDateBound(legacyUntil, true);
    if ((legacySince && !since) || (legacyUntil && !until) || !validCustomGameDates(since, until)) {
        const text = (value: LegacyDate) =>
            value instanceof Date
                ? calendarDate(value) || "Invalid date"
                : (value?.trim().replaceAll(".", "-") ?? "");
        return {
            period: "custom",
            since: since || text(legacySince),
            until: until || text(legacyUntil),
        };
    }
    return normalizeGameDateRange(undefined, legacySince, legacyUntil);
}
export function gameDateBounds(
    range: GameDateRange,
    precision: GameDatePrecision = "day",
    now = new Date(),
): { since?: string; until?: string } {
    if (!isGameDateRange(range))
        throw new Error(
            "The saved date range is invalid. Choose valid dates; the saved selection has been preserved.",
        );
    if (range.period === "all") return {};
    let { since, until } = range;
    if (range.period !== "custom") {
        const months = Number(range.period.slice(0, -1)) * (range.period.endsWith("y") ? 12 : 1);
        const start = new Date(now);
        start.setHours(12, 0, 0, 0);
        start.setDate(1);
        start.setMonth(start.getMonth() - months);
        start.setDate(
            Math.min(now.getDate(), daysInMonth(start.getFullYear(), start.getMonth() + 1)),
        );
        since = calendarDate(start);
        until = calendarDate(now);
    }
    const format = (value: string) =>
        value
            ? precision === "day"
                ? value.replaceAll("-", ".")
                : value.slice(0, precision === "month" ? 7 : 4)
            : undefined;
    return { since: format(since), until: format(until) };
}
export function applyLocalGameDates<
    T extends { dateRange?: GameDateRange; start_date?: string; end_date?: string },
>(options: T, now = new Date()): T {
    if (options.dateRange === undefined) return options;
    const bounds = gameDateBounds(options.dateRange, "day", now);
    return { ...options, start_date: bounds.since, end_date: bounds.until };
}
export function applyExplorerGameDates<
    T extends { dateRange?: GameDateRange; since?: Date; until?: Date },
>(options: T, precision: "month" | "year", now = new Date()): T {
    const range = options.dateRange;
    const bounds = range === undefined ? null : gameDateBounds(range, precision, now);
    const revive = (value: LegacyDate, end: boolean) => {
        if (!value) return undefined;
        if (!bounds && value instanceof Date && Number.isFinite(value.getTime())) return value;
        if (!bounds && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
            const date = new Date(value);
            if (Number.isFinite(date.getTime())) return date;
        }
        const date = expandGameDateBound(value, end);
        if (!date) throw new Error("The saved explorer date is invalid. Choose valid dates.");
        return new Date(`${date}T12:00:00`);
    };
    return {
        ...options,
        since: revive(bounds ? bounds.since : options.since, false),
        until: revive(bounds ? bounds.until : options.until, true),
    };
}

/** Keep controls mounted for repair. Transport functions remain strict. */
export function displayLocalGameDates<
    T extends { dateRange?: GameDateRange; start_date?: string; end_date?: string },
>(options: T, now = new Date()): T {
    try {
        return applyLocalGameDates(options, now);
    } catch {
        return options;
    }
}
export function displayExplorerGameDates<
    T extends { dateRange?: GameDateRange; since?: Date; until?: Date },
>(options: T, precision: "month" | "year", now = new Date()): T {
    try {
        return applyExplorerGameDates(options, precision, now);
    } catch {
        return options;
    }
}
