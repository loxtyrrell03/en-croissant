import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { compareRookPressure } from "../tacticalMotifs/decisionRookPressure";

function study(
    fen: string,
    better: [string, number],
    played: [string, number],
    betterReply: [string, number],
    playedReply: [string, number],
) {
    const line = (board: string, [moves, cp]: [string, number]) => ({
        fen: board,
        pvUci: moves.split(" "),
        cp,
        depth: 20,
    });
    const after = (uci: string) => makeFen(replayTacticalLine(fen, [uci])[0].after.toSetup());
    const strong = line(fen, better);
    const weak = line(fen, played);
    return {
        fen,
        strong,
        weak,
        repeat: line(after(strong.pvUci[0]), betterReply),
        actual: line(after(weak.pvUci[0]), playedReply),
    };
}

const earlyEntry = study(
    "2kr1r2/1pqb2p1/p3p1P1/3pP1Pp/1P1N1P2/2P3Q1/8/R4RK1 w - - 5 28",
    ["a1a5 d8e8 a5c5 d7c6 g3e3 c7b6 c3c4 d5c4 c5c4 e8d8", 402],
    ["f1b1 c7b6 g3e3 f8e8 b1e1 c8b8 a1a5 e8e7 a5c5 d7e8", 165],
    ["d8e8 a5c5 d7c6 g3d3 c7b6 f4f5 f8f5 d4f5 e6f5 d3d5", -314],
    ["c7b6 g3e3 f8e8 b1e1 c8b8 g1g2 b8a8 f4f5 e6f5 e5e6", -143],
);

test("the earlier rook entry explains the played mistake and carries the compared lines", () => {
    const { fen, strong, weak, repeat, actual } = earlyEntry;
    const report = assessChessDecision({
        fen,
        candidates: [strong, weak],
        comparisonCandidates: [strong, weak],
        playedMoveUci: weak.pvUci[0],
        replyProbes: [
            { moveUci: strong.pvUci[0], lines: [repeat] },
            { moveUci: weak.pvUci[0], lines: [actual] },
        ],
    });
    expect(report?.mistake?.category).toBe("positional");
    expect(report?.mistake?.rookPressure).toMatchObject({
        factor: {
            feature: "rook-pawn-pressure",
            squareOrFile: "d5",
            firstPly: 3,
            lastConsecutivePly: 6,
        },
        betterLineUci: strong.pvUci.slice(0, 6),
        playedLineUci: weak.pvUci.slice(0, 6),
    });
    expect(report?.mistake?.positional.reasons.join(" ")).toContain("a rook on c5 keeps pressure");
    expect(
        report?.position.positionalFactors.every(
            (factor) => factor.feature !== "rook-pawn-pressure",
        ),
    ).toBe(true);
});

test("a different move order with equivalent early rook pressure removes the contrast", () => {
    const { fen, strong, weak, repeat, actual } = earlyEntry;
    const alternativeOrder = "d8e8 a1a5 d7c6 a5c5 c7b6 g3e3 e8d8 c3c4".split(" ");
    expect(replayTacticalLine(actual.fen, alternativeOrder)).toHaveLength(alternativeOrder.length);
    expect(
        compareRookPressure(fen, strong, weak, repeat, {
            ...actual,
            pvUci: alternativeOrder,
        }),
    ).toBeNull();
});

test("the independent continuation must come from the correct board", () => {
    const { fen, strong, weak, repeat, actual } = earlyEntry;
    expect(
        compareRookPressure(fen, strong, weak, { ...repeat, fen: actual.fen }, actual),
    ).toBeNull();
});

test("an absolutely pinned rook supplies no pressure when the capture stays illegal", () => {
    const { fen, strong, weak, repeat, actual } = study(
        "2r4k/5ppp/8/8/3p4/2R5/P4PPP/2K5 w - - 0 1",
        ["c3c4 h7h6 a2a3 h6h5 g2g3 h5h4", 100],
        ["a2a3 h7h6 g2g3 h6h5 a3a4 h5h4", 0],
        ["g7g6 a2a3 g6g5 g2g3 g5g4", -90],
        ["g7g6 h2h3 g6g5 a3a4 g5g4", 0],
    );
    const steps = replayTacticalLine(fen, strong.pvUci);
    expect(steps).toHaveLength(6);
    expect(steps[1].after.isLegal({ from: steps[0].move.to, to: parseSquare("d4")! })).toBe(false);
    expect(compareRookPressure(fen, strong, weak, repeat, actual)).toBeNull();
});

test("the h-pawn lever can set up lasting pressure from doubled rooks", () => {
    const { fen, strong, weak, repeat, actual } = study(
        "2r2r1k/pp2p2p/1n1pp1p1/8/4PPPP/1P6/P1PQNq2/1K1R3R w - - 3 24",
        ["h4h5 g6h5 h1h5 b6d7 d1h1 f8f7 e4e5 d7f8 e5d6 e7d6", 360],
        ["d1f1 f2g2 d2d3 d6d5 h4h5 g6g5 h1g1 g2e4 d3d2 e6e5", 158],
        ["g6h5 h1h5 b6d7 d1h1 f8f7 e4e5 d7f8 e5d6 e7d6 d2d3", -350],
        ["f2g2 d2d3 d6d5 h4h5 g6g5 h1g1 g2e4 d3d2 g5f4 e2f4", -144],
    );
    const result = compareRookPressure(fen, strong, weak, repeat, actual);
    expect(result?.factor.description).toContain(
        "rooks on h1 and h5 stay doubled against the pawn on h7",
    );
    expect(result?.factor.firstPly).toBe(5);
});
