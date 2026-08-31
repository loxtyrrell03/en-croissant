import { INITIAL_FEN } from "chessops/fen";
import { describe, expect, test } from "vitest";
import type { BestMoves, PlanExplorerData, PlanExplorerLine } from "@/bindings";
import {
    buildEnginePlanReport,
    engineReportToPlanExplorerData,
    getPlanExplorerLineEnginePlan,
    getPvMovePreviews,
    selectDisplayEnginePlans,
    type EnginePlan,
} from "@/utils/enginePlanExplorer";
import {
    formatPlanPieceRoute,
    getAutoPlanLines,
    PLAN_BLACK_BRUSH,
    PLAN_WHITE_BRUSH,
    planLineToShapes,
    planLinesToShapes,
    planRouteSharePercent,
    summarizePlanPiece,
    type ColoredPlanExplorerLine,
} from "@/utils/planExplorer";

const BREAK_FEN = "rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const H_FILE_BREAK_FEN = "rnbqkbnr/pppppp1p/8/6p1/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CASTLING_FEN = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
const QUEENS_GAMBIT_NF3_FEN = "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 4";
const CATALAN_BLACK_TO_MOVE_FEN =
    "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/5NP1/PP2PP1P/RNBQKB1R b KQkq - 0 4";
const BLACK_FIANCHETTO_ROOT_FEN = "rnbqk2r/ppp1ppbp/3p1np1/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
const AFTER_D4_NF6_NF3_FEN = "rnbqkb1r/pppppppp/5n2/8/3P4/5N2/PPP1PPPP/RNBQKB1R b KQkq - 1 2";
const AFTER_D4_D5_FEN = "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2";
const BLACK_D5_BREAK_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

function pv(rank: number, uciMoves: string[], cp: number, depth = 12): BestMoves {
    return {
        nodes: 1000,
        depth,
        score: {
            value: {
                type: "cp",
                value: cp,
            },
            wdl: null,
        },
        uciMoves,
        sanMoves: uciMoves,
        multipv: rank,
        nps: 100000,
    };
}

function displayPlan(overrides: Partial<EnginePlan>): EnginePlan {
    return {
        signature: "test-plan",
        category: "pieceDestination",
        label: "Test plan",
        color: "white",
        role: "knight",
        context: "continuation",
        approval: "Unclear",
        confidence: "Medium",
        explanation: "Test evidence",
        supportCount: 2,
        supportRatio: 0.4,
        appearsInTopPv: true,
        directSupportCount: 0,
        directSupportRatio: 0,
        directAppearsInTopPv: false,
        conditionalSupportCount: 2,
        conditionalSupportRatio: 0.4,
        conditionalAppearsInTopPv: true,
        evidence: [],
        bestEvalCp: null,
        averageEvalCp: null,
        weightedEvalCp: null,
        bestQualityCp: null,
        averageQualityCp: null,
        weightedQualityCp: null,
        bestCpLoss: null,
        weightedCpLoss: null,
        medianCompletionPly: 2,
        ...overrides,
    };
}

describe("Engine Plan Explorer", () => {
    test("extracts and scores recurring PV plan signals", () => {
        const report = buildEnginePlanReport(
            BREAK_FEN,
            [
                pv(1, ["g1f3", "g8f6", "e2e4", "b8d7", "d2d4", "d7c5"], 30),
                pv(2, ["g1f3", "b8d7", "e2e4", "g8f6", "d2d4", "c7c5"], 10),
                pv(3, ["c2c4", "g8f6", "b1c3", "e7e5"], 0),
            ],
            {
                requestedMultipv: 5,
                limitLabel: "Depth 12",
            },
        );

        const e4Break = report.plans.find((plan) => plan.signature === "pawn_break:white:e4");
        expect(e4Break?.approval).toBe("Unclear");
        expect(e4Break?.confidence).toBe("Medium");
        expect(e4Break?.context).toBe("continuation");
        expect(e4Break?.supportCount).toBe(2);
        expect(e4Break?.appearsInTopPv).toBe(true);
        expect(e4Break?.routeSquares).toEqual(["e2", "e4"]);
        expect(e4Break?.weightedEvalCp).toBeNull();
        expect(e4Break?.explanation).toContain("conditional PV-supported continuation");

        const knightRoute = report.plans.find(
            (plan) => plan.signature === "piece_route:black:Nb8-d7-c5",
        );
        expect(knightRoute?.approval).toBe("Unclear");
        expect(knightRoute?.context).toBe("opponentResponse");
        expect(knightRoute?.routeSquares).toEqual(["b8", "d7", "c5"]);

        const knightDestination = report.plans.find(
            (plan) => plan.signature === "piece_destination:black:knight:c5",
        );
        expect(knightDestination).toBeUndefined();

        const singleMoveKnightDestination = report.plans.find(
            (plan) => plan.signature === "piece_destination:white:knight:f3",
        );
        expect(singleMoveKnightDestination?.supportCount).toBe(2);
        expect(singleMoveKnightDestination?.label).toBe("White knight reaches f3");
        expect(
            report.plans.find((plan) => plan.signature === "piece_route:white:Ng1-f3"),
        ).toBeUndefined();

        const planData = engineReportToPlanExplorerData(report);
        const e2Pawn = planData.pieces.find((piece) => piece.from === "e2");
        const e4Line = planData.pieces
            .flatMap((piece) => piece.lines)
            .find((line) => line.squares.join("-") === "e2-e4");
        expect(e2Pawn?.role).toBe("pawn");
        expect(e4Line?.squares).toEqual(["e2", "e4"]);
    });

    test("records a piece route's completion ply at its final tracked move", () => {
        // The knight reaches its final square d5 on its second move, at index 6 of
        // the PV, so that route's evidence line is completed at ply 6.
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(1, ["b1c3", "b8c6", "e2e4", "e7e5", "g1f3", "g8f6", "c3d5"], 20),
                pv(2, ["e2e4", "e7e5", "g1f3", "b8c6"], 15),
                pv(3, ["d2d4", "d7d5"], 10),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const route = report.plans.find((plan) => plan.signature === "piece_route:white:Nb1-c3-d5");
        expect(route).toBeDefined();
        expect(route?.evidence.find((line) => line.rank === 1)?.completionPly).toBe(6);
    });

    test("marks one low-ranked unsupported plan as weak", () => {
        const report = buildEnginePlanReport(
            H_FILE_BREAK_FEN,
            [
                pv(1, ["e2e4"], 30),
                pv(2, ["d2d4"], 20),
                pv(3, ["g1f3"], 15),
                pv(4, ["c2c4"], 10),
                pv(5, ["h2h4"], -250),
            ],
            {
                requestedMultipv: 5,
                limitLabel: "Depth 12",
            },
        );

        const h4Break = report.plans.find((plan) => plan.signature === "pawn_break:white:h4");
        expect(h4Break?.approval).toBe("Weak");
        expect(h4Break?.confidence).toBe("Low");
        expect(h4Break?.appearsInTopPv).toBe(false);
        expect(h4Break?.bestCpLoss).toBe(280);
    });

    test("uses unclear when there are not enough PVs", () => {
        const report = buildEnginePlanReport(BREAK_FEN, [pv(1, ["e2e4"], 30)], {
            requestedMultipv: 5,
            limitLabel: "Depth 12",
        });

        const e4Break = report.plans.find((plan) => plan.signature === "pawn_break:white:e4");
        expect(e4Break?.approval).toBe("Unclear");
        expect(e4Break?.explanation).toContain("not enough PVs");
    });

    test("does not mark quiet pawn advances as pawn breaks", () => {
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [pv(1, ["e2e4"], 30), pv(2, ["c2c4"], 20), pv(3, ["h2h4"], 10)],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        expect(report.plans.some((plan) => plan.category === "pawnBreak")).toBe(false);
    });

    test("builds engine-only setup families from co-occurring PV plans", () => {
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(
                    1,
                    [
                        "d2d4",
                        "g8f6",
                        "c1f4",
                        "g7g6",
                        "e2e3",
                        "f8g7",
                        "g1f3",
                        "d7d6",
                        "f1e2",
                        "e8g8",
                    ],
                    30,
                ),
                pv(
                    2,
                    [
                        "d2d4",
                        "g8f6",
                        "g1f3",
                        "g7g6",
                        "c1f4",
                        "f8g7",
                        "e2e3",
                        "d7d6",
                        "f1e2",
                        "e8g8",
                    ],
                    20,
                ),
                pv(3, ["d2d4", "d7d5", "c1f4", "g8f6", "e2e3", "e7e6"], 0),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const setup = report.setups.find((candidate) => {
            const signatures = new Set(candidate.plans.map((plan) => plan.signature));
            return (
                candidate.color === "black" &&
                signatures.has("pawn_setup:black:g6") &&
                signatures.has("piece_destination:black:bishop:g7") &&
                signatures.has("pawn_setup:black:d6") &&
                signatures.has("piece_destination:black:knight:f6") &&
                signatures.has("castling:black:kingside")
            );
        });

        expect(setup?.approval).toBe("Unclear");
        expect(setup?.context).toBe("opponentResponse");
        expect(setup?.supportCount).toBe(2);
        expect(setup?.appearsInTopPv).toBe(true);
        expect(setup?.weightedEvalCp).toBeNull();
        expect(setup?.plans.map((plan) => plan.signature)).toEqual(
            expect.arrayContaining([
                "pawn_setup:black:g6",
                "piece_destination:black:bishop:g7",
                "pawn_setup:black:d6",
                "piece_destination:black:knight:f6",
                "castling:black:kingside",
            ]),
        );
        // Both supporting PVs land the last component (kingside castling, ...O-O)
        // at ply 9, so the median completion ply is 9.
        expect(setup?.medianCompletionPly).toBe(9);
    });

    test("combines root structure with PV moves to suggest Catalan setups", () => {
        const report = buildEnginePlanReport(
            QUEENS_GAMBIT_NF3_FEN,
            [
                pv(1, ["g2g3", "f8e7", "f1g2", "e8g8", "e1g1", "c7c6"], 34),
                pv(2, ["g2g3", "d5c4", "f1g2", "f8e7", "e1g1", "e8g8"], 24),
                pv(3, ["b1c3", "f8e7", "c1g5", "e8g8", "e2e3", "c7c6"], 8),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const catalan = report.setups.find((setup) => {
            const signatures = new Set(setup.plans.map((plan) => plan.signature));
            return (
                setup.archetype === "Catalan" &&
                setup.color === "white" &&
                signatures.has("pawn_setup:white:d4") &&
                signatures.has("pawn_setup:white:c4") &&
                signatures.has("piece_destination:white:knight:f3") &&
                signatures.has("pawn_setup:white:g3") &&
                signatures.has("piece_destination:white:bishop:g2")
            );
        });

        expect(catalan?.label).toContain("Catalan");
        expect(catalan?.approval).toBe("Unclear");
        expect(catalan?.context).toBe("continuation");
        expect(catalan?.supportCount).toBe(2);
        expect(catalan?.appearsInTopPv).toBe(true);
        expect(catalan?.weightedEvalCp).toBeNull();
        // d4/c4/Nf3 are already on the board and are ignored as completion
        // evidence. The PV moves g3 (0), Bg2 (2) and O-O (4) drive completion,
        // so both PVs finish the setup at ply 4.
        expect(catalan?.medianCompletionPly).toBe(4);
        expect(
            catalan?.plans.some(
                (plan) =>
                    plan.origin === "pv" &&
                    (plan.category === "pawnSetup" || plan.category === "castling") &&
                    new Set(plan.evidence.map((line) => line.rank)).size >= 2,
            ),
        ).toBe(true);
    });

    test("does not manufacture a full Catalan setup from one g3 PV", () => {
        const report = buildEnginePlanReport(
            QUEENS_GAMBIT_NF3_FEN,
            [
                pv(1, ["g2g3", "f8e7", "b1c3"], 34),
                pv(2, ["b1c3", "f8e7", "c1g5"], 20),
                pv(3, ["e2e3", "f8e7", "f1d3"], 10),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const catalan = report.setups.find((setup) => setup.archetype === "Catalan");
        expect(catalan).toBeUndefined();
    });

    test("does not manufacture a full King's Indian setup from one ...g6 PV", () => {
        const report = buildEnginePlanReport(
            AFTER_D4_NF6_NF3_FEN,
            [
                pv(1, ["g7g6", "c2c4", "f8g7"], 20),
                pv(2, ["e7e6", "c2c4", "d7d5"], 12),
                pv(3, ["d7d5", "c2c4", "e7e6"], 6),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const kid = report.setups.find((setup) => setup.archetype === "King's Indian");
        expect(kid).toBeUndefined();
    });

    test("does not promote King's Indian from generic Nf6 and castling evidence", () => {
        const report = buildEnginePlanReport(
            CATALAN_BLACK_TO_MOVE_FEN,
            [
                pv(1, ["d5c4", "f1g2", "f8b4", "c1d2", "e8g8"], 23),
                pv(2, ["f8e7", "f1g2", "e8g8", "e1g1"], 42),
                pv(3, ["b8c6", "f1g2", "f8d6", "e1g1", "e8g8"], 45),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 18",
            },
        );

        expect(
            report.plans.some(
                (plan) =>
                    plan.signature === "pawn_setup:black:g6" ||
                    plan.signature === "piece_destination:black:bishop:g7",
            ),
        ).toBe(false);
        expect(report.setups.find((setup) => setup.archetype === "King's Indian")).toBeUndefined();

        const be7 = report.plans.find(
            (plan) => plan.signature === "piece_destination:black:bishop:e7",
        );
        expect(be7?.bestCpLoss).toBe(19);
    });

    test("does not fill a London setup from one-move template evidence", () => {
        const report = buildEnginePlanReport(
            AFTER_D4_D5_FEN,
            [
                pv(1, ["c1f4", "g8f6", "g1f3"], 28),
                pv(2, ["c2c4", "e7e6", "g1f3"], 24),
                pv(3, ["g1f3", "g8f6", "c1f4"], 18),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const london = report.setups.find((setup) => setup.archetype === "London");
        expect(london).toBeUndefined();
    });

    test("does not merge unrelated root choices around pre-existing setup anchors", () => {
        const report = buildEnginePlanReport(
            BLACK_FIANCHETTO_ROOT_FEN,
            [pv(1, ["e8g8"], 30), pv(2, ["b8c6"], 20), pv(3, ["c8g4"], 10), pv(4, ["c8f5"], 8)],
            {
                requestedMultipv: 4,
                limitLabel: "Depth 12",
            },
        );

        const skeletonSetups = report.setups.filter((setup) => {
            const signatures = new Set(setup.plans.map((plan) => plan.signature));
            return (
                setup.color === "black" &&
                signatures.has("pawn_setup:black:g6") &&
                signatures.has("pawn_setup:black:d6")
            );
        });
        expect(report.plans.some((plan) => plan.signature === "castling:black:kingside")).toBe(
            true,
        );
        expect(
            report.plans.some((plan) => plan.signature === "piece_destination:black:knight:c6"),
        ).toBe(true);
        expect(skeletonSetups).toEqual([]);
    });

    test("builds per-move board previews from a PV", () => {
        const previews = getPvMovePreviews(INITIAL_FEN, ["e2e4", "c7c5"], ["e4", "c5"]);

        expect(previews).toHaveLength(2);
        expect(previews[0]).toMatchObject({
            san: "e4",
            from: "e2",
            to: "e4",
            color: "white",
            moveNumber: 1,
        });
        expect(previews[1]).toMatchObject({
            san: "c5",
            from: "c7",
            to: "c5",
            color: "black",
            moveNumber: 1,
        });
    });

    test("keeps side expansion pawn arrows available for board previews", () => {
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(1, ["b2b4", "g8f6", "c2c4"], 30),
                pv(2, ["c2c4", "g8f6", "b2b4"], 20),
                pv(3, ["b2b3", "g8f6", "c2c4"], 10),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const expansion = report.plans.find(
            (plan) => plan.signature === "side_expansion:white:queenside",
        );
        expect(expansion?.routeSegments).toEqual([
            ["b2", "b4"],
            ["c2", "c4"],
        ]);

        const planData = engineReportToPlanExplorerData(report);
        const expansionLine = planData.pieces
            .flatMap((piece) => piece.lines)
            .find((line) => "segments" in line) as ColoredPlanExplorerLine | undefined;

        expect(expansionLine?.segments).toEqual([
            ["b2", "b4"],
            ["c2", "c4"],
        ]);
        expect(
            planLineToShapes(expansionLine ?? emptyLine()).map((shape) => [shape.orig, shape.dest]),
        ).toEqual([
            ["b2", "b4"],
            ["c2", "c4"],
        ]);
    });

    test("extracts and labels castling from standard and rook-square UCI", () => {
        const report = buildEnginePlanReport(
            CASTLING_FEN,
            [pv(1, ["e8h8"], 30), pv(2, ["e8g8"], 20), pv(3, ["e8a8"], 10)],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const kingside = report.plans.find((plan) => plan.signature === "castling:black:kingside");
        expect(kingside?.category).toBe("castling");
        expect(kingside?.label).toBe("Black castles kingside");
        expect(kingside?.supportCount).toBe(2);
        expect(kingside?.routeSquares).toEqual(["e8", "g8"]);

        const queenside = report.plans.find(
            (plan) => plan.signature === "castling:black:queenside",
        );
        expect(queenside?.routeSquares).toEqual(["e8", "c8"]);

        const planData = engineReportToPlanExplorerData(report);
        const king = planData.pieces.find((piece) => piece.role === "king" && piece.from === "e8");
        expect(king && summarizePlanPiece(king)).toBe("Kingside castling");

        const legacyLineMatch = getPlanExplorerLineEnginePlan(
            { color: "black", role: "king" },
            {
                ...emptyLine(),
                squares: ["e8", "h8", "f8"],
            },
            report,
        );
        expect(legacyLineMatch?.match).toBe("castling");
        expect(legacyLineMatch?.plan.signature).toBe("castling:black:kingside");
    });

    test("balances automatic plan arrows across both sides", () => {
        const data: PlanExplorerData = {
            fen: INITIAL_FEN,
            total_games: 100,
            sampled_games: 100,
            max_plies: 8,
            setups: [],
            pieces: [
                planPiece("white", "knight", "g1", 100, ["g1", "f3"]),
                planPiece("white", "bishop", "f1", 90, ["f1", "b5"]),
                planPiece("black", "knight", "g8", 80, ["g8", "f6"]),
                planPiece("black", "bishop", "f8", 70, ["f8", "b4"]),
            ],
        };

        expect(getAutoPlanLines(data, 4).map((line) => line.color)).toEqual([
            "white",
            "black",
            "white",
            "black",
        ]);
    });

    test("keeps single-PV engine plan arrows available for the board", () => {
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [pv(1, ["g1f3"], 30), pv(2, ["b1c3"], 20)],
            {
                requestedMultipv: 2,
                limitLabel: "Depth 12",
            },
        );
        const data = engineReportToPlanExplorerData(report);

        expect(getAutoPlanLines(data, 4)).toHaveLength(0);
        expect(getAutoPlanLines(data, 4, { minGames: 1 }).map((line) => line.squares)).toEqual([
            ["b1", "c3"],
            ["g1", "f3"],
        ]);
    });

    test("balances rendered auto arrows even when one plan has multiple arrows", () => {
        const data: PlanExplorerData = {
            fen: INITIAL_FEN,
            total_games: 100,
            sampled_games: 100,
            max_plies: 8,
            setups: [],
            pieces: [
                planPiece("white", "queen", "d1", 100, ["d1", "d2", "d3", "d4"]),
                planPiece("white", "rook", "a1", 95, ["a1", "a3"]),
                planPiece("white", "bishop", "c1", 90, ["c1", "g5"]),
                planPiece("white", "knight", "b1", 85, ["b1", "c3"]),
                planPiece("white", "bishop", "f1", 80, ["f1", "b5"]),
                planPiece("black", "knight", "g8", 30, ["g8", "f6"]),
                planPiece("black", "bishop", "f8", 25, ["f8", "b4"]),
                planPiece("black", "queen", "d8", 20, ["d8", "d6"]),
            ],
        };

        const shapes = planLinesToShapes(getAutoPlanLines(data, 6), 6);
        const whiteShapes = shapes.filter((shape) => shape.brush === PLAN_WHITE_BRUSH);
        const blackShapes = shapes.filter((shape) => shape.brush === PLAN_BLACK_BRUSH);

        expect(whiteShapes).toHaveLength(3);
        expect(blackShapes).toHaveLength(3);
    });

    test("matches database plan lines to engine plan strength signals", () => {
        const report = buildEnginePlanReport(
            BREAK_FEN,
            [
                pv(1, ["g1f3", "g8f6", "e2e4"], 30),
                pv(2, ["g1f3", "g8f6", "e2e4"], 20),
                pv(3, ["c2c4", "g8f6"], 0),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const match = getPlanExplorerLineEnginePlan(
            {
                color: "white",
                role: "pawn",
            },
            {
                ...emptyLine(),
                squares: ["e2", "e4"],
                games: 20,
            },
            report,
        );

        expect(match?.match).toBe("pawnBreak");
        expect(match?.plan.approval).toBe("Unclear");
        expect(match?.plan.context).toBe("continuation");
        expect(match?.plan.supportCount).toBe(2);
        expect(match?.plan.bestCpLoss).toBeNull();
    });

    test("matches database pawn setup lines to engine setup signals", () => {
        const report = buildEnginePlanReport(
            AFTER_D4_D5_FEN,
            [
                pv(1, ["g2g3", "g8f6", "f1g2"], 30),
                pv(2, ["g2g3", "e7e6", "f1g2"], 20),
                pv(3, ["c2c4", "g8f6"], 0),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const match = getPlanExplorerLineEnginePlan(
            {
                color: "white",
                role: "pawn",
            },
            {
                ...emptyLine(),
                squares: ["g2", "g3"],
                games: 20,
            },
            report,
        );

        expect(match?.match).toBe("pawnSetup");
        expect(match?.plan.signature).toBe("pawn_setup:white:g3");
        expect(match?.plan.approval).toBe("Strong");
    });

    test("summarizes database plan groups with concise chess labels", () => {
        expect(summarizePlanPiece(planPiece("white", "knight", "g1", 12, ["g1", "f3", "g5"]))).toBe(
            "Minor piece reroute to kingside",
        );
        expect(summarizePlanPiece(planPiece("white", "pawn", "b2", 10, ["b2", "b4"]))).toBe(
            "Queenside pawn break",
        );
        expect(summarizePlanPiece(planPiece("white", "rook", "h1", 8, ["h1", "h3"]))).toBe(
            "Rook lift",
        );
        expect(summarizePlanPiece(planPiece("white", "pawn", "e2", 15, ["e2", "e4"]))).toBe(
            "Central expansion",
        );
        expect(summarizePlanPiece(planPiece("black", "king", "e8", 42, ["e8", "h8", "f8"]))).toBe(
            "Kingside castling",
        );
        expect(
            formatPlanPieceRoute(
                { color: "black", role: "king" },
                {
                    ...emptyLine(),
                    squares: ["e8", "h8", "f8"],
                },
            ),
        ).toBe("O-O (e8 -> g8)");
    });

    test("marks black ...d5 as a pawn break against a white e4 pawn", () => {
        const report = buildEnginePlanReport(
            BLACK_D5_BREAK_FEN,
            [
                pv(1, ["d7d5", "g1f3", "g8f6"], 10),
                pv(2, ["e7e5", "g1f3"], 25),
                pv(3, ["c7c5", "g1f3"], 30),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const d5Break = report.plans.find((plan) => plan.signature === "pawn_break:black:d5");
        expect(d5Break).toBeDefined();
        expect(d5Break?.category).toBe("pawnBreak");
        expect(d5Break?.routeSquares).toEqual(["d7", "d5"]);
    });

    test("recognizes a white f4 pawn setup and the Stonewall archetype from d4+f4", () => {
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(
                    1,
                    [
                        "d2d4",
                        "g8f6",
                        "e2e3",
                        "d7d5",
                        "f2f4",
                        "e7e6",
                        "f1d3",
                        "f8e7",
                        "g1f3",
                        "e8g8",
                    ],
                    30,
                ),
                pv(
                    2,
                    [
                        "d2d4",
                        "d7d5",
                        "e2e3",
                        "g8f6",
                        "f2f4",
                        "e7e6",
                        "g1f3",
                        "f8d6",
                        "f1d3",
                        "e8g8",
                    ],
                    20,
                ),
                pv(3, ["g1f3", "d7d5", "d2d4", "g8f6", "e2e3", "e7e6"], 10),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const f4Setup = report.plans.find((plan) => plan.signature === "pawn_setup:white:f4");
        expect(f4Setup).toBeDefined();
        expect(f4Setup?.category).toBe("pawnSetup");
        expect(f4Setup?.supportCount).toBe(2);

        const stonewall = report.setups.find((setup) => setup.archetype === "Stonewall");
        expect(stonewall?.color).toBe("white");
    });

    test("keeps direct root-choice scoring separate from later recurring support", () => {
        const report = buildEnginePlanReport(
            BREAK_FEN,
            [
                pv(1, ["e2e4", "g8f6"], 100),
                pv(2, ["g1f3", "g8f6", "e2e4"], 90),
                pv(3, ["b1c3", "g8f6", "e2e4"], 80),
                pv(4, ["d2d4", "g8f6", "e2e4"], 60),
                pv(5, ["c2c4", "g8f6", "g1f3"], 30),
                pv(6, ["h2h3"], 10),
                pv(7, ["a2a3"], 5),
                pv(8, ["b2b3"], 0),
                pv(9, ["g2g3"], -10),
                pv(10, ["f2f3"], -20),
                pv(11, ["a2a4"], -30),
                pv(12, ["h2h4"], -40),
            ],
            {
                requestedMultipv: 12,
                limitLabel: "Depth 20",
            },
        );

        const e4Break = report.plans.find((plan) => plan.signature === "pawn_break:white:e4");
        expect(e4Break?.context).toBe("rootChoice");
        expect(e4Break?.supportCount).toBe(1);
        expect(e4Break?.directSupportCount).toBe(1);
        expect(e4Break?.conditionalSupportCount).toBe(3);
        expect(e4Break?.appearsInTopPv).toBe(true);
        expect(e4Break?.approval).toBe("Strong");
        expect(e4Break?.confidence).toBe("Medium");
        expect(e4Break?.bestCpLoss).toBe(0);
        expect(
            report.plans.some((plan) => plan.signature === "piece_destination:white:knight:f3"),
        ).toBe(true);
        expect(
            report.displayPlans.some(
                (plan) => plan.signature === "piece_destination:white:knight:f3",
            ),
        ).toBe(false);
        expect(report.displayPlans.length).toBeLessThanOrEqual(8);
    });

    test("keeps recurring and top-PV pawn squares as setup evidence without listing them", () => {
        const recurring = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(1, ["g1f3", "g8f6", "g2g3"], 40),
                pv(2, ["c2c4", "g8f6", "g2g3"], 20),
                pv(3, ["d2d4", "g8f6", "a2a3"], 0),
            ],
            { requestedMultipv: 3, limitLabel: "Depth 12" },
        );
        const topRoot = buildEnginePlanReport(
            INITIAL_FEN,
            [pv(1, ["g2g3", "g8f6"], 40), pv(2, ["g1f3", "g8f6"], 20)],
            { requestedMultipv: 2, limitLabel: "Depth 12" },
        );
        const recurringG3 = recurring.plans.find(
            (plan) => plan.signature === "pawn_setup:white:g3",
        );
        const topG3 = topRoot.plans.find((plan) => plan.signature === "pawn_setup:white:g3");

        expect(recurringG3).toMatchObject({ context: "continuation", supportCount: 2 });
        expect(recurring.displayPlans).not.toContain(recurringG3);
        expect(topG3).toMatchObject({ context: "rootChoice", directAppearsInTopPv: true });
        expect(topRoot.displayPlans).not.toContain(topG3);
    });

    test("keeps a destination that recurs outside PV1", () => {
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [pv(1, ["g1f3", "e7e5"], 40), pv(2, ["c2c4", "g8f6"], 20), pv(3, ["d2d4", "g8f6"], 0)],
            { requestedMultipv: 3, limitLabel: "Depth 12" },
        );
        const f6 = report.plans.find(
            (plan) => plan.signature === "piece_destination:black:knight:f6",
        );

        expect(f6).toMatchObject({
            context: "opponentResponse",
            supportCount: 2,
            appearsInTopPv: false,
        });
        expect(report.displayPlans).toContain(f6);
    });

    test("keeps heavy-piece routes internally without presenting tactical paths as plans", () => {
        const fen = "4k3/8/8/8/8/8/8/3QK3 w - - 0 1";
        const report = buildEnginePlanReport(fen, [pv(1, ["d1a4", "e8e7", "a4b5"], 20)], {
            requestedMultipv: 1,
            limitLabel: "Depth 12",
        });
        const queenRoute = report.plans.find((plan) => plan.category === "pieceRoute");

        expect(queenRoute).toMatchObject({ role: "queen", context: "continuation" });
        expect(report.displayPlans).not.toContain(queenRoute);
    });

    test("caps routine destinations so a concrete break still has display room", () => {
        const plans = [
            displayPlan({ signature: "n1", label: "Knight one", supportCount: 5 }),
            displayPlan({ signature: "n2", label: "Knight two", supportCount: 4 }),
            displayPlan({ signature: "n3", label: "Knight three", supportCount: 3 }),
            displayPlan({
                signature: "break",
                category: "pawnBreak",
                label: "Central pawn break",
                role: "pawn",
                supportCount: 2,
            }),
        ];

        const displayed = selectDisplayEnginePlans(plans);
        expect(displayed.filter((plan) => plan.category === "pieceDestination")).toHaveLength(2);
        expect(displayed.map((plan) => plan.signature)).toContain("break");
    });

    test("measures route prevalence against all sampled games", () => {
        expect(planRouteSharePercent(20, 100)).toBe(20);
        expect(planRouteSharePercent(20, 25)).toBe(80);
        expect(planRouteSharePercent(20, 0)).toBe(0);
    });

    test("drops recurring pawn bags that have only one salient setup anchor", () => {
        const report = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(1, ["e2e4", "g8f6", "d2d3", "b8c6", "c2c3", "e7e6", "g1f3", "f8e7"], 30),
                pv(2, ["e2e4", "b8c6", "d2d3", "g8f6", "c2c3", "e7e6", "g1f3", "f8e7"], 20),
                pv(3, ["e2e4", "g8f6", "d2d3", "b8c6", "g1f3", "e7e6"], 10),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );

        const whiteSetups = report.setups.filter((setup) => {
            const signatures = new Set(setup.plans.map((plan) => plan.signature));
            return (
                setup.color === "white" &&
                signatures.has("pawn_setup:white:e4") &&
                signatures.has("pawn_setup:white:d3") &&
                signatures.has("piece_destination:white:knight:f3")
            );
        });

        expect(whiteSetups).toEqual([]);
    });

    test("recognizes King's Indian Attack only when its required signatures are present", () => {
        const withD3 = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(
                    1,
                    [
                        "g1f3",
                        "d7d5",
                        "g2g3",
                        "g8f6",
                        "f1g2",
                        "e7e6",
                        "e1g1",
                        "f8e7",
                        "d2d3",
                        "e8g8",
                    ],
                    30,
                ),
                pv(
                    2,
                    [
                        "g1f3",
                        "g8f6",
                        "g2g3",
                        "d7d5",
                        "f1g2",
                        "e7e6",
                        "e1g1",
                        "f8e7",
                        "d2d3",
                        "e8g8",
                    ],
                    24,
                ),
                pv(
                    3,
                    [
                        "g2g3",
                        "d7d5",
                        "f1g2",
                        "g8f6",
                        "g1f3",
                        "e7e6",
                        "e1g1",
                        "f8e7",
                        "d2d3",
                        "e8g8",
                    ],
                    18,
                ),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );
        expect(
            withD3.setups.find((setup) => setup.archetype === "King's Indian Attack"),
        ).toBeDefined();

        const withoutD3 = buildEnginePlanReport(
            INITIAL_FEN,
            [
                pv(
                    1,
                    [
                        "g1f3",
                        "d7d5",
                        "g2g3",
                        "g8f6",
                        "f1g2",
                        "e7e6",
                        "e1g1",
                        "f8e7",
                        "b1c3",
                        "e8g8",
                    ],
                    30,
                ),
                pv(
                    2,
                    [
                        "g1f3",
                        "g8f6",
                        "g2g3",
                        "d7d5",
                        "f1g2",
                        "e7e6",
                        "e1g1",
                        "f8e7",
                        "b1c3",
                        "e8g8",
                    ],
                    24,
                ),
                pv(
                    3,
                    [
                        "g2g3",
                        "d7d5",
                        "f1g2",
                        "g8f6",
                        "g1f3",
                        "e7e6",
                        "e1g1",
                        "f8e7",
                        "b1c3",
                        "e8g8",
                    ],
                    18,
                ),
            ],
            {
                requestedMultipv: 3,
                limitLabel: "Depth 12",
            },
        );
        expect(
            withoutD3.setups.find((setup) => setup.archetype === "King's Indian Attack"),
        ).toBeUndefined();
    });
});

function planPiece(color: string, role: string, from: string, games: number, squares: string[]) {
    return {
        color,
        role,
        from,
        total: games,
        lines: [
            {
                ...emptyLine(),
                squares,
                games,
            },
        ],
    };
}

function emptyLine(): PlanExplorerLine {
    return {
        squares: [],
        san: [],
        uci: [],
        games: 0,
        white: 0,
        draw: 0,
        black: 0,
    };
}
