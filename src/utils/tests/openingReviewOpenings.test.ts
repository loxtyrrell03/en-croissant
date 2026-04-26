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
    test("uses explicit review side ahead of side to move", () => {
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
