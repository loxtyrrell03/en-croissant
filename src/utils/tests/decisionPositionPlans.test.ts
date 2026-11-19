import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { findPositionStrategicPlan } from "../tacticalMotifs/decisionPositionPlans";

function candidate(fen: string, cp: number, moves: string) {
    return { fen, cp, depth: 20, pvUci: moves.split(" ") };
}

test("two distinct plans both address the same advanced passed pawn", () => {
    const fen = "8/4k3/8/3P4/8/8/1P6/K7 w - - 0 1";
    const king = candidate(fen, 40, "a1a2 e7d6 b2b3 d6c7 a2a3 c7d7 a3a4 d7d6");
    const pawn = candidate(fen, 35, "b2b3 e7d6 a1a2 d6e7 a2a3 e7d7 a3a4 d7d6");
    const plan = findPositionStrategicPlan(fen, [king, pawn]);
    expect(plan?.description).toContain("passed pawn from d5");
    expect(plan?.linesUci.map((line) => line[0])).toEqual(["a1a2", "b2b3"]);
    expect(assessChessDecision({ fen, candidates: [king, pawn] })?.position.category).toBe(
        "positional",
    );

    const elsewhere = candidate(fen, 30, "b2b3 e7f7 a1a2 f7g7 a2a3 g7g6 a3a4 g6h5");
    expect(findPositionStrategicPlan(fen, [king, elsewhere])).toBeNull();
    expect(findPositionStrategicPlan(fen, [king, { ...pawn, cp: -100 }])).toBeNull();
});

test("both alternatives can exploit an open file and trade the penetrating rook", () => {
    const fen = "1n3r1k/2brqbpp/1p6/p3p3/1p2N3/1P1NP1P1/P1R1QPBP/2R3K1 b - - 3 28";
    const lines = [
        candidate(fen, -175, "f7e6 d3b2 e6f5 h2h4 c7d8 c2c8 d7c7 c8c7 d8c7 b2c4 h7h6 c4d2"),
        candidate(fen, -177, "f7g6 d3b2 g6f5 h2h4 c7d8 c2c8 d7c7 c8c7 d8c7 e2c4 c7d8 c4b5"),
    ];
    const plan = findPositionStrategicPlan(fen, lines);
    expect(plan?.description).toContain("R8xc7 Bxc7 exchanges rooks on the file");
    expect(plan?.linesUci[0]).toEqual(lines[0].pvUci);
});

test("a defensive rook escape can expose tactical demand without a lasting positional benefit", () => {
    const fen = "r2r2k1/pp3ppp/1b6/3pnP2/3N2nq/1P2PR1B/P3N3/R1BQ2K1 w - - 4 24";
    const defend = candidate(fen, 0, "f3g3 g4f6 d1e1 g8h8 h3g2 f6h5 c1d2 h5g3 e1g3 h4g3 e2g3 d8e8");
    const permit = candidate(fen, -117, "d1f1 e5f3 d4f3 h4f6 f3d4 g4e5 c1d2 d8e8 a1d1 e5c6");
    const probe = (line: typeof defend) => ({
        moveUci: line.pvUci[0],
        lines: [
            {
                ...line,
                fen: makeFen(replayTacticalLine(fen, line.pvUci.slice(0, 1))[0].after.toSetup()),
                cp: -line.cp,
                pvUci: line.pvUci.slice(1),
            },
        ],
    });
    const report = assessChessDecision({
        fen,
        candidates: [defend, permit],
        replyProbes: [probe(defend)],
        positionReply: probe(permit),
    });
    expect(report?.position.category).toBe("tactical");
    expect(report?.position.tacticalContrast?.explanation).toContain("Nxf3+");
    expect(report?.position.positionalFactors).toEqual([]);
});
