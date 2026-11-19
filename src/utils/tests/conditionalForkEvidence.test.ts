import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import neutralizedForks from "../../../benchmarks/decision-evidence/exact-fork-supervision/neutralized-forks.json";
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
    expect(result?.moves[0].conditionalFork).toMatchObject({
        defenceConsequence: { kind: "rook-file" },
        bestReplyLineUci: expect.arrayContaining(["b2b4", "e7b4", "c3b4"]),
    });
    expect(result?.position.conditionalFork?.defenceConsequence?.kind).toBe("rook-file");
});

test("the geometric fork alone or an alternative without a material payoff cannot support the motif", () => {
    expect(findConditionalFork(fen, root, [best])).toBeNull();
    expect(findConditionalFork(fen, root, [best, { ...weak, cp: -72 }])).toBeNull();
    expect(findConditionalFork(fen, root, [best, { ...weak, upperbound: true }])).toBeNull();
    expect(
        findConditionalFork(fen, root, [best, { ...weak, pvUci: ["h7h6", "g1f1", "g8h7"] }]),
    ).toBeNull();
});

test.each(neutralizedForks)("keeps the weaker fork separate after $reference.moveUci", ({ reference, root, replies }) => {
    const fen = root[0].fen;
    const report = assessChessDecision({
        fen,
        candidates: root,
        replyProbes: [{ moveUci: reference.moveUci, lines: replies }],
    });
    const move = report?.moves.find(candidate => candidate.moveUci === reference.moveUci);
    expect(move?.conditionalFork).toMatchObject({
        defenceConsequence: null,
        lineUci: expect.arrayContaining([reference.moveUci]),
        bestReplyLineUci: expect.arrayContaining([replies[0].pvUci[0]]),
    });
    expect(move?.tactical.support).not.toBe("supported");
    expect(move?.mechanisms.some(witness => witness.mechanism === "fork")).toBe(false);
    expect(report?.position.tactical.support).not.toBe("supported");
});

test("supports a fork when capturing its attacker loses material in both searches", () => {
    const fen = "6k1/1q3ppp/8/8/np6/2P5/1R3PPP/6K1 w - - 0 1";
    const rootMove = "b2b4";
    const defence = ["b7b4", "c3b4", "h7h6", "g1f1", "g8f8", "f1e2", "f8e7"];
    const weaker = ["h7h6", "b4a4", "g8h7", "g1f1", "h7g6", "f1g1"];
    const root = { fen, depth: 18, cp: 640, pvUci: [rootMove, ...defence] };
    const after = makeFen(replayTacticalLine(fen, [rootMove])[0].after.toSetup());
    const replies = [
        { ...best, fen: after, cp: -640, pvUci: defence },
        { ...weak, fen: after, cp: -810, pvUci: weaker },
    ];
    const grounded = findConditionalFork(fen, root, replies);
    expect(grounded?.defenceConsequence).toMatchObject({
        kind: "material",
        description: expect.stringContaining("4 material points"),
    });
    const incompatibleRoot = { ...root, pvUci: [rootMove, ...weaker] };
    expect(findConditionalFork(fen, incompatibleRoot, replies)?.defenceConsequence).toBeNull();
});
