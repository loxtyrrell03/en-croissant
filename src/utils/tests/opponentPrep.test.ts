import { describe, expect, test } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import {
    collectOpponentBranchPaths,
    findFirstOpponentBranch,
    findLastOpponentBranch,
    findOpponentPrepStart,
    getOpponentPrepBranchStats,
    getOpponentPrepMoveRows,
} from "@/utils/opponentPrep";

describe("opponent prep helpers", () => {
    test("marks database moves as prepared when the tree has a response", () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().makeMove({ payload: "c5" });
        store.getState().goToMove([]);

        const state = store.getState();
        const rows = getOpponentPrepMoveRows({
            fen: state.root.fen,
            node: state.root,
            openings: [
                { move: "e4", white: 12, draw: 4, black: 4 },
                { move: "d4", white: 8, draw: 2, black: 2 },
            ],
            minGames: 1,
            moveLimit: 8,
            completedBranches: {},
            skippedBranches: {},
        });

        expect(rows.map((row) => [row.move, row.status])).toEqual([
            ["e4", "prepared"],
            ["d4", "new"],
        ]);
    });

    test("keeps the next prep move inside the visible move limit", () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().makeMove({ payload: "c5" });
        store.getState().goToMove([]);

        const state = store.getState();
        const openings = [
            { move: "e4", white: 12, draw: 4, black: 4 },
            { move: "d4", white: 8, draw: 2, black: 2 },
            { move: "c4", white: 5, draw: 1, black: 1 },
        ];
        const visibleRows = getOpponentPrepMoveRows({
            fen: state.root.fen,
            node: state.root,
            openings,
            minGames: 1,
            moveLimit: 1,
            completedBranches: {},
            skippedBranches: {},
        });
        expect(visibleRows.map((row) => row.move)).toEqual(["e4"]);

        const cappedRows = getOpponentPrepMoveRows({
            fen: state.root.fen,
            node: state.root,
            openings,
            minGames: 1,
            moveLimit: 1,
            completedBranches: {
                [visibleRows[0].key]: Date.now(),
            },
            skippedBranches: {},
        });
        expect(cappedRows.find((row) => row.status === "new")?.move).toBeUndefined();
    });

    test("finds the latest opponent branch and excludes current branch point when requested", () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().makeMove({ payload: "c5" });
        store.getState().makeMove({ payload: "Nf3" });

        const state = store.getState();
        const latest = findLastOpponentBranch(state.root, [0, 0, 0], "white");
        expect(latest?.branchPath).toEqual([0, 0]);
        expect(latest?.san).toBe("Nf3");

        const first = findFirstOpponentBranch(state.root, [0, 0, 0], "white");
        expect(first?.branchPath).toEqual([]);
        expect(first?.san).toBe("e4");

        const branchPaths = collectOpponentBranchPaths({
            root: state.root,
            path: [0, 0],
            opponentColor: "white",
            excludeCurrent: true,
        });
        expect(branchPaths).toEqual([[]]);
    });

    test("uses the opponent move in the saved start line as the prep branch point", () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "d4" });
        store.getState().makeMove({ payload: "Nf6" });
        store.getState().makeMove({ payload: "c4" });

        const state = store.getState();
        const start = findOpponentPrepStart(state.root, [0, 0], "black");

        expect(start?.branchPath).toEqual([0]);
        expect(start?.branch?.san).toBe("Nf6");
    });

    test("scores prep branches by weighted response coverage and depth", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().makeMove({ payload: "c5" });
        store.getState().makeMove({ payload: "Nf3" });
        store.getState().makeMove({ payload: "d6" });
        store.getState().goToMove([]);

        const state = store.getState();
        const [row] = getOpponentPrepMoveRows({
            fen: state.root.fen,
            node: state.root,
            openings: [{ move: "e4", white: 20, draw: 0, black: 0 }],
            minGames: 1,
            moveLimit: 4,
            completedBranches: {},
            skippedBranches: {},
        });
        const opponentReplyFen = state.root.children[0].children[0].fen;
        const stats = await getOpponentPrepBranchStats({
            parentNode: state.root,
            row,
            opponentColor: "white",
            loadOpenings: async (fen) =>
                fen === opponentReplyFen
                    ? [
                          { move: "Nf3", white: 80, draw: 10, black: 0 },
                          { move: "Nc3", white: 8, draw: 2, black: 0 },
                      ]
                    : [],
            minGames: 1,
            moveLimit: 4,
            completedBranches: {},
            skippedBranches: {},
        });

        expect(stats.replyCoverage).toBeGreaterThan(0.85);
        expect(stats.score).toBeGreaterThan(70);
        expect(stats.missingImportantMoves).toEqual([]);
    });

    test("keeps shallow branches with unanswered common replies marked as needing work", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().makeMove({ payload: "c5" });
        store.getState().goToMove([]);

        const state = store.getState();
        const [row] = getOpponentPrepMoveRows({
            fen: state.root.fen,
            node: state.root,
            openings: [{ move: "e4", white: 20, draw: 0, black: 0 }],
            minGames: 1,
            moveLimit: 4,
            completedBranches: {},
            skippedBranches: {},
        });
        const opponentReplyFen = state.root.children[0].children[0].fen;
        const stats = await getOpponentPrepBranchStats({
            parentNode: state.root,
            row,
            opponentColor: "white",
            loadOpenings: async (fen) =>
                fen === opponentReplyFen
                    ? [
                          { move: "Nf3", white: 6, draw: 2, black: 2 },
                          { move: "Nc3", white: 6, draw: 2, black: 2 },
                      ]
                    : [],
            minGames: 1,
            moveLimit: 4,
            completedBranches: {},
            skippedBranches: {},
        });

        expect(stats.replyCoverage).toBe(0);
        expect(stats.score).toBeLessThan(40);
        expect(stats.missingImportantMoves).toEqual(["Nc3", "Nf3"]);
    });
});
