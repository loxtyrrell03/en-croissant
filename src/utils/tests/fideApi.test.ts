import { describe, expect, test } from "vitest";
import {
    describeFidePlayer,
    getFideImportStartYear,
    parseFidePlayer,
    rankFidePlayers,
    type FidePlayer,
} from "@/utils/fideApi";

describe("FIDE player lookup", () => {
    test("parses only well-formed player payloads", () => {
        expect(
            parseFidePlayer({ id: 6003788, name: "Tyrrell, Lachlan Baly Hughes", year: 2003 }),
        ).toEqual({
            id: 6003788,
            name: "Tyrrell, Lachlan Baly Hughes",
            title: undefined,
            federation: undefined,
            year: 2003,
            standard: undefined,
            rapid: undefined,
            blitz: undefined,
            inactive: undefined,
        });
        expect(parseFidePlayer({ name: "No id" })).toBeNull();
        expect(parseFidePlayer("nonsense")).toBeNull();
        expect(parseFidePlayer(null)).toBeNull();
    });

    test("ranks the intended player first despite loose upstream ordering", () => {
        const players: FidePlayer[] = [
            { id: 1, name: "Carlsson, Pontus", standard: 2480 },
            { id: 2, name: "Carlsen, Magnus", standard: 2830 },
            { id: 3, name: "Carlsen, Henrik", standard: 2100, inactive: true },
        ];
        const ranked = rankFidePlayers("Carlsen, Magnus", players);
        expect(ranked[0]?.id).toBe(2);
        expect(ranked.at(-1)?.id).toBe(1);
    });

    test("describes player metadata as one scannable line", () => {
        expect(
            describeFidePlayer({
                id: 6003788,
                name: "Tyrrell, Lachlan Baly Hughes",
                federation: "HKG",
                year: 2003,
                standard: 1852,
            }),
        ).toBe("HKG · b. 2003 · 1852");
        expect(describeFidePlayer({ id: 1, name: "X", inactive: true })).toBe("inactive");
    });

    test("uses a valid birth year for imports and falls back to 1900", () => {
        const currentYear = 2026;
        expect(getFideImportStartYear({ year: 2003 }, currentYear)).toBe(2003);
        expect(getFideImportStartYear({ year: 2003 }, currentYear, 2018)).toBe(2018);
        expect(getFideImportStartYear({ year: 1899 }, currentYear)).toBe(1900);
        expect(getFideImportStartYear({ year: 2027 }, currentYear)).toBe(1900);
        expect(getFideImportStartYear({ year: 2003.5 }, currentYear)).toBe(1900);
        expect(getFideImportStartYear(null, currentYear)).toBe(1900);
    });
});
