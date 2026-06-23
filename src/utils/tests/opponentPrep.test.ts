import { beforeAll, describe, expect, test, vi } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import {
    collectOpponentBranchPaths,
    choosePrepBuilderMove,
    applyPrepSanMove,
    comparePrepStraightLineCandidates,
    findPrepStraightLineCandidates,
    findFirstOpponentBranch,
    findLastOpponentBranch,
    findOpponentPrepSourceMovePath,
    findOpponentPrepStart,
    getOpponentPrepBranchStats,
    getOpponentPrepCandidateLineImpact,
    getOpponentPrepMoveRows,
    getPrepStraightLineForcedMove,
    getPrepBuilderBranchValue,
    getPrepBuilderEffectiveMaxPly,
    getPrepBuilderEvidenceMinGames,
    getPrepBuilderReplyPolicy,
    getPrepBuilderStopReason,
    getPrepBuilderTaskPriority,
    getPrepBuilderUserResponseChildIndex,
    getPrepMoveStrengthMap,
    hasPrepBuilderDatabaseCandidates,
    isPrepStraightLineBadForOpponent,
    normalizePrepBuilderSettings,
} from "@/utils/opponentPrep";

describe("opponent prep helpers", () => {
    beforeAll(() => {
        Object.defineProperty(HTMLMediaElement.prototype, "play", {
            configurable: true,
            value: vi.fn(() => Promise.resolve()),
        });
    });

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

    test("uses the full source play rate when filtering builder branches", () => {
        const store = createTreeStore();
        const state = store.getState();
        const openings = [
            { move: "e4", white: 70, draw: 0, black: 0 },
            { move: "d4", white: 20, draw: 0, black: 0 },
            { move: "c4", white: 5, draw: 0, black: 0 },
            { move: "Nf3", white: 5, draw: 0, black: 0 },
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
        const thresholdRows = getOpponentPrepMoveRows({
            fen: state.root.fen,
            node: state.root,
            openings,
            minGames: 1,
            moveLimit: 4,
            completedBranches: {},
            skippedBranches: {},
        }).filter((row) => row.share * 100 >= 10);

        expect(visibleRows[0].share).toBeCloseTo(0.7);
        expect(thresholdRows.map((row) => row.move)).toEqual(["e4", "d4"]);
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

    test("finds the matching source-game path for an opponent prep move", () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().makeMove({ payload: "c5" });
        store.getState().makeMove({ payload: "Nf3" });
        store.getState().goToMove([]);

        const state = store.getState();
        expect(
            findOpponentPrepSourceMovePath({
                root: state.root,
                fen: state.root.fen,
                san: "e4?!",
            }),
        ).toEqual([0]);
        expect(
            findOpponentPrepSourceMovePath({
                root: state.root,
                fen: state.root.children[0].fen,
                san: "c5",
                uci: "c7c5",
            }),
        ).toEqual([0, 0]);
    });

    test("identifies a forced straight-line opponent move by full play-rate share", () => {
        const store = createTreeStore();
        const state = store.getState();
        const forced = getPrepStraightLineForcedMove({
            fen: state.root.fen,
            openings: [
                { move: "e4", white: 18, draw: 0, black: 0 },
                { move: "d4", white: 2, draw: 0, black: 0 },
            ],
            minGames: 2,
            minShare: 0.9,
        });

        expect(forced?.move).toBe("e4");
        expect(forced?.share).toBeCloseTo(0.9);
        expect(forced?.secondMove).toBe("d4");

        const notForced = getPrepStraightLineForcedMove({
            fen: state.root.fen,
            openings: [
                { move: "e4", white: 8, draw: 0, black: 0 },
                { move: "d4", white: 2, draw: 0, black: 0 },
            ],
            minGames: 2,
            minShare: 0.9,
        });
        expect(notForced).toBeNull();
    });

    test("applies straight-line SAN moves and ranks engine-bad forced lines", () => {
        const e4Fen = applyPrepSanMove(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "e4",
        );
        expect(e4Fen).toContain(" b ");

        const venom = {
            steps: [],
            leafFen: "fen-a",
            leafBestMove: "Nxf7",
            leafScoreCpForUser: 140,
            bestOpportunityCpForUser: 140,
            targetMove: null,
            targetPositionCpForUser: null,
            targetBestMoveForOpponent: null,
            reachProbability: 0.93,
            opportunityScore: 210,
            minOpponentShare: 0.93,
            opponentGamesFloor: 12,
            opponentMoveCount: 3,
            searchedPositions: 9,
        };
        const harmless = {
            ...venom,
            leafFen: "fen-b",
            leafScoreCpForUser: 35,
            bestOpportunityCpForUser: 35,
            opportunityScore: 80,
            minOpponentShare: 1,
            opponentGamesFloor: 40,
        };

        expect(comparePrepStraightLineCandidates(venom, harmless)).toBeLessThan(0);
        expect(isPrepStraightLineBadForOpponent(venom, 80)).toBe(true);
        expect(isPrepStraightLineBadForOpponent(harmless, 80)).toBe(false);
    });

    test("straight-line search falls back to database user moves before a forced black reply", async () => {
        const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        const afterE4 = applyPrepSanMove(startFen, "e4")!;
        const afterE4C5 = applyPrepSanMove(afterE4, "c5")!;

        const search = await findPrepStraightLineCandidates({
            startFen,
            opponentColor: "black",
            minGames: 2,
            minShare: 0.9,
            maxPly: 4,
            userCandidateLimit: 3,
            maxFrontier: 4,
            maxPositions: 12,
            loadOpenings: async (fen) => {
                if (fen === startFen) {
                    return [
                        { move: "e4", white: 7, draw: 1, black: 2 },
                        { move: "d4", white: 2, draw: 0, black: 0 },
                    ];
                }
                if (fen === afterE4) {
                    return [{ move: "c5", white: 0, draw: 1, black: 9 }];
                }
                return [];
            },
            loadEngineMoves: async (fen) =>
                fen === afterE4C5
                    ? [
                          {
                              san: "Nf3",
                              scoreCpForSide: 120,
                              rank: 1,
                              source: "chessdb",
                          },
                      ]
                    : [],
        });

        expect(search.best?.steps.map((step) => step.move)).toEqual(["e4", "c5"]);
        expect(search.best?.leafScoreCpForUser).toBe(120);
        expect(search.userPositionsWithoutMoves).toBe(0);
    });

    test("venom search scores habitual reached-position engine evals", async () => {
        const normalStartFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        const afterE4 = applyPrepSanMove(normalStartFen, "e4")!;

        const search = await findPrepStraightLineCandidates({
            mode: "venom",
            startFen: normalStartFen,
            opponentColor: "white",
            minGames: 2,
            minShare: 0.65,
            maxPly: 2,
            userCandidateLimit: 3,
            maxFrontier: 4,
            maxPositions: 6,
            loadOpenings: async (fen) =>
                fen === normalStartFen ? [{ move: "e4", white: 8, draw: 0, black: 2 }] : [],
            loadEngineMoves: async (fen) => {
                if (fen === normalStartFen) {
                    return [
                        { san: "d4", scoreCpForSide: 60, rank: 1, source: "chessdb" },
                        { san: "e4", scoreCpForSide: 70, rank: 2, source: "chessdb" },
                    ];
                }
                if (fen === afterE4) {
                    return [{ san: "c5", scoreCpForSide: 20, rank: 1, source: "chessdb" }];
                }
                return [];
            },
        });

        expect(search.best?.targetMove).toBe("e4");
        expect(search.best?.targetBestMoveForOpponent).toBe("d4");
        expect(search.best?.targetPositionCpForUser).toBe(70);
        expect(search.best?.bestOpportunityCpForUser).toBe(70);
        expect(isPrepStraightLineBadForOpponent(search.best, 40)).toBe(true);
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

    test("flags a saved reply when it changes a scary surface score", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().makeMove({ payload: "c5" });
        store.getState().makeMove({ payload: "Nf3" });
        store.getState().makeMove({ payload: "d6" });
        store.getState().goToMove([0]);

        const state = store.getState();
        const parentNode = state.root.children[0];
        const [row] = getOpponentPrepMoveRows({
            fen: parentNode.fen,
            node: parentNode,
            openings: [{ move: "c5", white: 20, draw: 10, black: 70 }],
            minGames: 1,
            moveLimit: 4,
            completedBranches: {},
            skippedBranches: {},
        });
        const branchFen = parentNode.children[0].fen;
        const userReplyFen = parentNode.children[0].children[0].fen;
        const stats = await getOpponentPrepBranchStats({
            parentNode,
            row,
            opponentColor: "black",
            loadOpenings: async (fen) => {
                if (fen === branchFen) {
                    return [
                        { move: "Nf3", white: 24, draw: 8, black: 8 },
                        { move: "Nc3", white: 5, draw: 0, black: 5 },
                    ];
                }
                if (fen === userReplyFen) {
                    return [
                        { move: "d6", white: 20, draw: 8, black: 12 },
                        { move: "Nc6", white: 2, draw: 0, black: 8 },
                    ];
                }
                return [];
            },
            minGames: 1,
            moveLimit: 4,
            completedBranches: {},
            skippedBranches: {},
        });

        expect(stats.preparedLineImpact).toMatchObject({
            userMove: "Nf3",
            opponentReplyMove: "d6",
            surfaceGames: 100,
            userGames: 40,
            opponentReplyGames: 40,
        });
        expect(stats.preparedLineImpact?.surfaceScore).toBeCloseTo(0.75);
        expect(stats.preparedLineImpact?.userScore).toBeCloseTo(0.3);
        expect(stats.preparedLineImpact?.opponentReplyScore).toBeCloseTo(0.4);
        expect(stats.preparedLineImpact?.opponentReplyShare).toBeCloseTo(0.8);
    });

    test("flags a candidate reply when the prep response improves the line", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        const settings = normalizePrepBuilderSettings({ mode: "practical", useCloudEngine: false });

        const fen = store.getState().root.children[0].fen;
        const afterC5 = applyPrepSanMove(fen, "c5");
        const afterC5Nf3 = afterC5 ? applyPrepSanMove(afterC5, "Nf3") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c5",
                white: 70,
                draw: 10,
                black: 20,
                total: 100,
                share: 0.24,
            },
            opponentColor: "white",
            loadOpenings: async (position) => {
                if (position === afterC5) {
                    return [
                        { move: "Nf3", white: 24, draw: 8, black: 8 },
                        { move: "Nc3", white: 6, draw: 0, black: 4 },
                    ];
                }
                if (position === afterC5Nf3) {
                    return [
                        { move: "g6", white: 10, draw: 8, black: 22 },
                        { move: "d6", white: 12, draw: 4, black: 4 },
                    ];
                }
                return [];
            },
            minGames: 1,
            moveLimit: 4,
            settings,
        });

        expect(impact).toMatchObject({
            userMove: "c5",
            opponentReplyMove: "Nf3",
            surfaceGames: 100,
            opponentReplyGames: 40,
            userResponseMove: "g6",
            userResponseGames: 40,
            continuationMoves: ["Nf3", "g6"],
            continuationGames: 40,
            continuationDepthPly: 2,
        });
        expect(impact?.surfaceScore).toBeCloseTo(0.75);
        expect(impact?.opponentReplyScore).toBeCloseTo(0.7);
        expect(impact?.opponentReplyShare).toBeCloseTo(0.8);
        expect(impact?.userResponseScore).toBeCloseTo(0.65);
        expect(impact?.userResponseShare).toBeCloseTo(0.67);
        expect(impact?.continuationUserScore).toBeCloseTo(0.65);
        expect(impact?.continuationStrengthScore).toBe(100);
        expect(impact?.scoreDrop).toBeCloseTo(0.4);
        expect(impact?.weightedScoreDrop ?? 0).toBeGreaterThan(0.2);
    });

    test("candidate reply strength uses future engine data when cloud engine is enabled", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
            useCloudEngine: true,
        });

        const fen = store.getState().root.children[0].fen;
        const afterC5 = applyPrepSanMove(fen, "c5");
        const afterC5Nf3 = afterC5 ? applyPrepSanMove(afterC5, "Nf3") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c5",
                white: 70,
                draw: 10,
                black: 20,
                total: 100,
                share: 0.24,
            },
            opponentColor: "white",
            loadOpenings: async (position) => {
                if (position === afterC5) {
                    return [{ move: "Nf3", white: 24, draw: 8, black: 8 }];
                }
                if (position === afterC5Nf3) {
                    return [
                        { move: "g6", white: 10, draw: 8, black: 22 },
                        { move: "d6", white: 12, draw: 4, black: 4 },
                    ];
                }
                return [];
            },
            loadEngineMoves: async (position) =>
                position === afterC5Nf3
                    ? [
                          { san: "g6", scoreCpForSide: 80, rank: 1, source: "lichess" },
                          { san: "d6", scoreCpForSide: 60, rank: 2, source: "lichess" },
                      ]
                    : [],
            minGames: 1,
            moveLimit: 4,
            settings,
        });

        expect(impact?.continuationMoves).toEqual(["Nf3", "g6"]);
        expect(impact?.continuationStrengthScore).toBe(100);
        expect(impact?.continuationLineScore).toBeLessThan(impact!.continuationStrengthScore!);
        expect(impact?.continuationStrengthScore).not.toBe(59);
        expect(impact?.continuationStrength?.engineCpLoss).toBe(0);
    });

    test("candidate after-prep value is capped by absolute future line outcome", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
            useCloudEngine: true,
        });

        const fen = store.getState().root.children[0].fen;
        const afterC5 = applyPrepSanMove(fen, "c5");
        const afterC5Nf3 = afterC5 ? applyPrepSanMove(afterC5, "Nf3") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c5",
                white: 70,
                draw: 10,
                black: 20,
                total: 100,
                share: 0.24,
            },
            opponentColor: "white",
            loadOpenings: async (position) => {
                if (position === afterC5) {
                    return [{ move: "Nf3", white: 24, draw: 8, black: 8 }];
                }
                if (position === afterC5Nf3) {
                    return [{ move: "g6", white: 100, draw: 0, black: 0 }];
                }
                return [];
            },
            loadEngineMoves: async (position) =>
                position === afterC5Nf3
                    ? [{ san: "g6", scoreCpForSide: 120, rank: 1, source: "lichess" }]
                    : [],
            minGames: 1,
            moveLimit: 4,
            settings,
        });

        expect(impact?.continuationMoves).toEqual(["Nf3", "g6"]);
        expect(impact?.continuationStrengthScore).toBe(100);
        expect(impact?.continuationLineScore).toBeLessThan(40);
        expect(impact?.continuationLineScore).toBeLessThan(impact!.continuationStrengthScore!);
    });

    test("candidate reply strength falls back to practical scoring when future engine data is missing", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
            useCloudEngine: true,
        });

        const fen = store.getState().root.children[0].fen;
        const afterC5 = applyPrepSanMove(fen, "c5");
        const afterC5Nf3 = afterC5 ? applyPrepSanMove(afterC5, "Nf3") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c5",
                white: 70,
                draw: 10,
                black: 20,
                total: 100,
                share: 0.24,
            },
            opponentColor: "white",
            loadOpenings: async (position) => {
                if (position === afterC5) {
                    return [{ move: "Nf3", white: 24, draw: 8, black: 8 }];
                }
                if (position === afterC5Nf3) {
                    return [{ move: "g6", white: 10, draw: 8, black: 22 }];
                }
                return [];
            },
            loadEngineMoves: async () => [],
            minGames: 1,
            moveLimit: 4,
            settings,
        });

        expect(impact?.continuationMoves).toEqual(["Nf3", "g6"]);
        expect(impact?.continuationStrengthScore).not.toBe(59);
        expect(impact?.continuationLineScore).toBeGreaterThan(0);
        expect(impact?.continuationLineStrength?.engineCpLoss).toBeNull();
        expect(impact?.continuationLineStrength?.detail).toContain("Engine unavailable");
    });

    test("candidate reply strength can use local eval moves when future database replies are missing", async () => {
        const store = createTreeStore();
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
            useCloudEngine: true,
        });

        const fen = store.getState().root.fen;
        const afterC3 = applyPrepSanMove(fen, "c3");
        const afterC3E5 = afterC3 ? applyPrepSanMove(afterC3, "e5") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c3",
                white: 2,
                draw: 0,
                black: 1,
                total: 3,
                share: 0.01,
            },
            opponentColor: "black",
            loadOpenings: async (position) => {
                if (position === afterC3) {
                    return [{ move: "e5", white: 1, draw: 0, black: 1 }];
                }
                if (position === afterC3E5) {
                    return [];
                }
                return [];
            },
            loadEngineMoves: async (position) =>
                position === afterC3E5
                    ? [
                          { san: "d4", scoreCpForSide: 45, rank: 1, source: "lichess" },
                          { san: "e4", scoreCpForSide: 30, rank: 2, source: "lichess" },
                      ]
                    : [],
            minGames: 1,
            moveLimit: 4,
            settings,
        });

        expect(impact?.continuationMoves).toEqual(["e5", "d4"]);
        expect(impact?.userResponseMove).toBe("d4");
        expect(impact?.userResponseGames).toBe(0);
        expect(impact?.continuationLineStrength).not.toBeNull();
        expect(impact?.continuationLineStrength?.detail).toContain("Local eval best");
        expect(impact?.continuationLineStrength?.detail).toContain("WDL unavailable");
    });

    test("chooses future prep replies by strength instead of raw WDL", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        const settings = normalizePrepBuilderSettings({ mode: "practical", useCloudEngine: false });

        const fen = store.getState().root.children[0].fen;
        const afterC5 = applyPrepSanMove(fen, "c5");
        const afterC5Nf3 = afterC5 ? applyPrepSanMove(afterC5, "Nf3") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c5",
                white: 70,
                draw: 10,
                black: 20,
                total: 100,
                share: 0.24,
            },
            opponentColor: "white",
            loadOpenings: async (position) => {
                if (position === afterC5) {
                    return [{ move: "Nf3", white: 24, draw: 8, black: 8 }];
                }
                if (position === afterC5Nf3) {
                    return [
                        { move: "g6", white: 0, draw: 0, black: 2 },
                        { move: "d6", white: 20, draw: 0, black: 80 },
                    ];
                }
                return [];
            },
            minGames: 1,
            moveLimit: 4,
            settings,
        });

        expect(impact?.continuationMoves).toEqual(["Nf3", "d6"]);
        expect(impact?.userResponseMove).toBe("d6");
        expect(impact?.userResponseScore).toBeCloseTo(0.8);
        expect(impact?.userResponseStrengthScore).toBe(100);
    });

    test("can use a common deeper candidate continuation after discounting", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        const settings = normalizePrepBuilderSettings({ mode: "practical", useCloudEngine: false });

        const fen = store.getState().root.children[0].fen;
        const afterC5 = applyPrepSanMove(fen, "c5");
        const afterC5Nf3 = afterC5 ? applyPrepSanMove(afterC5, "Nf3") : null;
        const afterC5Nf3G6 = afterC5Nf3 ? applyPrepSanMove(afterC5Nf3, "g6") : null;
        const afterC5Nf3G6D4 = afterC5Nf3G6 ? applyPrepSanMove(afterC5Nf3G6, "d4") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c5",
                white: 70,
                draw: 10,
                black: 20,
                total: 100,
                share: 0.24,
            },
            opponentColor: "white",
            loadOpenings: async (position) => {
                if (position === afterC5) {
                    return [
                        { move: "Nf3", white: 24, draw: 8, black: 8 },
                        { move: "Nc3", white: 6, draw: 0, black: 4 },
                    ];
                }
                if (position === afterC5Nf3) {
                    return [
                        { move: "g6", white: 0, draw: 0, black: 2 },
                        { move: "a6", white: 2, draw: 0, black: 0 },
                        { move: "b6", white: 2, draw: 0, black: 0 },
                        { move: "d6", white: 2, draw: 0, black: 0 },
                        { move: "e6", white: 2, draw: 0, black: 0 },
                        { move: "h6", white: 2, draw: 0, black: 0 },
                        { move: "Nc6", white: 2, draw: 0, black: 0 },
                        { move: "Nf6", white: 2, draw: 0, black: 0 },
                        { move: "Qc7", white: 2, draw: 0, black: 0 },
                        { move: "Qa5", white: 2, draw: 0, black: 0 },
                        { move: "Qb6", white: 2, draw: 0, black: 0 },
                        { move: "e5", white: 2, draw: 0, black: 0 },
                        { move: "f6", white: 2, draw: 0, black: 0 },
                    ];
                }
                if (position === afterC5Nf3G6) {
                    return [
                        { move: "d4", white: 45, draw: 0, black: 45 },
                        { move: "Bb5", white: 1, draw: 0, black: 9 },
                    ];
                }
                if (position === afterC5Nf3G6D4) {
                    return [
                        { move: "Bg7", white: 0, draw: 4, black: 36 },
                        { move: "cxd4", white: 10, draw: 4, black: 6 },
                    ];
                }
                return [];
            },
            minGames: 1,
            moveLimit: 16,
            settings,
        });

        expect(impact?.continuationMoves).toEqual(["Nf3", "g6", "d4", "Bg7"]);
        expect(impact?.continuationUserScore).toBeCloseTo(0.95);
        expect(impact?.userResponseStrengthScore).toBe(58);
        expect(impact?.continuationStrengthScore).toBe(100);
        expect(impact?.continuationDepthPly).toBe(4);
        expect(impact?.weightedStrengthScore ?? 0).toBeGreaterThan(40);
    });

    test("keeps a nearer candidate continuation above a rare deeper WDL swing", async () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        const settings = normalizePrepBuilderSettings({ mode: "practical", useCloudEngine: false });

        const fen = store.getState().root.children[0].fen;
        const afterC5 = applyPrepSanMove(fen, "c5");
        const afterC5Nf3 = afterC5 ? applyPrepSanMove(afterC5, "Nf3") : null;
        const afterC5Nf3G6 = afterC5Nf3 ? applyPrepSanMove(afterC5Nf3, "g6") : null;
        const afterC5Nf3G6D4 = afterC5Nf3G6 ? applyPrepSanMove(afterC5Nf3G6, "d4") : null;
        const impact = await getOpponentPrepCandidateLineImpact({
            fen,
            row: {
                move: "c5",
                white: 70,
                draw: 10,
                black: 20,
                total: 100,
                share: 0.24,
            },
            opponentColor: "white",
            loadOpenings: async (position) => {
                if (position === afterC5) {
                    return [
                        { move: "Nf3", white: 24, draw: 8, black: 8 },
                        { move: "Nc3", white: 6, draw: 0, black: 4 },
                    ];
                }
                if (position === afterC5Nf3) {
                    return [{ move: "g6", white: 15, draw: 8, black: 17 }];
                }
                if (position === afterC5Nf3G6) {
                    return [
                        { move: "d4", white: 15, draw: 0, black: 15 },
                        { move: "Bg2", white: 12, draw: 0, black: 13 },
                        { move: "c3", white: 12, draw: 0, black: 13 },
                        { move: "Bb5", white: 9, draw: 0, black: 11 },
                    ];
                }
                if (position === afterC5Nf3G6D4) {
                    return [{ move: "Bg7", white: 0, draw: 4, black: 36 }];
                }
                return [];
            },
            minGames: 1,
            moveLimit: 4,
            settings,
        });

        expect(impact?.continuationMoves).toEqual(["Nf3", "g6"]);
        expect(impact?.continuationUserScore).toBeCloseTo(0.525);
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

    test("smart prep builder prefers a good move where the opponent underperforms reference", () => {
        const settings = normalizePrepBuilderSettings({ mode: "smart" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "e5", white: 18, draw: 2, black: 5 },
                { move: "c5", white: 8, draw: 4, black: 18 },
            ],
            referenceOpenings: [
                { move: "e5", white: 45, draw: 20, black: 35 },
                { move: "c5", white: 42, draw: 20, black: 38 },
            ],
            engineMoves: [
                { san: "e5", scoreCpForSide: 25, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 5, rank: 2, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("c5");
        expect(choice?.engineRank).toBe(2);
        expect(choice?.databaseRank).toBe(1);
        expect(choice?.reasons).toEqual(["Local eval: -20 cp from best", "Database: best WDL"]);
    });

    test("engine prep builder keeps the top engine move when mode asks for it", () => {
        const settings = normalizePrepBuilderSettings({ mode: "engine" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "e5", white: 18, draw: 2, black: 5 },
                { move: "c5", white: 8, draw: 4, black: 18 },
            ],
            referenceOpenings: [
                { move: "e5", white: 45, draw: 20, black: 35 },
                { move: "c5", white: 42, draw: 20, black: 38 },
            ],
            engineMoves: [
                { san: "e5", scoreCpForSide: 25, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 5, rank: 2, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("e5");
    });

    test("smart strength lets a large WDL edge beat a small engine edge", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "e5", white: 46, draw: 0, black: 54 },
                { move: "c5", white: 32, draw: 0, black: 68 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "e5", scoreCpForSide: 80, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 60, rank: 2, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("c5");
        expect(choice?.databaseWdlLoss).toBe(0);
        expect(choice?.engineCpLoss).toBe(20);
    });

    test("smart strength keeps the engine move when the WDL edge is tiny", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "e5", white: 44, draw: 0, black: 56 },
                { move: "c5", white: 46, draw: 0, black: 54 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "e5", scoreCpForSide: 80, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 50, rank: 2, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("e5");
        expect(choice?.databaseWdlLoss).toBe(0);
        expect(choice?.engineCpLoss).toBe(0);
    });

    test("smart strength does not floor an engine-best move over awful opponent WDL", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "black",
            settings,
            openings: [
                { move: "e5", white: 426, draw: 23, black: 126 },
                { move: "c6", white: 146, draw: 22, black: 80 },
                { move: "c5", white: 334, draw: 38, black: 167 },
            ],
            engineMoves: [
                { san: "e5", scoreCpForSide: 80, rank: 1, source: "lichess" },
                { san: "c6", scoreCpForSide: 60, rank: 2, source: "lichess" },
                { san: "c5", scoreCpForSide: 50, rank: 3, source: "lichess" },
            ],
        });

        expect(strength.get("e5")?.engineCpLoss).toBe(0);
        expect(strength.get("e5")?.databaseWdlLoss).toBeGreaterThan(0.1);
        expect(strength.get("e5")?.score).toBeLessThan(strength.get("c6")!.score);
        expect(strength.get("e5")?.score).toBeLessThan(strength.get("c5")!.score);
        expect(strength.get("e5")?.detail).not.toContain("Engine floor");
    });

    test("smart strength leans practical when top engine moves are clustered", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "e5", white: 44, draw: 0, black: 56 },
                { move: "c5", white: 38, draw: 0, black: 62 },
                { move: "d5", white: 42, draw: 0, black: 58 },
                { move: "Nf6", white: 43, draw: 0, black: 57 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "e5", scoreCpForSide: 60, rank: 1, source: "lichess" },
                { san: "Nf6", scoreCpForSide: 55, rank: 2, source: "lichess" },
                { san: "d5", scoreCpForSide: 50, rank: 3, source: "lichess" },
                { san: "c5", scoreCpForSide: 40, rank: 4, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("c5");
        expect(choice?.engineCpLoss).toBe(20);
        expect(choice?.databaseWdlLoss).toBe(0);
    });

    test("smart strength keeps engine weight when top engine moves are clearly separated", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "e5", white: 44, draw: 0, black: 56 },
                { move: "c5", white: 38, draw: 0, black: 62 },
                { move: "d5", white: 42, draw: 0, black: 58 },
                { move: "Nf6", white: 43, draw: 0, black: 57 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "e5", scoreCpForSide: 95, rank: 1, source: "lichess" },
                { san: "Nf6", scoreCpForSide: 45, rank: 2, source: "lichess" },
                { san: "d5", scoreCpForSide: 25, rank: 3, source: "lichess" },
                { san: "c5", scoreCpForSide: -5, rank: 4, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("e5");
    });

    test("prep builder stops when the source database has no candidate move", () => {
        const settings = normalizePrepBuilderSettings({ mode: "practical" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [],
            referenceOpenings: [{ move: "c5", white: 30, draw: 20, black: 50 }],
            engineMoves: [{ san: "c5", scoreCpForSide: 80, rank: 1, source: "lichess" }],
        });

        expect(choice).toBeNull();
        expect(
            hasPrepBuilderDatabaseCandidates([{ move: "c5", white: 0, draw: 0, black: 1 }], 2),
        ).toBe(false);
    });

    test("prep builder ignores source moves below the active evidence floor", () => {
        const settings = normalizePrepBuilderSettings({ mode: "practical" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            minGames: 20,
            opponentOpenings: [
                { move: "c5", white: 8, draw: 1, black: 1 },
                { move: "e5", white: 30, draw: 20, black: 50 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "c5", scoreCpForSide: 90, rank: 1, source: "lichess" },
                { san: "e5", scoreCpForSide: 40, rank: 2, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("e5");
        expect(choice?.databaseRank).toBe(1);
    });

    test("practical prep builder prioritizes database WDL over engine rank", () => {
        const settings = normalizePrepBuilderSettings({ mode: "practical" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "c5", white: 10, draw: 20, black: 70 },
                { move: "d5", white: 20, draw: 20, black: 60 },
                { move: "Nf6", white: 25, draw: 20, black: 55 },
                { move: "g6", white: 30, draw: 20, black: 50 },
                { move: "c6", white: 35, draw: 20, black: 45 },
                { move: "e6", white: 40, draw: 20, black: 40 },
                { move: "b6", white: 45, draw: 20, black: 35 },
                { move: "a6", white: 50, draw: 20, black: 30 },
                { move: "e5", white: 70, draw: 20, black: 10 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "e5", scoreCpForSide: 80, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 20, rank: 2, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("c5");
        expect(choice?.engineRank).toBe(2);
        expect(choice?.databaseRank).toBe(1);
    });

    test("practical prep builder ranks the selected side's wins above draw-heavy scores", () => {
        const settings = normalizePrepBuilderSettings({ mode: "practical" });
        const blackChoice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "a6", white: 0, draw: 98, black: 2 },
                { move: "c5", white: 50, draw: 0, black: 50 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "a6", scoreCpForSide: 20, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 10, rank: 2, source: "lichess" },
            ],
        });
        const whiteChoice = choosePrepBuilderMove({
            userColor: "white",
            settings,
            opponentOpenings: [
                { move: "a3", white: 2, draw: 98, black: 0 },
                { move: "e4", white: 50, draw: 0, black: 50 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "a3", scoreCpForSide: 20, rank: 1, source: "lichess" },
                { san: "e4", scoreCpForSide: 10, rank: 2, source: "lichess" },
            ],
        });

        expect(blackChoice?.move).toBe("c5");
        expect(blackChoice?.databaseRank).toBe(1);
        expect(whiteChoice?.move).toBe("e4");
        expect(whiteChoice?.databaseRank).toBe(1);
    });

    test("practical prep builder still rejects database moves that are too weak", () => {
        const settings = normalizePrepBuilderSettings({ mode: "practical" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "h6", white: 0, draw: 0, black: 30 },
                { move: "e5", white: 10, draw: 10, black: 20 },
            ],
            referenceOpenings: [],
            engineMoves: [
                { san: "e5", scoreCpForSide: 80, rank: 1, source: "lichess" },
                { san: "h6", scoreCpForSide: -80, rank: 5, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("e5");
        expect(choice?.databaseRank).toBe(2);
    });

    test("smart prep builder rejects practically tempting moves that fail the engine gate", () => {
        const settings = normalizePrepBuilderSettings({ mode: "smart" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "h6", white: 0, draw: 0, black: 20 },
                { move: "e5", white: 25, draw: 20, black: 35 },
            ],
            referenceOpenings: [
                { move: "h6", white: 70, draw: 20, black: 10 },
                { move: "e5", white: 35, draw: 30, black: 35 },
            ],
            engineMoves: [
                { san: "e5", scoreCpForSide: 80, rank: 1, source: "lichess" },
                { san: "h6", scoreCpForSide: -110, rank: 5, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("e5");
    });

    test("smart prep builder shrinks tiny opponent samples toward reference WDL", () => {
        const settings = normalizePrepBuilderSettings({ mode: "smart" });
        const choice = choosePrepBuilderMove({
            userColor: "black",
            settings,
            opponentOpenings: [
                { move: "c5", white: 0, draw: 0, black: 2 },
                { move: "e5", white: 10, draw: 10, black: 20 },
            ],
            referenceOpenings: [
                { move: "c5", white: 70, draw: 20, black: 10 },
                { move: "e5", white: 40, draw: 20, black: 40 },
            ],
            engineMoves: [
                { san: "e5", scoreCpForSide: 25, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 15, rank: 2, source: "lichess" },
            ],
        });

        expect(choice?.move).toBe("e5");
    });

    test("smart strength discounts one or two game practical spikes by usage", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "black",
            settings,
            openings: [
                { move: "c5", white: 0, draw: 0, black: 2 },
                { move: "e5", white: 45, draw: 10, black: 45 },
            ],
            engineMoves: [
                { san: "e5", scoreCpForSide: 80, rank: 1, source: "lichess" },
                { san: "c5", scoreCpForSide: 50, rank: 2, source: "lichess" },
            ],
        });

        expect(strength.get("e5")!.score).toBeGreaterThan(strength.get("c5")!.score);
    });

    test("practical strength does not benchmark against one-game WDL spikes", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "practical",
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "white",
            settings,
            openings: [
                { move: "a3", white: 1, draw: 0, black: 0 },
                { move: "h3", white: 1, draw: 0, black: 0 },
                { move: "c4", white: 290, draw: 0, black: 275 },
                { move: "Nf3", white: 152, draw: 0, black: 153 },
                { move: "Bf4", white: 47, draw: 0, black: 41 },
            ],
            engineMoves: [
                { san: "Nf3", scoreCpForSide: 32, rank: 1, source: "lichess" },
                { san: "c4", scoreCpForSide: 30, rank: 2, source: "lichess" },
                { san: "Bf4", scoreCpForSide: 5, rank: 3, source: "lichess" },
                { san: "a3", scoreCpForSide: 0, rank: 4, source: "lichess" },
                { san: "h3", scoreCpForSide: 0, rank: 5, source: "lichess" },
            ],
        });

        expect(strength.get("c4")?.databaseWdlLoss).toBeLessThan(0.03);
        expect(strength.get("c4")?.score).toBeGreaterThan(80);
        expect(strength.get("Nf3")?.score).toBeGreaterThan(70);
    });

    test("engine strength does not collapse unmatched cloud rows to zero", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "engine",
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "white",
            settings,
            openings: [
                { move: "e4", white: 80, draw: 10, black: 10 },
                { move: "d4", white: 60, draw: 20, black: 20 },
            ],
            engineMoves: [{ san: "Nf3", scoreCpForSide: 35, rank: 1, source: "lichess" }],
        });

        expect(strength.get("e4")?.engineCpLoss).toBeNull();
        expect(strength.get("e4")?.engineUnsafe).toBe(false);
        expect(strength.get("e4")?.score).toBeGreaterThan(0);
        expect(strength.get("e4")?.score).toBeLessThan(90);
    });

    test("smart strength does not zero player rows when engine data misses the visible moves", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "white",
            settings,
            openings: [
                { move: "e4", white: 24, draw: 4, black: 4 },
                { move: "d4", white: 17, draw: 3, black: 3 },
            ],
            engineMoves: [{ san: "Nf3", scoreCpForSide: 35, rank: 1, source: "lichess" }],
        });

        expect(strength.get("e4")?.engineCpLoss).toBeNull();
        expect(strength.get("e4")?.engineUnsafe).toBe(false);
        expect(strength.get("e4")?.score).toBeGreaterThan(0);
        expect(strength.get("e4")?.score).toBeLessThan(90);
        expect(strength.get("d4")?.score).toBeGreaterThan(0);
    });

    test("smart strength still warns when only some visible moves have engine coverage", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "white",
            settings,
            openings: [
                { move: "e4", white: 24, draw: 4, black: 4 },
                { move: "b4", white: 1, draw: 0, black: 8 },
            ],
            engineMoves: [{ san: "e4", scoreCpForSide: 35, rank: 1, source: "lichess" }],
        });

        expect(strength.get("b4")?.engineCpLoss).toBeNull();
        expect(strength.get("b4")?.engineUnsafe).toBe(true);
        expect(strength.get("b4")?.score).toBeLessThan(strength.get("e4")!.score);
    });

    test("smart strength caps tiny low-share samples even with a top engine score", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "smart",
            engineWeight: 55,
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "black",
            settings,
            openings: [
                { move: "c5", white: 0, draw: 0, black: 2 },
                { move: "a5", white: 30, draw: 30, black: 120 },
                { move: "Nbd7", white: 80, draw: 80, black: 220 },
            ],
            engineMoves: [
                { san: "c5", scoreCpForSide: 80, rank: 1, source: "chessdb" },
                { san: "a5", scoreCpForSide: 70, rank: 2, source: "lichess" },
            ],
        });

        expect(strength.get("c5")?.score).toBeLessThanOrEqual(72);
        expect(strength.get("c5")?.score).toBeLessThan(strength.get("a5")!.score);
        expect(strength.get("c5")?.detail).toContain("Low sample cap");
    });

    test("engine mode keeps engine-best prep moves from showing zero when WDL is terrible", () => {
        const settings = normalizePrepBuilderSettings({
            mode: "engine",
            maxEngineCpLoss: 70,
        });
        const strength = getPrepMoveStrengthMap({
            side: "white",
            settings,
            openings: [
                { move: "Be3", white: 900, draw: 120, black: 2079 },
                { move: "h3", white: 1400, draw: 160, black: 67 },
            ],
            engineMoves: [
                { san: "Be3", scoreCpForSide: 19, rank: 1, source: "lichess" },
                { san: "h3", scoreCpForSide: -35, rank: 2, source: "lichess" },
            ],
        });

        expect(strength.get("Be3")?.engineCpLoss).toBe(0);
        expect(strength.get("Be3")?.score).toBeGreaterThan(50);
        expect(strength.get("Be3")?.detail).toContain("Engine floor");
    });

    test("prep builder branch priority accounts for practical danger", () => {
        const settings = normalizePrepBuilderSettings({ mode: "smart" });
        const riskyBranch = getPrepBuilderBranchValue({
            opening: { white: 18, draw: 2, black: 0 },
            userColor: "black",
            settings,
        });
        const solidBranch = getPrepBuilderBranchValue({
            opening: { white: 0, draw: 2, black: 18 },
            userColor: "black",
            settings,
        });

        expect(riskyBranch).toBeGreaterThan(solidBranch);
        expect(
            getPrepBuilderTaskPriority({
                branchShare: 0.12,
                branchValue: riskyBranch,
                ply: 2,
                settings,
            }),
        ).toBeGreaterThan(
            getPrepBuilderTaskPriority({
                branchShare: 0.12,
                branchValue: solidBranch,
                ply: 2,
                settings,
            }),
        );
    });

    test("prep builder gives common lines more depth and reply breadth than rare lines", () => {
        const settings = normalizePrepBuilderSettings({ mode: "smart", size: "deep" });
        const commonPolicy = getPrepBuilderReplyPolicy({ branchShare: 0.22, settings });
        const rarePolicy = getPrepBuilderReplyPolicy({ branchShare: 0.006, settings });

        expect(getPrepBuilderEffectiveMaxPly({ branchShare: 0.22, settings })).toBe(
            settings.maxPly,
        );
        expect(getPrepBuilderEffectiveMaxPly({ branchShare: 0.006, settings })).toBeLessThan(10);
        expect(commonPolicy.moveLimit).toBeGreaterThan(rarePolicy.moveLimit);
        expect(commonPolicy.minMoveShare).toBeLessThan(rarePolicy.minMoveShare);
    });

    test("prep builder raises the evidence floor for huge reference databases", () => {
        const deep = normalizePrepBuilderSettings({ mode: "smart", size: "deep" });
        const smallSourceFloor = getPrepBuilderEvidenceMinGames({
            settings: deep,
            rootGames: 500,
            ply: 20,
        });
        const lichessFloor = getPrepBuilderEvidenceMinGames({
            settings: deep,
            rootGames: 60_000_000,
            ply: 20,
        });

        expect(smallSourceFloor).toBe(deep.minOpponentGames);
        expect(lichessFloor).toBeGreaterThan(25);
        expect(
            getPrepBuilderStopReason({
                branchShare: 0.12,
                depthShare: 0.35,
                ply: 20,
                availableGames: 14,
                minGames: lichessFloor,
                settings: deep,
            }),
        ).toBe("Not enough games left");
    });

    test("prep builder keeps depth for lines made from common local replies", () => {
        const settings = normalizePrepBuilderSettings({ mode: "smart", size: "deep" });

        expect(
            getPrepBuilderStopReason({
                branchShare: 0.0001,
                depthShare: 0.35,
                ply: 20,
                settings,
            }),
        ).toBeNull();
        expect(
            getPrepBuilderStopReason({
                branchShare: 0.0001,
                ply: 2,
                settings,
            }),
        ).toBe("Line became too rare");
    });

    test("prep builder treats existing user replies as one forced repertoire move", () => {
        const store = createTreeStore();
        store.getState().makeMove({ payload: "e4" });
        store.getState().goToMove([]);
        store.getState().makeMove({ payload: "d4" });

        expect(store.getState().root.children.map((child) => child.san)).toEqual(["e4", "d4"]);
        expect(getPrepBuilderUserResponseChildIndex(store.getState().root)).toBe(0);
    });

    test("prep builder size presets hide depth thresholds behind simple choices", () => {
        const quick = normalizePrepBuilderSettings({ size: "quick" });
        const deep = normalizePrepBuilderSettings({ size: "deep" });

        expect("maxMoves" in quick).toBe(false);
        expect(quick.minOpponentMoveShare).toBeGreaterThan(deep.minOpponentMoveShare);
        expect(deep.opponentMoveLimit).toBeGreaterThan(quick.opponentMoveLimit);
        expect(deep.minOpponentMoveShare).toBeLessThan(3);
    });
});
