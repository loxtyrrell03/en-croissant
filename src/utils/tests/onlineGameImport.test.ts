import { describe, expect, test } from "vitest";
import { isLichessStudyDatabaseDescription } from "@/utils/onlineGameImport";

describe("online game imports", () => {
    test("recognizes Lichess study database descriptions", () => {
        expect(
            isLichessStudyDatabaseDescription("Imported from https://lichess.org/study/j2XwsJxt"),
        ).toBe(true);
        expect(isLichessStudyDatabaseDescription("Selected online games")).toBe(false);
    });
});
