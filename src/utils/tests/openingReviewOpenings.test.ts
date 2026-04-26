import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import { getOpeningReviewPositionColour } from "@/utils/openingReviewOpenings";

function position(overrides: Partial<Position> = {}): Position {
    return {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1",
        answer: "Nf6",
        card: createEmptyCard(),
        ...overrides,
    };
}

describe("opening review position colour", () => {
    test("uses explicit review side when deck mode is unknown", () => {
        expect(
            getOpeningReviewPositionColour(
                position({
                    sideToMove: "black",
                    openingHealth: {
                        sideToMove: "black",
                        reviewSide: "white",
                    },
                }),
            ),
        ).toBe("white");
    });

    test("deck mode overrides stale review side and score perspective", () => {
        expect(
            getOpeningReviewPositionColour(
                position({
                    sideToMove: "black",
                    openingHealth: {
                        mode: "self",
                        sideToMove: "black",
                        reviewSide: "black",
                        white: 3,
                        draw: 1,
                        black: 12,
                        score: 12.5 / 16,
                    },
                }),
                "opponent",
            ),
        ).toBe("white");
    });

    test("orients opponent prep cards from the user's side", () => {
        expect(
            getOpeningReviewPositionColour(
                position({
                    sideToMove: "black",
                    openingHealth: {
                        mode: "opponent",
                        sideToMove: "black",
                    },
                }),
            ),
        ).toBe("white");
    });
});
