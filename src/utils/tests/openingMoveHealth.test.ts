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

    test("keeps the root best move strong when child evals look better", () => {
        const strength = getOpeningMoveStrengthMap({
            openings: [
                { move: "e5", white: 51, draw: 4, black: 45 },
                { move: "c6", white: 47, draw: 5, black: 48 },
                { move: "d6", white: 49, draw: 4, black: 47 },
                { move: "d5", white: 48, draw: 5, black: 47 },
            ],
            // The WDL perspective must not change which move the engine considers best.
            side: "white",
            fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
            cloudData: {
                source: "lichess",
                rootBestMoveSan: "e5",
                rootBestScoreCpForWhite: 22,
                moves: [
                    { san: "e5", scoreCpForWhite: 22, rank: 1, winrate: null },
                    { san: "c6", scoreCpForWhite: 27, rank: 2, winrate: null },
                    { san: "d6", scoreCpForWhite: 45, rank: 3, winrate: null },
                    // A separately cached child position must not displace the root PV.
                    { san: "d5", scoreCpForWhite: 16, rank: 4, winrate: null },
                ],
            },
        });

        expect(strength.get("e5")).toMatchObject({
            status: "strong",
            label: "Strong",
            cpLoss: 0,
            engineSide: "black",
            engineScoreRank: 1,
            engineScoreCp: -22,
            engineScoreCpForWhite: 22,
        });
        expect(strength.get("c6")?.cpLoss).toBe(5);
        expect(strength.get("c6")?.status).toBe("strong");
        expect(strength.get("d6")?.cpLoss).toBe(23);
        expect(strength.get("d6")?.status).toBe("ok");
        expect(strength.get("d5")?.cpLoss).toBe(0);
        expect(strength.get("d5")?.engineScoreRank).toBe(2);
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
                    { san: "c5", scoreCpForWhite: -50, rank: 2, winrate: null },
                ],
            },
        });

        expect(strength.get("e5")!.blendedStrengthScore).toBeGreaterThan(
            strength.get("c5")!.blendedStrengthScore,
        );
    });

    test("smart blended strength leans practical when cloud evals are clustered", () => {
        const strength = getOpeningMoveStrengthMap({
            openings: [
                { move: "e5", white: 44, draw: 0, black: 56 },
                { move: "c5", white: 38, draw: 0, black: 62 },
                { move: "d5", white: 42, draw: 0, black: 58 },
                { move: "Nf6", white: 43, draw: 0, black: 57 },
            ],
            side: "black",
            fen: "startpos",
            strengthSettings: { mode: "smart", engineWeight: 55, maxEngineCpLoss: 70 },
            cloudData: {
                source: "lichess",
                moves: [
                    { san: "e5", scoreCpForWhite: -60, rank: 1, winrate: null },
                    { san: "Nf6", scoreCpForWhite: -55, rank: 2, winrate: null },
                    { san: "d5", scoreCpForWhite: -50, rank: 3, winrate: null },
                    { san: "c5", scoreCpForWhite: -40, rank: 4, winrate: null },
                ],
            },
        });

        expect(strength.get("c5")!.blendedStrengthScore).toBeGreaterThan(
            strength.get("e5")!.blendedStrengthScore,
        );
    });

    test("clustered evals do not crush engine-strong database moves to zero", () => {
        const strength = getOpeningMoveStrengthMap({
            openings: [
                { move: "e5", white: 80, draw: 0, black: 20 },
                { move: "c5", white: 20, draw: 0, black: 80 },
            ],
            side: "black",
            fen: "startpos",
            strengthSettings: { mode: "smart", engineWeight: 55, maxEngineCpLoss: 70 },
            cloudData: {
                source: "lichess",
                moves: [
                    { san: "e5", scoreCpForWhite: -60, rank: 1, winrate: null },
                    { san: "c5", scoreCpForWhite: -40, rank: 2, winrate: null },
                ],
            },
        });

        expect(strength.get("e5")!.cpLoss).toBe(0);
        expect(strength.get("e5")!.blendedStrengthScore).toBeGreaterThan(15);
        expect(strength.get("c5")!.blendedStrengthScore).toBeGreaterThan(
            strength.get("e5")!.blendedStrengthScore,
        );
    });

    test("engine strength keeps database signal when cloud omits a shown move", () => {
        const strength = getOpeningMoveStrengthMap({
            openings: [
                { move: "e4", white: 80, draw: 10, black: 10 },
                { move: "d4", white: 60, draw: 20, black: 20 },
            ],
            side: "white",
            fen: "startpos",
            strengthSettings: { mode: "engine", maxEngineCpLoss: 70 },
            cloudData: {
                source: "lichess",
                moves: [{ san: "Nf3", scoreCpForWhite: 35, rank: 1, winrate: null }],
            },
        });

        expect(strength.get("e4")?.cpLoss).toBeNull();
        expect(strength.get("e4")?.engineUnsafeForBlend).toBe(false);
        expect(strength.get("e4")?.blendedStrengthScore).toBeGreaterThan(0);
    });

    test("smart strength keeps database signal when cloud omits every shown move", () => {
        const strength = getOpeningMoveStrengthMap({
            openings: [
                { move: "e4", white: 80, draw: 10, black: 10 },
                { move: "d4", white: 60, draw: 20, black: 20 },
            ],
            side: "white",
            fen: "startpos",
            strengthSettings: { mode: "smart", engineWeight: 55, maxEngineCpLoss: 70 },
            cloudData: {
                source: "lichess",
                moves: [{ san: "Nf3", scoreCpForWhite: 35, rank: 1, winrate: null }],
            },
        });

        expect(strength.get("e4")?.cpLoss).toBeNull();
        expect(strength.get("e4")?.engineUnsafeForBlend).toBe(false);
        expect(strength.get("e4")?.blendedStrengthScore).toBeGreaterThan(0);
        expect(strength.get("d4")?.blendedStrengthScore).toBeGreaterThan(0);
    });
});
