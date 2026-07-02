import { describe, expect, test } from "vitest";
import { repertoireLineMoveText } from "@/utils/repertoireCopy";
import type { TreeNode } from "@/utils/treeReducer";

function node(san: string | null, halfMoves: number, children: TreeNode[] = []): TreeNode {
    return {
        fen: "",
        move: null,
        san,
        children,
        score: null,
        depth: null,
        halfMoves,
        shapes: [],
        annotations: [],
        comment: "",
    };
}

describe("repertoire copy", () => {
    test("keeps the opponent reply after a copied white repertoire move", () => {
        const reply = node("c5", 2);
        const playerMove = node("e4", 1, [reply]);
        const parent = node(null, 0, [playerMove]);

        expect(repertoireLineMoveText(parent, playerMove)).toBe("1. e4 c5");
    });

    test("keeps the opponent reply after a copied black repertoire move", () => {
        const reply = node("Nf3", 3);
        const playerMove = node("c5", 2, [reply]);
        const parent = node(null, 1, [playerMove]);

        expect(repertoireLineMoveText(parent, playerMove)).toBe("1... c5 2. Nf3");
    });
});
