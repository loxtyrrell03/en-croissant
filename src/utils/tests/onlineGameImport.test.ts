import { describe, expect, test } from "vitest";
import type { DatabaseInfo } from "@/bindings";
import {
    isLichessStudyDatabaseDescription,
    resolveOnlineDatabaseUpdateRecordForPath,
} from "@/utils/onlineGameImport";

describe("online game imports", () => {
    test("recognizes Lichess study database descriptions", () => {
        expect(
            isLichessStudyDatabaseDescription("Imported from https://lichess.org/study/j2XwsJxt"),
        ).toBe(true);
        expect(isLichessStudyDatabaseDescription("Selected online games")).toBe(false);
    });

    test("resolves review auto-update records after an online database moves folders", () => {
        const stalePath =
            "C:\\Users\\loxty\\AppData\\Roaming\\org.encroissant.app\\db\\loxi-ty_chesscom.db3";
        const currentPath =
            "C:\\Users\\loxty\\AppData\\Roaming\\org.encroissant.app\\db\\Online Games\\Chess.com\\loxi-ty_chesscom.db3";
        const record = {
            source: "chesscom" as const,
            username: "loxi-ty",
            dbPath: currentPath,
            title: "loxi-ty Chess.com",
            autoUpdate: true,
            lastCheckedAt: 2_000,
            lastUpdatedAt: 2_000,
            lastKnownGameCount: 12_835,
        };

        const resolved = resolveOnlineDatabaseUpdateRecordForPath(
            stalePath,
            { [currentPath]: record },
            [
                {
                    type: "error",
                    filename: "loxi-ty_chesscom.db3",
                    file: stalePath,
                    error: "no such table: Info",
                },
                {
                    type: "success",
                    filename: "loxi-ty_chesscom.db3",
                    file: currentPath,
                    title: "loxi-ty Chess.com",
                    description: null,
                    game_count: 12_970,
                },
            ] as DatabaseInfo[],
        );

        expect(resolved).toEqual({
            record: {
                ...record,
                lastKnownGameCount: 12_970,
            },
            relocated: true,
        });
    });
});
