import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import {
    findPositionStrategicPlan,
    qualifyPositionFactors,
} from "../tacticalMotifs/decisionPositionPlans";
import type { ComparativePositionalEvidence } from "../tacticalMotifs/positionalTransitions";

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

const openFile = (squareOrFile: string): ComparativePositionalEvidence => ({
    feature: "open-rook-file",
    side: "black",
    squareOrFile,
    firstPly: 1,
    lastConsecutivePly: 7,
    description: "Black occupies a file with a rook.",
    support: "board-fact",
    comparison: "separate-reply-search",
    comparisonMoveUci: null,
    comparisonGapCp: null,
    supportInComparison: true,
    interpretation: "heuristic",
});

test("a rook on the back rank can use its file in a later equal exchange", () => {
    const fen = "r4rk1/1p1bqpb1/3p1np1/1N1Pp3/1P2Pn1p/4BQPP/3N1P2/2R1KB1R b K - 0 18";
    const line = candidate(fen, 347, "f8c8 d2b3 h4g3 f2g3 f4h5 h1g1 c8c1 b3c1 e7f8 b5c3 f8c8 e1d2");
    expect(qualifyPositionFactors(fen, line, [openFile("c")])[0]?.continuationEvidence).toBe(
        "Rxc1+ Nxc1 exchanges rooks on the file.",
    );
});

test("a balanced exchange also counts when the opposing rook takes first", () => {
    const fen = "r5k1/pp5p/5n2/8/8/8/6PP/4R1K1 b - - 0 1";
    const line = candidate(fen, 0, "a8e8 g2g3 b7b6 e1e8 f6e8 g3g4 e8f6 h2h4");
    const fact = { ...openFile("e"), lastConsecutivePly: 3 };
    expect(qualifyPositionFactors(fen, line, [fact])[0]?.continuationEvidence).toBe(
        "Rxe8+ Nxe8 exchanges rooks on the file.",
    );

    const incidental = { ...fact, comparison: "alternative-choice" as const };
    expect(qualifyPositionFactors(fen, line, [incidental])).toEqual([]);
});

test("a replacement rook on the same file cannot provide the original rook's payoff", () => {
    const fen = "r4rk1/pp6/8/8/8/1N6/6PP/2R1K3 b - - 0 1";
    const line = candidate(fen, 0, "f8c8 h2h3 c8d8 h3h4 a8c8 g2g3 c8c1 b3c1");
    expect(replayTacticalLine(fen, line.pvUci)).toHaveLength(8);
    expect(qualifyPositionFactors(fen, line, [openFile("c")])).toEqual([]);
});

const pawnSpace = (squareOrFile: string): ComparativePositionalEvidence => ({
    ...openFile(squareOrFile),
    feature: "pawn-space",
    before: 3,
    after: 4,
    unit: "relative-rank",
});

test("a pawn advance can restrict a square the other legal plan actually uses", () => {
    const fen = "1r3r2/pp4bk/2q2npp/P1p2P2/2Pp4/3P2PP/4N2K/1RBQ1R2 b - - 0 22";
    const clamp = candidate(fen, 23, "g6g5 e2g1 b7b6 a5b6 a7b6 d1f3 c6a4 h2h1");
    const trade = candidate(fen, -8, "g6f5 f1f5 f6d7 f5f8 b8f8 e2f4 d7e5 f4d5");
    const factor = {
        ...pawnSpace("g5"),
        comparison: "alternative-choice" as const,
        comparisonMoveUci: "g6f5",
    };
    expect(
        qualifyPositionFactors(fen, clamp, [factor], [clamp, trade])[0]?.continuationEvidence,
    ).toContain("Nf4 uses f4 in the other line");
    expect(qualifyPositionFactors(fen, clamp, [factor], [clamp])).toEqual([]);
});

test("a pawn holding its new rank without an observed role does not establish space", () => {
    const fen = "r2q1rk1/1p1b1p1p/1nn1p1p1/p2pP3/3P3b/4QN2/PP3PP1/RBB1RNK1 b - - 1 15";
    const line = candidate(
        fen,
        -162,
        "f7f5 e3h6 h4e7 f3g5 e7g5 c1g5 d8b8 f1h2 f8f7 h2f3 b8f8 h6h4",
    );
    expect(qualifyPositionFactors(fen, line, [pawnSpace("f5")])).toEqual([]);
});
