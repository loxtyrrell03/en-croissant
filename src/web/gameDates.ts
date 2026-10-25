import {
    ALL_GAME_DATES,
    GAME_DATE_PERIODS,
    gameDateBounds,
    isGameDateRange,
    storedGameDateRange,
    type GameDateRange,
} from "@/utils/gameDateRange";
import type { WebExplorerOptions } from "./explorer";
import type { WebPrepMode, WebPrepSource } from "./model";

export type PhoneGameDateRanges = Record<string, GameDateRange>;
export type PhoneGameDateScope = "database" | "prep";

export function phonePrepDateKey(mode?: WebPrepMode, source?: WebPrepSource) {
    return `${mode ?? "player"}:${source ?? "local"}`;
}

export function legacyPhoneDatabaseDates(
    local: { startDate?: string; endDate?: string },
    options: WebExplorerOptions,
): PhoneGameDateRanges {
    return {
        local: storedGameDateRange(undefined, local.startDate, local.endDate),
        "lichess-all": storedGameDateRange(
            options.lichess.dateRange,
            options.lichess.since,
            options.lichess.until,
        ),
        "lichess-masters": storedGameDateRange(
            options.masters.dateRange,
            options.masters.since,
            options.masters.until,
        ),
    };
}

export function legacyPhonePrepDates(
    local: { startDate?: string; endDate?: string },
    options: WebExplorerOptions,
): PhoneGameDateRanges {
    const sources = legacyPhoneDatabaseDates(local, options);
    sources.temporary = { ...sources.local };
    return Object.fromEntries(
        (["player", "general"] as const).flatMap((mode) =>
            Object.entries(sources).map(([source, range]) => [
                phonePrepDateKey(mode, source as WebPrepSource),
                { ...range },
            ]),
        ),
    );
}

export function applyPhoneExplorerGameDates<
    T extends { dateRange?: GameDateRange; since?: string; until?: string },
>(options: T, precision: "month" | "year", now = new Date()): T {
    if (options.dateRange === undefined) return options;
    const bounds = gameDateBounds(options.dateRange, precision, now);
    return { ...options, since: bounds.since, until: bounds.until };
}

export function displayPhoneExplorerGameDates<
    T extends { dateRange?: GameDateRange; since?: string; until?: string },
>(options: T, precision: "month" | "year", now = new Date()): T {
    try {
        return applyPhoneExplorerGameDates(options, precision, now);
    } catch {
        return options;
    }
}

type PrepDates = {
    mode?: WebPrepMode;
    source?: WebPrepSource;
    dateRanges?: PhoneGameDateRanges;
    startDate?: string;
    endDate?: string;
};
export function resolvePhonePrepGameDates<T extends PrepDates>(
    prep: T,
    now = new Date(),
): T & { startDate?: string; endDate?: string } {
    if (prep.dateRanges === undefined) return prep;
    const range = prep.dateRanges[phonePrepDateKey(prep.mode, prep.source)] ?? ALL_GAME_DATES;
    const bounds = gameDateBounds(range, "day", now);
    return { ...prep, startDate: bounds.since, endDate: bounds.until };
}

export function phonePrepGameDatesValid(prep: PrepDates) {
    return isGameDateRange(
        prep.dateRanges === undefined
            ? storedGameDateRange(undefined, prep.startDate, prep.endDate)
            : (prep.dateRanges[phonePrepDateKey(prep.mode, prep.source)] ?? ALL_GAME_DATES),
    );
}

export function displayPhonePrepGameDates<T extends PrepDates>(prep: T, now = new Date()): T {
    return phonePrepGameDatesValid(prep) ? resolvePhonePrepGameDates(prep, now) : prep;
}

/** Keep recognizable but invalid selections repairable. Query validation is stricter. */
export function validPhoneGameDateRanges(value: unknown): value is PhoneGameDateRanges | undefined {
    return (
        value === undefined ||
        (!!value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            Object.values(value).every(
                (range) =>
                    range &&
                    typeof range === "object" &&
                    GAME_DATE_PERIODS.some(([period]) => period === range.period) &&
                    typeof range.since === "string" &&
                    typeof range.until === "string",
            ))
    );
}
