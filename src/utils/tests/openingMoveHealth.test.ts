import { describe, expect, test } from "vitest";
import { getOpeningMoveHealthMap, getOpeningMoveStrengthMap } from "@/utils/openingMoveHealth";

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

    test("uses Lichess Cloud scores when provided for opening strength", () => {
        const openings = [
            { move: "e4", white: 8, draw: 1, black: 1 },
            { move: "c4", white: 3, draw: 2, black: 5 },
        ];

        const strength = getOpeningMoveStrengthMap({
            openings,
            side: "white",
            fen: "startpos",
            cloudData: {
                source: "lichess",
                moves: [
                    { san: "e4", scoreCpForWhite: 19, rank: 1, winrate: null },
                    { san: "c4", scoreCpForWhite: 4, rank: 2, winrate: null },
                ],
            },
        });

        expect(strength.get("e4")?.source).toBe("lichess");
        expect(strength.get("e4")?.engineScoreCp).toBe(19);
        expect(strength.get("e4")?.engineScoreRank).toBe(1);
        expect(strength.get("c4")?.engineScoreCp).toBe(4);
        expect(strength.get("c4")?.engineScoreRank).toBe(2);
    });

    test("smart blended strength dampens tiny practical samples", () => {
        const strength = getOpeningMoveStrengthMap({
            openings: [
                { move: "c5", white: 0, draw: 0, black: 2 },
                { move: "e5", white: 45, draw: 10, black: 45 },
            ],
            side: "black",
            fen: "startpos",
            strengthSettings: { mode: "smart", engineWeight: 55, maxEngineCpLoss: 70 },
            cloudData: {
                source: "lichess",
                moves: [
                    { san: "e5", scoreCpForWhite: -80, rank: 1, winrate: null },
                    { san: "c5", scoreCpForWhite: -60, rank: 2, winrate: null },
                ],
            },
        });

        expect(strength.get("e5")!.blendedStrengthScore).toBeGreaterThan(
            strength.get("c5")!.blendedStrengthScore,
        );
    });
});
