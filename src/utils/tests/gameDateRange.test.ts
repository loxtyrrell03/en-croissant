import { afterEach, expect, it, vi } from "vitest";
import {
    ALL_GAME_DATES,
    applyExplorerGameDates,
    applyLocalGameDates,
    expandGameDateBound,
    gameDateBounds,
    isCalendarDate,
    normalizeGameDateRange,
    storedGameDateRange,
    displayLocalGameDates,
    type GameDateRange,
} from "../gameDateRange";
import {
    getLichessGamesQueryParams,
    getMasterGamesQueryParams,
    lichessGamesOptionsSchema,
    masterOptionsSchema,
} from "../lichess/explorer";
import { initialPrepGameDateRanges, prepGameDateRange } from "../prepGameDates";

afterEach(() => vi.useRealTimers());
const preset = (period: GameDateRange["period"]): GameDateRange => ({
    period,
    since: "",
    until: "",
});
it.each([
    [2026, "2026.02.28"],
    [2024, "2024.02.29"],
])("clamps month-end ranges in %i without overflowing into March", (year, since) => {
    expect(gameDateBounds(preset("1m"), "day", new Date(Number(year), 2, 31, 12))).toEqual({
        since,
        until: `${year}.03.31`,
    });
});
it("keeps inclusive custom endpoints and source precision", () => {
    const range: GameDateRange = { period: "custom", since: "2024-02-03", until: "2026-10-25" };
    expect(gameDateBounds(range)).toEqual({ since: "2024.02.03", until: "2026.10.25" });
    expect(gameDateBounds(range, "month")).toEqual({ since: "2024-02", until: "2026-10" });
    expect(gameDateBounds(range, "year")).toEqual({ since: "2024", until: "2026" });
    expect(gameDateBounds({ ...range, since: "" })).toEqual({
        since: undefined,
        until: "2026.10.25",
    });
    expect(gameDateBounds(ALL_GAME_DATES)).toEqual({});
});
it("expands legacy year/month/PGN dates and preserves genuine calendar dates", () => {
    expect(expandGameDateBound("1952", true)).toBe("1952-12-31");
    expect(expandGameDateBound("2024-02", true)).toBe("2024-02-29");
    expect(expandGameDateBound("2026.2.3")).toBe("2026-02-03");
    expect(normalizeGameDateRange(undefined, "2024.02", "2026")).toEqual({
        period: "custom",
        since: "2024-02-01",
        until: "2026-12-31",
    });
    expect(isCalendarDate("0001-01-01")).toBe(true);
    for (const invalid of ["0000-01-01", "2025-02-29", "2026-04-31", "2026-13-01", "2026-1-01"])
        expect(isCalendarDate(invalid)).toBe(false);
});
it("resolves rolling metadata at the actual query boundary and retains unrelated options", () => {
    const input = {
        dateRange: preset("3m"),
        start_date: "2000.01.01",
        end_date: "2001.01.01",
        color: "black",
        player: 42,
    };
    expect(applyLocalGameDates(input, new Date(2026, 9, 25, 12))).toEqual({
        ...input,
        start_date: "2026.07.25",
        end_date: "2026.10.25",
    });
    expect(applyLocalGameDates({ ...input, dateRange: preset("all") })).toEqual({
        ...input,
        dateRange: preset("all"),
        start_date: undefined,
        end_date: undefined,
    });
    expect(input.start_date).toBe("2000.01.01");
    const legacy = { start_date: "2024.01.01", end_date: "2024.12.31" };
    expect(applyLocalGameDates(legacy)).toBe(legacy);
});
it("rejects malformed/reversed selected ranges rather than broadening a query", () => {
    const invalid = { period: "custom", since: "2026-10-25", until: "2026-01-01" } as GameDateRange;
    const input = { dateRange: invalid, start_date: "2024.01.01" };
    expect(() => applyLocalGameDates(input)).toThrow("preserved");
    expect(input.start_date).toBe("2024.01.01");
    expect(displayLocalGameDates(input)).toBe(input);
    expect(storedGameDateRange(undefined, "2026.02.30", "2026.10.25")).toEqual({
        period: "custom",
        since: "2026-02-30",
        until: "2026-10-25",
    });
    expect(() => gameDateBounds(storedGameDateRange(undefined, "2026.02.30"))).toThrow("preserved");
    expect(() =>
        applyExplorerGameDates({ dateRange: null as unknown as GameDateRange }, "year"),
    ).toThrow("preserved");
});
it("uses source resolution in the real explorer serializers, including the day after a saved preset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 25, 12));
    const options = { color: "black" as const, ratings: [2000] as const, dateRange: preset("1m") };
    const month = new URLSearchParams(
        getLichessGamesQueryParams("fixture-fen", { ...options, ratings: [...options.ratings] }),
    );
    expect(Object.fromEntries(month)).toMatchObject({
        since: "2026-9",
        until: "2026-10",
        ratings: "2000",
    });
    const year = new URLSearchParams(
        getMasterGamesQueryParams("fixture-fen", { dateRange: preset("1y"), topGames: 7 }),
    );
    expect(Object.fromEntries(year)).toMatchObject({ since: "2025", until: "2026", topGames: "7" });
    vi.setSystemTime(new Date(2026, 10, 1, 12));
    expect(
        new URLSearchParams(
            getLichessGamesQueryParams("fixture-fen", {
                color: "white",
                dateRange: options.dateRange,
            }),
        ).get("until"),
    ).toBe("2026-11");
});
it("retains range metadata and revives serialized dates across preference reloads", () => {
    const range = { period: "custom", since: "2024-02-01", until: "2024-02-29" } as const;
    const legacy = { since: new Date(2024, 1, 1), until: new Date(2024, 1, 29), dateRange: range };
    const lichess = lichessGamesOptionsSchema.parse(
        JSON.parse(JSON.stringify({ ...legacy, color: "white" })),
    );
    const masters = masterOptionsSchema.parse(JSON.parse(JSON.stringify(legacy)));
    expect(lichess.dateRange).toEqual(range);
    expect(masters.dateRange).toEqual(range);
    const rawStored = JSON.parse(JSON.stringify({ ...legacy, color: "white" }));
    expect(getLichessGamesQueryParams("fixture-fen", rawStored)).toContain("since=2024-2");
    expect(getMasterGamesQueryParams("fixture-fen", rawStored)).toContain("until=2024");
    expect(lichess.since).toBeInstanceOf(Date);
    expect(applyExplorerGameDates({ since: legacy.since }, "month").since).toBe(legacy.since);
});
it("snapshots legacy Prep filters into independent mode/source slots", () => {
    const shared = { color: "white" as const, dateRange: preset("3m") };
    const ranges = initialPrepGameDateRanges({ start_date: "2024.01.01" }, shared, {
        dateRange: preset("1y"),
    });
    shared.dateRange.period = "all";
    expect(ranges["general:lch_all"].period).toBe("3m");
    const updated = { ...ranges, "player:local": preset("1m") };
    expect(prepGameDateRange(updated, "general:local")).toEqual({
        period: "custom",
        since: "2024-01-01",
        until: "",
    });
    expect(prepGameDateRange(updated, "general:lch_master").period).toBe("1y");
    expect(prepGameDateRange(updated, "player:local").period).toBe("1m");
    expect(prepGameDateRange({}, "general:local").period).toBe("all");
});
