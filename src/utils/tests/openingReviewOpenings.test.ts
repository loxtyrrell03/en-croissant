import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import {
    getOpeningReviewMoveSide,
    getOpeningReviewPositionColour,
    getOpeningReviewStatsPerspectiveSide,
} from "@/utils/openingReviewOpenings";

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

    test("uses the move side for review practice even in opponent decks", () => {
        expect(
            getOpeningReviewMoveSide(
                position({
                    sideToMove: "black",
                    openingHealth: {
                        mode: "opponent",
                        sideToMove: "black",
                    },
                }),
            ),
        ).toBe("black");
    });

    test("uses the played move side for opponent deck stats", () => {
        expect(
            getOpeningReviewStatsPerspectiveSide(
                position({
                    sideToMove: "black",
                    openingHealth: {
                        mode: "opponent",
                        sideToMove: "black",
                    },
                }),
                "opponent",
                "King's Gambit Accepted",
            ),
        ).toBe("black");
    });

    test("keeps white move-side defenses in white stats", () => {
        expect(
            getOpeningReviewStatsPerspectiveSide(
                position({
                    sideToMove: "white",
                    fen: "rnbqkb1r/pp2pp1p/5np1/3p4/3P4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 6",
                    openingHealth: {
                        mode: "opponent",
                        sideToMove: "white",
                        reviewSide: "black",
                    },
                }),
                "opponent",
                "Grünfeld Defense",
            ),
        ).toBe("white");
    });

    test("falls back to the opening side when no move side is saved", () => {
        expect(
            getOpeningReviewStatsPerspectiveSide(
                position({
                    fen: "invalid",
                    openingHealth: {
                        mode: "opponent",
                        reviewSide: "white",
                    },
                }),
                "opponent",
                "GrÃ¼nfeld Defense",
            ),
        ).toBe("black");
    });
});
