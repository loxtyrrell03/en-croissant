import { describe, expect, test } from "vitest";
import { DEFAULT_BLINDFOLD_GAME_SETTINGS } from "@/state/atoms";
import {
    addLostTrackComment,
    BLINDFOLD_LOST_TRACK_COMMENT,
    buildBlindfoldSavedGame,
    createBlindfoldLostTrackMark,
    formatBlindfoldPlyLabel,
    hasLostTrackComment,
    removeLostTrackComment,
    upsertBlindfoldSavedGame,
} from "../blindfoldGameLibrary";
import { defaultTree, type TreeNode } from "../treeReducer";

function child(san: string, halfMoves: number, fen: string): TreeNode {
    return {
        fen,
        move: null,
        san,
        children: [],
        score: null,
        depth: null,
        halfMoves,
        shapes: [],
        annotations: [],
        comment: "",
    };
}

describe("blindfold game library", () => {
    test("adds and removes the lost-track PGN comment idempotently", () => {
        const marked = addLostTrackComment("Hard to visualize");
        expect(marked).toContain("Hard to visualize");
        expect(marked).toContain(BLINDFOLD_LOST_TRACK_COMMENT);
        expect(addLostTrackComment(marked)).toBe(marked);
        expect(hasLostTrackComment(marked)).toBe(true);
        expect(removeLostTrackComment(marked)).toBe("Hard to visualize");
    });

    test("creates a readable mark for a mainline position", () => {
        const tree = defaultTree();
        tree.root.children.push(child("e4", 1, "after e4"));
        tree.root.children[0].children.push(child("c5", 2, "after c5"));

        const mark = createBlindfoldLostTrackMark({
            id: "mark-1",
            root: tree.root,
            path: [0, 0],
            now: 123,
        });

        expect(mark).toMatchObject({
            id: "mark-1",
            fen: "after c5",
            ply: 2,
            label: "1... c5",
            sanLine: ["e4", "c5"],
        });
    });

    test("formats start, white, and black ply labels", () => {
        const tree = defaultTree();
        expect(formatBlindfoldPlyLabel(tree.root)).toBe("Start position");
        expect(formatBlindfoldPlyLabel(child("Nf3", 1, "after Nf3"))).toBe("1. Nf3");
        expect(formatBlindfoldPlyLabel(child("d5", 2, "after d5"))).toBe("1... d5");
    });

    test("builds and upserts newest-first saved game snapshots", () => {
        const tree = defaultTree();
        tree.headers.white = "Player";
        tree.headers.black = "Maia 1500";
        tree.headers.event = "Blindfold Maia";
        tree.root.children.push(child("d4", 1, "after d4"));

        const first = buildBlindfoldSavedGame({
            id: "game-1",
            root: tree.root,
            headers: tree.headers,
            settings: DEFAULT_BLINDFOLD_GAME_SETTINGS,
            marks: [],
            humanColor: "white",
            now: 100,
        });
        const second = buildBlindfoldSavedGame({
            id: "game-2",
            root: tree.root,
            headers: tree.headers,
            settings: DEFAULT_BLINDFOLD_GAME_SETTINGS,
            marks: [],
            humanColor: "white",
            now: 200,
        });

        const games = upsertBlindfoldSavedGame([first], second);
        expect(games.map((game) => game.id)).toEqual(["game-2", "game-1"]);
        expect(second.title).toBe("Player - Maia 1500");
        expect(second.moveCount).toBe(1);
        expect(second.lastMoveSan).toBe("d4");
        expect(second.pgn).toContain("1. d4");
    });
});
