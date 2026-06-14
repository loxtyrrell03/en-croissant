import { INITIAL_FEN } from "chessops/fen";
import { describe, expect, test } from "vitest";
import type { BestMoves, PlanExplorerData, PlanExplorerLine } from "@/bindings";
import {
    buildEnginePlanReport,
    engineReportToPlanExplorerData,
    getPlanExplorerLineEnginePlan,
    getPvMovePreviews,
} from "@/utils/enginePlanExplorer";
import {
    formatPlanPieceRoute,
    getAutoPlanLines,
    PLAN_BLACK_BRUSH,
    PLAN_WHITE_BRUSH,
    planLineToShapes,
    planLinesToShapes,
    summarizePlanPiece,
    type ColoredPlanExplorerLine,
} from "@/utils/planExplorer";

const BREAK_FEN = "rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const H_FILE_BREAK_FEN = "rnbqkbnr/pppppp1p/8/6p1/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CASTLING_FEN = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
const QUEENS_GAMBIT_NF3_FEN = "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 4";

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
        expect(e4Break?.approval).toBe("Strong");
        expect(e4Break?.confidence).toBe("High");
        expect(e4Break?.supportCount).toBe(2);
        expect(e4Break?.appearsInTopPv).toBe(true);
        expect(e4Break?.routeSquares).toEqual(["e2", "e4"]);

        const knightRoute = report.plans.find(
            (plan) => plan.signature === "piece_route:black:Nb8-d7-c5",
        );
        expect(knightRoute?.approval).toBe("OK");
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

        expect(setup?.approval).toBe("Strong");
        expect(setup?.supportCount).toBe(2);
        expect(setup?.appearsInTopPv).toBe(true);
        expect(setup?.plans.map((plan) => plan.signature)).toEqual(
            expect.arrayContaining([
                "pawn_setup:black:g6",
                "piece_destination:black:bishop:g7",
                "pawn_setup:black:d6",
                "piece_destination:black:knight:f6",
                "castling:black:kingside",
            ]),
        );
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
        expect(catalan?.approval).toBe("Strong");
        expect(catalan?.supportCount).toBe(2);
        expect(catalan?.appearsInTopPv).toBe(true);
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
        expect(match?.plan.approval).toBe("Strong");
        expect(match?.plan.supportCount).toBe(2);
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
