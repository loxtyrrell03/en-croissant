import { expect, test } from "vitest";
import { buildGameAnalysisReport, hasCompleteGameAnalysis } from "@/utils/gameAnalysisReport";
import { defaultTree, type TreeNode } from "@/utils/treeReducer";

function child(
    parent: TreeNode,
    san: string,
    fen: string,
    halfMoves: number,
    cp: number,
): TreeNode {
    const node: TreeNode = {
        fen,
        move: null,
        san,
        children: [],
        score: { value: { type: "cp", value: cp }, wdl: null },
        depth: 14,
        halfMoves,
        shapes: [],
        annotations: [],
        comment: "",
    };
    parent.children.push(node);
    return node;
}

test("builds lichess-style game report from saved mainline evals", () => {
    const tree = defaultTree();
    tree.headers.white = "White player";
    tree.headers.black = "Black player";
    child(tree.root, "e4", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", 1, -900);
    child(
        tree.root.children[0],
        "e5",
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        2,
        -900,
    );

    const report = buildGameAnalysisReport(tree.root, tree.headers);

    expect(report.white.name).toBe("White player");
    expect(report.black.name).toBe("Black player");
    expect(report.white.blunders).toBe(1);
    expect(report.black.blunders).toBe(0);
    expect(report.white.averageCentipawnLoss).toBeGreaterThan(900);
    expect(report.white.accuracy).toBeGreaterThan(5);
    expect(report.white.accuracy).toBeLessThan(15);
    expect(report.chart).toHaveLength(2);
    expect(hasCompleteGameAnalysis(tree.root)).toBe(true);
});
