import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { comparePawnStructure } from "../tacticalMotifs/decisionPawnStructure";

function frame(fen: string, cp: number, moves: string): DecisionEngineLine {
    return { fen, cp, depth: 20, pvUci: moves.split(" ") };
}

function rootAndReply(fen: string, paired: [number, string], independent: [number, string]) {
    const line = frame(fen, ...paired);
    const [first] = replayTacticalLine(fen, [line.pvUci[0]]);
    return [line, frame(makeFen(first.after.toSetup()), ...independent)] as const;
}

const queenTrade = (() => {
    const fen = "1r2rb1k/p2q2pp/1pp2p2/3b4/P1NPp3/1P2P2P/1B2QPP1/2R1R1K1 w - - 2 24";
    const [better, betterReply] = rootAndReply(
        fen,
        [-174, "c1c2 b6b5 c4d2 h7h6 e1c1 b5b4 d2c4 b8c8"],
        [179, "b6b5 c4d2 a7a5 e1a1 b8a8 c2c1 h7h6"],
    );
    const [played, playedReply] = rootAndReply(
        fen,
        [-243, "e2g4 d7g4 h3g4 b6b5 a4b5 c6b5 c4d2 e8c8"],
        [220, "d7g4 h3g4 b6b5 a4b5 c6b5 c4d2 e8c8"],
    );
    return { fen, better, played, betterReply, playedReply };
})();

test("compares the same doubled-pawn concession after exchanges settle", () => {
    const { fen, better, played, betterReply, playedReply } = queenTrade;
    const evidence = comparePawnStructure(fen, better, played, betterReply, playedReply);
    expect(evidence?.factor).toMatchObject({
        feature: "doubled-pawn",
        squareOrFile: "g",
        side: "white",
        firstPly: 3,
        materialWindowPlies: 7,
        comparisonGapCp: 69,
    });
    expect(evidence?.playedLineUci.at(-1)).toBe("c4d2");
});

test("abstains when the played search ends at the exchange", () => {
    const { fen, better, played, betterReply, playedReply } = queenTrade;
    const short = { ...playedReply, pvUci: playedReply.pvUci.slice(0, 5) };
    expect(comparePawnStructure(fen, better, played, betterReply, short)).toBeNull();
});

test("ignores doubled pawns that disappear on the next capture", () => {
    const fen = "1r3k2/5pp1/2p4p/p2p3P/PqPPnP2/4R1P1/Q3B1K1/8 w - - 1 35";
    const [better, betterReply] = rootAndReply(
        fen,
        [-36, "e2f3 b4b2 e3e2 b2d4 c4d5 c6d5 a2c2 e4f6"],
        [66, "f7f5 c4d5 b4d4 e3e2 d4c3 e2c2 c3e1"],
    );
    const [played, playedReply] = rootAndReply(
        fen,
        [-106, "c4d5 b4d4 a2a3 c6c5 a3d3 b8b4 d3d4 b4d4 e2b5"],
        [110, "b4d4 a2a3 c6c5 a3d3 b8b4 d3d4 b4d4 e2d3"],
    );
    expect(comparePawnStructure(fen, better, played, betterReply, playedReply)).toBeNull();
});

test("identifies the isolated c6 pawn after the opponent swaps off an unmoved knight", () => {
    const fen = "2kr3r/pp3pp1/2n1pbb1/1BP4p/1P2P3/2P2N1P/P1KN2P1/R3R3 b - - 1 17";
    const [better, betterReply] = rootAndReply(
        fen,
        [-195, "c6e5 d2c4 e5c4 b5c4 h5h4 c2b3 h8h5 e4e5"],
        [186, "d2c4 e5c4 b5c4 h5h4 c2b3 h8h5 e4e5"],
    );
    const [played, playedReply] = rootAndReply(
        fen,
        [-338, "h5h4 b5c6 b7c6 d2c4 c8c7 a2a4 h8h5 c2b3"],
        [339, "b5c6 b7c6 d2c4 h8h5 a2a4 c8c7 c2b3"],
    );
    const evidence = comparePawnStructure(fen, better, played, betterReply, playedReply);
    expect(evidence?.factor).toMatchObject({
        feature: "isolated-pawn",
        side: "black",
        squareOrFile: "c",
        materialWindowPlies: 6,
    });
    expect(evidence?.factor.description).toContain("bxc6 leaves an isolated pawn on c6");
    expect(evidence?.betterLineUci[0]).toBe("c6e5");
});

test("keeps pawn-structure evidence in the played-move diagnosis", () => {
    const { fen, better, played, betterReply, playedReply } = queenTrade;
    const report = assessChessDecision({
        fen,
        candidates: [better, played],
        comparisonCandidates: [better, played],
        playedMoveUci: played.pvUci[0],
        replyProbes: [
            { moveUci: better.pvUci[0], lines: [betterReply] },
            { moveUci: played.pvUci[0], lines: [playedReply] },
        ],
    });
    expect(report?.mistake?.category).toBe("positional");
    expect(report?.mistake?.tactical.support).toBe("unestablished");
    expect(report?.mistake?.evaluationLossCp).toBe(69);
    expect(report?.mistake?.pawnStructure?.factor.description).toContain("doubles the pawns");
});
