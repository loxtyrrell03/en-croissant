import { describe, expect, test } from "vitest";
import { isLeakedOutpostVerificationDir } from "../directories";

describe("directory overrides", () => {
    test("detects leaked Outpost parity directories", () => {
        expect(
            isLeakedOutpostVerificationDir(
                "C:\\Users\\loxty\\AppData\\Local\\Temp\\outpost-fork-parity-v1\\db",
            ),
        ).toBe(true);
        expect(
            isLeakedOutpostVerificationDir(
                "C:/Users/loxty/AppData/Local/Temp/outpost-parity-isolated-20260710/Documents/EnCroissant/",
            ),
        ).toBe(true);
    });

    test("preserves real and user-selected database directories", () => {
        expect(
            isLeakedOutpostVerificationDir(
                "C:\\Users\\loxty\\AppData\\Roaming\\org.encroissant.app\\db",
            ),
        ).toBe(false);
        expect(isLeakedOutpostVerificationDir("D:\\Chess\\Databases")).toBe(false);
        expect(
            isLeakedOutpostVerificationDir(
                "C:\\Users\\loxty\\AppData\\Local\\Temp\\personal-chess\\db",
            ),
        ).toBe(false);
    });
});
