import { INITIAL_FEN } from "chessops/fen";
import { parseUci } from "chessops";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import type { Position } from "@/components/files/opening";
import {
    createReviewPositionFenIndex,
    findReviewPositionIndexForFen,
    getReviewPositionsForPath,
    sameReviewPosition,
} from "@/utils/openingReviewPersistence";
import { createNode, defaultTree } from "@/utils/treeReducer";

const BLACK_TO_MOVE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
const AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

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

    test("keeps edits below the loaded card attached to that card", () => {
        const tree = defaultTree(INITIAL_FEN);
        tree.root.children.push(
            createNode({
                fen: AFTER_E4_FEN,
                move: parseUci("e2e4")!,
                san: "e4",
                halfMoves: 1,
            }),
        );

        const matches = getReviewPositionsForPath(
            [
                position({ reviewKey: "first", answer: "e4", answerUci: "e2e4" }),
                position({ reviewKey: "loaded", answer: "d4", answerUci: "d2d4" }),
            ],
            tree.root,
            [0],
            1,
        );

        expect(matches).toHaveLength(1);
        expect(matches[0]!.positionIndex).toBe(1);
        expect(matches[0]!.path).toEqual([]);
    });

    test("can reuse a FEN index for large review decks without changing duplicate behavior", () => {
        const tree = defaultTree(INITIAL_FEN);
        const positions = [
            position({ reviewKey: "first", answer: "e4", answerUci: "e2e4" }),
            ...Array.from({ length: 100 }, (_, index) =>
                position({
                    fen: `${BLACK_TO_MOVE_FEN.split(" ").slice(0, 4).join(" ")} 0 ${index + 1}`,
                    reviewKey: `filler-${index}`,
                }),
            ),
            position({ reviewKey: "loaded", answer: "d4", answerUci: "d2d4" }),
        ];
        const fenIndex = createReviewPositionFenIndex(positions);

        const matches = getReviewPositionsForPath(
            positions,
            tree.root,
            [],
            positions.length - 1,
            fenIndex,
        );

        expect(matches).toHaveLength(1);
        expect(matches[0]!.positionIndex).toBe(positions.length - 1);
        expect(
            findReviewPositionIndexForFen(positions, BLACK_TO_MOVE_FEN, undefined, fenIndex),
        ).toBe(1);
    });

    test("compares positions using the board state fields only", () => {
        const withCounters = `${INITIAL_FEN} 0 1`;

        expect(sameReviewPosition(INITIAL_FEN, withCounters)).toBe(true);
    });
});
