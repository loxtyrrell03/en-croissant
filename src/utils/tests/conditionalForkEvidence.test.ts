import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { findConditionalFork } from "../tacticalMotifs/conditionalForkEvidence";

const fen = "6k1/4qppp/8/n7/8/2P5/1Q3PPP/2R3K1 w - - 0 1";
const root = {
    fen,
    depth: 18,
    cp: 70,
    pvUci: ["b2b4", "e7b4", "c3b4", "h7h6", "g1f1", "g8f8", "f1e2", "f8e7"],
};
const after = makeFen(replayTacticalLine(fen, ["b2b4"])[0].after.toSetup());
const best = { fen: after, depth: 18, cp: -68, pvUci: root.pvUci.slice(1) };
const weak = {
    fen: after,
    depth: 18,
    cp: -400,
    pvUci: ["h7h6", "b4a5", "g8h7", "g1f1", "h7g6", "f1g1"],
};

test("a conditional fork can secure a long-term rook file through an exchange", () => {
    expect(findConditionalFork(fen, root, [best, weak])).toMatchObject({
        mechanism: "fork",
        mechanismPly: 1,
        payoffPly: 3,
        squares: ["b4", "a5", "e7"],
        lineUci: expect.arrayContaining(["h7h6", "b4a5"]),
    });
    const result = assessChessDecision({
        fen,
        candidates: [root],
        replyProbes: [{ moveUci: "b2b4", lines: [best, weak] }],
    });
    expect(result?.moves[0]).toMatchObject({ category: "mixed" });
    expect(result?.moves[0].positionalFactors).toContainEqual(
        expect.objectContaining({
            feature: "rook-file-access",
            squareOrFile: "c",
            firstPly: 3,
        }),
    );
    expect(result?.moves[0].tactical.reasons[0]).toContain("best reply Qxb4");
});

test("the geometric fork alone or an alternative without a material payoff cannot support the motif", () => {
    expect(findConditionalFork(fen, root, [best])).toBeNull();
    expect(findConditionalFork(fen, root, [best, { ...weak, cp: -72 }])).toBeNull();
    expect(findConditionalFork(fen, root, [best, { ...weak, upperbound: true }])).toBeNull();
    expect(
        findConditionalFork(fen, root, [best, { ...weak, pvUci: ["h7h6", "g1f1", "g8h7"] }]),
    ).toBeNull();
});
