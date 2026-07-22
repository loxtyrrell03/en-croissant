import { describe, expect, test } from "vitest";
import type { RepertoireGap } from "@/bindings";
import { createOpeningHealthTrainingItem, OPENING_HEALTH_SOURCE } from "@/components/files/opening";

function gapFixture(overrides: Partial<RepertoireGap> = {}): RepertoireGap {
    return {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        normalizedFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
        ply: 0,
        sideToMove: "white",
        moveSequence: "",
        playerMoveSan: "Nc3",
        playerMoveUci: "b1c3",
        playerGames: 3,
        playerPositionGames: 3,
        playerWhite: 1,
        playerDraw: 0,
        playerBlack: 2,
        playerScore: 1 / 3,
        lastPlayed: "2026.04.01",
        referenceGames: 200,
        referenceMoveRank: null,
        referenceMoveShare: 0,
        referenceScore: 0.56,
        topReferenceMoveScore: 0.56,
        classification: "repertoireGap",
        popularityGap: 0.64,
        scoreGap: 0.23,
        severity: 80,
        sampleGameIds: [1, 2, 3],
        topReferenceMoves: [
            {
                san: "e4",
                uci: "e2e4",
                games: 128,
                white: 70,
                draw: 24,
                black: 34,
                share: 0.64,
                scoreForSide: 0.64,
            },
        ],
        ...overrides,
    };
}

describe("Opening Health training items", () => {
    test("creates a spaced-repetition card from a flagged row", () => {
        const item = createOpeningHealthTrainingItem(
            gapFixture({
                moveSequence: "1. e4 c5 2. Nf3",
                classification: "preparedUnderperforming",
            }),
        );

        expect(item).not.toBeNull();
        expect(item?.fen).toContain("RNBQKBNR");
        expect(item?.answer).toBe("e4");
        expect(item?.sideToMove).toBe("white");
        expect(item?.moveSequence).toBe("1. e4 c5 2. Nf3");
        expect(item?.source).toBe(OPENING_HEALTH_SOURCE);
        expect(item?.tags).toContain("Opening plan gap");
        expect(item?.tags).toContain(OPENING_HEALTH_SOURCE);
        expect(item?.card).toBeTruthy();
    });

    test("does not create a card without a reference answer", () => {
        const item = createOpeningHealthTrainingItem(gapFixture({ topReferenceMoves: [] }));

        expect(item).toBeNull();
    });
});
