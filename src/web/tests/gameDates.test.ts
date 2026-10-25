import { INITIAL_FEN } from "chessops/fen";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_GAME_DATES, type GameDateRange } from "@/utils/gameDateRange";
import {
    buildWebExplorerProxyUrl,
    buildWebExplorerUrl,
    DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS,
    DEFAULT_WEB_MASTERS_EXPLORER_OPTIONS,
} from "../explorer";
import {
    displayPhonePrepGameDates,
    legacyPhoneDatabaseDates,
    legacyPhonePrepDates,
    resolvePhonePrepGameDates,
    validPhoneGameDateRanges,
} from "../gameDates";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
import { getWebPrepMoveStats } from "../prepIndex";
import { phoneGameDates, rememberPhoneGameDates } from "../usePhoneGameDates";
import { phoneWorkspaceOwner, validPhoneWorkspacePreferences } from "../workspacePreferences";

afterEach(() => vi.useRealTimers());
const rolling: GameDateRange = { period: "1m", since: "", until: "" };
const options = {
    lichess: DEFAULT_WEB_LICHESS_EXPLORER_OPTIONS,
    masters: DEFAULT_WEB_MASTERS_EXPLORER_OPTIONS,
};

it("migrates all source/mode date choices as independent groups", () => {
    const legacy = {
        ...options,
        lichess: { ...options.lichess, since: "2026-04", until: "2026-09" },
        masters: { ...options.masters, since: "2020", until: "2025" },
    };
    const database = legacyPhoneDatabaseDates({ startDate: "2026.01.01" }, legacy);
    const prep = legacyPhonePrepDates({ endDate: "2026.10.25" }, legacy);
    expect(database.local.since).toBe("2026-01-01");
    expect(database["lichess-all"]).toEqual({
        period: "custom",
        since: "2026-04-01",
        until: "2026-09-30",
    });
    expect(database["lichess-masters"].until).toBe("2025-12-31");
    prep["general:lichess-all"].since = "2026-08-01";
    expect(prep["player:lichess-all"].since).toBe("2026-04-01");
    expect(prep["player:temporary"].until).toBe("2026-10-25");
    expect(database["lichess-all"].since).toBe("2026-04-01");
});

it("resolves saved rolling dates in the real direct/proxy URLs after a calendar change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 25, 12));
    const selected = {
        ...options,
        lichess: { ...options.lichess, dateRange: rolling, since: "2000-01" },
        masters: { ...options.masters, dateRange: { ...rolling, period: "1y" as const } },
    };
    const first = new URL(
        buildWebExplorerUrl({ source: "lichess-all", fen: INITIAL_FEN, options: selected }),
    );
    expect(first.searchParams.get("since")).toBe("2026-09");
    expect(first.searchParams.get("until")).toBe("2026-10");
    const proxy = new URL(
        buildWebExplorerProxyUrl({ source: "lichess-all", fen: INITIAL_FEN, options: selected }),
    );
    expect(proxy.searchParams.get("since")).toBe(first.searchParams.get("since"));
    expect(
        new URL(
            buildWebExplorerUrl({ source: "lichess-masters", fen: INITIAL_FEN, options: selected }),
        ).searchParams.get("since"),
    ).toBe("2025");
    vi.setSystemTime(new Date(2026, 10, 1, 12));
    expect(
        new URL(
            buildWebExplorerUrl({ source: "lichess-all", fen: INITIAL_FEN, options: selected }),
        ).searchParams.get("until"),
    ).toBe("2026-11");
    expect(selected.lichess.since).toBe("2000-01");
});

it.each(["local", "temporary"] as const)(
    "applies inclusive ranges to actual %s Prep evidence and advances saved presets",
    (source) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 25, 12));
        const { games } = parsePgnDatabase(
            "Invented dated evidence",
            '[Date "2026.09.25"]\n1. e4 *\n\n[Date "2026.10.24"]\n1. d4 *',
            1,
        );
        const prep = {
            mode: "general" as const,
            source,
            opponent: "",
            userColor: "black" as const,
            sourceIds: [],
            dateRanges: { [`general:${source}`]: rolling },
        };
        expect(
            getWebPrepMoveStats({ games, prep, fen: INITIAL_FEN })
                .map((row) => row.move)
                .sort(),
        ).toEqual(["d4", "e4"]);
        vi.setSystemTime(new Date(2026, 9, 26, 12));
        expect(
            getWebPrepMoveStats({ games, prep, fen: INITIAL_FEN }).map((row) => row.move),
        ).toEqual(["d4"]);
        expect(resolvePhonePrepGameDates(prep).startDate).toBe("2026.09.26");
        expect(
            resolvePhonePrepGameDates({ ...prep, mode: "player" as const }).startDate,
        ).toBeUndefined();
    },
);

it("preserves a bad saved selection for explicit repair and never broadens a query", () => {
    const range = { period: "custom", since: "2026-12-31", until: "2026-01-01" } as GameDateRange;
    const prep = { mode: "general" as const, dateRanges: { "general:local": range } };
    expect(validPhoneGameDateRanges(prep.dateRanges)).toBe(true);
    expect(displayPhonePrepGameDates(prep)).toBe(prep);
    expect(() => resolvePhonePrepGameDates(prep)).toThrow("preserved");
    expect(() =>
        buildWebExplorerUrl({
            source: "lichess-all",
            fen: INITIAL_FEN,
            options: { lichess: { ...options.lichess, dateRange: range } },
        }),
    ).toThrow("preserved");
    expect(validPhoneGameDateRanges({ local: { ...range, period: "invented" } })).toBe(false);
    expect(
        validPhoneWorkspacePreferences({ file: { gameDates: { database: { local: range } } } }),
    ).toBe(true);
    expect(validPhoneWorkspacePreferences({ file: { gameDates: { database: [] } } })).toBe(false);
});

it("keeps exact selected bounds outside the old picker defaults so an API rejection remains visible", () => {
    const range: GameDateRange = { period: "custom", since: "1900-01-01", until: "2040-12-31" };
    const selected = {
        lichess: { ...options.lichess, dateRange: range },
        masters: { ...options.masters, dateRange: range },
    };
    for (const source of ["lichess-all", "lichess-masters"] as const) {
        const url = new URL(buildWebExplorerUrl({ source, fen: INITIAL_FEN, options: selected }));
        expect(url.searchParams.get("since")).toBe(source === "lichess-all" ? "1900-01" : "1900");
        expect(url.searchParams.get("until")).toBe(source === "lichess-all" ? "2040-12" : "2040");
    }
});

it("retains independent Database/draft Prep dates and rejects the replaced board owner", () => {
    const original = createEmptyWebState(),
        owner = phoneWorkspaceOwner(original);
    const database = rememberPhoneGameDates(original, owner, "database", () => ({
        local: rolling,
    }));
    const prep = rememberPhoneGameDates(database, owner, "prep", () => ({
        "general:local": ALL_GAME_DATES,
    }));
    expect(phoneGameDates(prep, "database")?.local.period).toBe("1m");
    expect(phoneGameDates(prep, "prep")?.["general:local"].period).toBe("all");
    const replacement = { ...prep, board: { ...prep.board, annotationOwnerId: "replacement" } };
    expect(rememberPhoneGameDates(replacement, owner, "database", () => ({}))).toBe(replacement);
});
