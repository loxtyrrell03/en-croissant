import { ALL_GAME_DATES, storedGameDateRange, type GameDateRange } from "./gameDateRange";
import type { LichessGamesOptions, MasterGamesOptions } from "./lichess/explorer";

export function prepGameDateKey(
    mode: "player" | "general",
    source: "local" | "lch_all" | "lch_master",
) {
    return `${mode}:${source}`;
}

/** Snapshot the formerly shared filters once; subsequent choices are independent. */
export function initialPrepGameDateRanges(
    local: { start_date?: string; end_date?: string },
    lichess: LichessGamesOptions,
    masters: MasterGamesOptions,
): Record<string, GameDateRange> {
    const ranges = {
        local: storedGameDateRange(undefined, local.start_date, local.end_date),
        lch_all: storedGameDateRange(lichess.dateRange, lichess.since, lichess.until),
        lch_master: storedGameDateRange(masters.dateRange, masters.since, masters.until),
    };
    return Object.fromEntries(
        (["player", "general"] as const).flatMap((mode) =>
            Object.entries(ranges).map(([source, range]) => [`${mode}:${source}`, { ...range }]),
        ),
    );
}

export function prepGameDateRange(
    ranges: Record<string, GameDateRange>,
    key: string,
): GameDateRange {
    return ranges[key] ?? ALL_GAME_DATES;
}
