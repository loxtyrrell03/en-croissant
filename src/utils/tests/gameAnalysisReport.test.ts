import { expect, test } from "vitest";
import { buildGameAnalysisReport, hasCompleteGameAnalysis } from "@/utils/gameAnalysisReport";
import { defaultTree, type TreeNode } from "@/utils/treeReducer";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { positionFromFen } from "../chessops";
import { getGameStats } from "../chess";
import { gameAnalysisEvidence } from "../gameAnalysisEvidence";
import { moveAccuracy } from "../gameAccuracy";

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

function played(sans: string[], cps: (number | null)[], fen?: string) {
    const tree = defaultTree(fen), [board] = positionFromFen(tree.root.fen);
    if (!board) throw new Error("Invalid test position");
    let node = tree.root;
    for (const [i, san] of sans.entries()) {
        const move = parseSan(board, san);
        if (!move) throw new Error(`Illegal fixture move ${san}`);
        board.play(move);
        node = child(node, san, makeFen(board.toSetup()), node.halfMoves + 1, cps[i] ?? 0);
        node.move = move; if (cps[i] === null) node.score = null;
    }
    return tree;
}

test("custom Black starts use their real starting score; absent root evidence is unavailable", () => {
    const tree = played(["h6"], [-600], "4k3/7p/8/8/8/8/6K1/R7 b - - 0 20");
    tree.root.score = { value: { type: "cp", value: -800 }, wdl: null };
    const report = buildGameAnalysisReport(tree.root, tree.headers);
    expect(report.black.accuracy).toBeCloseTo(moveAccuracy(-800, -600, false), 12);
    expect(report.white.accuracy).toBeNull();
    expect(getGameStats(tree.root).blackAccuracy).toBe(report.black.accuracy);
    expect(hasCompleteGameAnalysis(tree.root)).toBe(true);
    tree.root.score = null;
    expect(buildGameAnalysisReport(tree.root, tree.headers).hasAccuracy).toBe(false);
    expect(getGameStats(tree.root).blackAccuracy).toBeNull();
});

test("missing positions never bridge losses or fall back to a different accuracy formula", () => {
    const tree = played(["e4", "e5", "Nf3", "Nc6"], [10, null, -600, -500]);
    const report = buildGameAnalysisReport(tree.root, tree.headers);
    expect(report.white.samples).toBe(1); expect(report.black.samples).toBe(1);
    expect(report.white.accuracy).toBeNull(); expect(report.black.accuracy).toBeNull();
    expect(getGameStats(tree.root).whiteAccuracy).toBeNull();
    expect(hasCompleteGameAnalysis(tree.root)).toBe(false);
});

test("actual checkmate and repetition override missing or contradictory engine evidence", () => {
    const mated = played(["f3", "e5", "g4", "Qh4#"], [0, 0, 0, null]);
    const report = buildGameAnalysisReport(mated.root, mated.headers);
    expect(report.chart.at(-1)?.scoreText).toBe("Black mates");
    expect(hasCompleteGameAnalysis(mated.root)).toBe(true);
    expect(report.black.accuracy).toBe(100);
    const repetition = played(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"], Array(8).fill(300));
    expect(gameAnalysisEvidence(repetition.root).scores.at(-1)).toEqual({ type: "cp", value: 0 });
    const onePly = played(["e4"], [10]);
    expect(getGameStats(onePly.root).whiteAccuracy).not.toBeNull();
    expect(getGameStats(onePly.root).blackAccuracy).toBeNull();
    expect(getGameStats(defaultTree().root).whiteAccuracy).toBeNull();
});
