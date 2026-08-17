import { describe, expect, test } from "vitest";
import {
    getHomeGameDatabaseImportTitle,
    validateHomeOnlineDatabaseImport,
} from "@/utils/homeGameDatabaseImport";

describe("Home game database import", () => {
    test("builds clear default titles for each online source", () => {
        expect(getHomeGameDatabaseImportTitle("chesscom", "loxi_ty", "")).toBe("loxi_ty Chess.com");
        expect(getHomeGameDatabaseImportTitle("lichess", "loxi-ty", "My prep games")).toBe(
            "My prep games",
        );
    });

    test("requires a username", () => {
        expect(
            validateHomeOnlineDatabaseImport({
                username: "  ",
                title: "Games",
                existingTitles: [],
            }),
        ).toBe("Enter the account username.");
    });

    test("rejects duplicate database titles case-insensitively", () => {
        expect(
            validateHomeOnlineDatabaseImport({
                username: "loxi_ty",
                title: "My Games",
                existingTitles: ["my games"],
            }),
        ).toBe("A database with this name already exists.");
    });
});
