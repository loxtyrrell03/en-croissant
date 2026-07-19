import { describe, expect, test } from "vitest";
import { isLeakedOutpostVerificationDatabaseDir } from "../directories";

describe("directory overrides", () => {
    test("detects leaked Outpost parity database directories", () => {
        expect(
            isLeakedOutpostVerificationDatabaseDir(
                "C:\\Users\\loxty\\AppData\\Local\\Temp\\outpost-fork-parity-v1\\db",
            ),
        ).toBe(true);
        expect(
            isLeakedOutpostVerificationDatabaseDir(
                "C:/Users/loxty/AppData/Local/Temp/outpost-parity-isolated-20260710/db/",
            ),
        ).toBe(true);
    });

    test("preserves real and user-selected database directories", () => {
        expect(
            isLeakedOutpostVerificationDatabaseDir(
                "C:\\Users\\loxty\\AppData\\Roaming\\org.encroissant.app\\db",
            ),
        ).toBe(false);
        expect(isLeakedOutpostVerificationDatabaseDir("D:\\Chess\\Databases")).toBe(false);
        expect(
            isLeakedOutpostVerificationDatabaseDir(
                "C:\\Users\\loxty\\AppData\\Local\\Temp\\personal-chess\\db",
            ),
        ).toBe(false);
    });
});
