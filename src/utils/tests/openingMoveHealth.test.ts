import { describe, expect, test } from "vitest";
import { getOpeningMoveHealthMap } from "@/utils/openingMoveHealth";

describe("opening move health", () => {
    test("labels the same move from the selected side's perspective", () => {
        const openings = [
            { move: "e4", white: 8, draw: 1, black: 1 },
            { move: "d4", white: 3, draw: 2, black: 5 },
        ];

        const whiteHealth = getOpeningMoveHealthMap(openings, "white").get("e4");
        const blackHealth = getOpeningMoveHealthMap(openings, "black").get("e4");

        expect(whiteHealth?.status).toBe("strong");
        expect(blackHealth?.status).toBe("weak");
        expect(blackHealth?.side).toBe("black");
    });

    test("penalizes moves that miss a strong reference choice", () => {
        const openings = [{ move: "g4", white: 3, draw: 2, black: 3 }];
        const reference = [
            { move: "e4", white: 170, draw: 40, black: 50 },
            { move: "d4", white: 10, draw: 4, black: 8 },
            { move: "Nc3", white: 8, draw: 4, black: 10 },
        ];

        const health = getOpeningMoveHealthMap(openings, "white", reference).get("g4");

        expect(health?.status).toBe("weak");
        expect(health?.referenceRank).toBeNull();
        expect(health?.popularityGap).toBeGreaterThan(0.8);
    });
});
