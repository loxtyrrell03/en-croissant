import { expect, test, vi } from "vitest";
import type { BestMoves } from "@/bindings";
import { parseUci } from "chessops";
import { createTreeStore } from "../store/tree";
import { defaultTree, createNode } from "@/utils/treeReducer";
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
const line = (cp: number): BestMoves => ({ depth: 17, multipv: 1, nodes: 1, nps: 1,
    sanMoves: [], uciMoves: [], score: { value: { type: "cp", value: cp }, wdl: null } });
function store() {
    const tree = defaultTree();
    tree.root.children.push(createNode({ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", san: "e4", move: parseUci("e2e4")!, halfMoves: 1 }));
    return createTreeStore(undefined, tree);
}
test("analysis never annotates the root as a played move and uses the shared judgement thresholds", () => {
    const state = store();
    state.getState().addAnalysis([
        { best: [line(900)], novelty: false, is_sacrifice: false },
        { best: [line(-170)], novelty: false, is_sacrifice: false },
    ]);
    expect(state.getState().root.annotations).toEqual([]);
    expect(state.getState().root.children[0].annotations).toContain("??");
});
test("an empty earlier engine result remains missing instead of throwing or inventing a loss", () => {
    const state = store();
    expect(() => state.getState().addAnalysis([
        { best: [], novelty: false, is_sacrifice: false },
        { best: [line(-900)], novelty: false, is_sacrifice: false },
    ])).not.toThrow();
    expect(state.getState().root.children[0].annotations).toEqual([]);
});
