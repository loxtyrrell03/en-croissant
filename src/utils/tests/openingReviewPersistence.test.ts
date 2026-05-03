import { INITIAL_FEN } from "chessops/fen";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import { getReviewPositionsForPath, sameReviewPosition } from "@/utils/openingReviewPersistence";
import { defaultTree } from "@/utils/treeReducer";

const BLACK_TO_MOVE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";

function position(overrides: Partial<Position> = {}): Position {
    return {
        fen: INITIAL_FEN,
        answer: "e4",
        answerUci: "e2e4",
        card: createEmptyCard(),
        ...overrides,
    };
}

describe("opening review persistence matching", () => {
    test("uses the loaded card when duplicate review gaps share a FEN", () => {
        const tree = defaultTree(INITIAL_FEN);
        const matches = getReviewPositionsForPath(
            [
                position({ reviewKey: "first", answer: "e4", answerUci: "e2e4" }),
                position({ reviewKey: "loaded", answer: "d4", answerUci: "d2d4" }),
            ],
            tree.root,
            [],
            1,
        );

        expect(matches).toHaveLength(1);
        expect(matches[0]!.positionIndex).toBe(1);
    });

    test("falls back to the board FEN when no loaded card matches", () => {
        const tree = defaultTree(INITIAL_FEN);
        const matches = getReviewPositionsForPath(
            [
                position({ reviewKey: "matching" }),
                position({ reviewKey: "other", fen: BLACK_TO_MOVE_FEN }),
            ],
            tree.root,
            [],
            1,
        );

        expect(matches).toHaveLength(1);
        expect(matches[0]!.positionIndex).toBe(0);
    });

    test("compares positions using the board state fields only", () => {
        const withCounters = `${INITIAL_FEN} 0 1`;

        expect(sameReviewPosition(INITIAL_FEN, withCounters)).toBe(true);
    });
});
