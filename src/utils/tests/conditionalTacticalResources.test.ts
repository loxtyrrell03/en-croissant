import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { findConditionalCaptureResources } from "../tacticalMotifs/conditionalTacticalResources";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { measureDecisionLine, type DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";

// Tiny constructed legal lines with synthetic scores exercise the evidence
// contract. They are not engine benchmark labels or claims about optimal play.
function fixture(fen: string, rootMoves: string[], captureMoves: string[], mate?: number) {
    const root: DecisionEngineLine = { fen, depth: 18, cp: 100, pvUci: rootMoves };
    const after = makeFen(replayTacticalLine(fen, [rootMoves[0]])[0].after.toSetup());
    const reply: DecisionEngineLine = {
        fen: after,
        depth: 18,
        cp: -100,
        pvUci: rootMoves.slice(1),
    };
    const capture: DecisionEngineLine = {
        fen: after,
        depth: 18,
        cp: mate ? null : -500,
        mate,
        pvUci: captureMoves,
    };
    expect(measureDecisionLine(fen, root)).not.toBeNull();
    expect(measureDecisionLine(after, capture)).not.toBeNull();
    return { fen, root, reply, capture };
}
function materialFixture() {
    return fixture(
        "8/2r1k2p/3b4/8/8/2N5/1P5P/6K1 w - - 0 1",
        ["b2b4", "e7f7", "g1f2", "d6e7"],
        ["d6b4", "c3d5", "e7f7", "d5c7", "b4d6", "g1f2", "f7g6", "f2e3"],
    );
}
function mateFixture(fen = "1r3rk1/5ppp/8/7Q/8/3B4/8/R5K1 w - - 0 1") {
    return fixture(fen, ["a1a8", "h7h6"], ["b8a8", "h5h7"], -1);
}

test("a conditional fork counts net material before the offered pawn was taken", () => {
    const { fen, root, reply, capture } = materialFixture();
    const [resource] = findConditionalCaptureResources(fen, root, [reply], [capture]);
    expect(resource.outcome).toMatchObject({ kind: "material", gainPoints: 4 });
    expect(resource.refutationMechanisms[0]).toMatchObject({ mechanism: "fork", mechanismPly: 1 });
    expect(resource.refutationMechanisms[0].fen).not.toBe(fen);
    expect(resource.captureUci).toBe("d6b4");
    expect(resource.lineUci[0]).not.toBe(root.pvUci[0]);
});

test("a legally terminating mating refutation does not invent a named mating motif", () => {
    const { fen, root, reply, capture } = mateFixture();
    const [resource] = findConditionalCaptureResources(fen, root, [reply], [capture]);
    expect(resource.outcome.kind).toBe("checkmate");
    expect(resource.description).toContain("capturing side is checkmated");
    expect(resource.limitation).toContain("does not mean the capture is forced");
});

test("ordinary defended-piece captures do not become tactical dependencies", () => {
    const { fen, root, reply, capture } = mateFixture("1q3rk1/2N2ppp/8/7Q/8/3B4/8/R5K1 w - - 0 1");
    expect(findConditionalCaptureResources(fen, root, [reply], [capture])).toEqual([]);
});

test("wrong boards, shallow searches, bound scores and unsound captures cannot support a resource", () => {
    const { fen, root, reply, capture } = materialFixture();
    for (const changed of [
        { fen },
        { depth: 12 },
        { lowerbound: true },
        { cp: -120 },
        { pvUci: ["d6b4", "g1g8"] },
    ]) {
        expect(
            findConditionalCaptureResources(fen, root, [reply], [{ ...capture, ...changed }]),
        ).toEqual([]);
    }
    expect(findConditionalCaptureResources(fen, root, [{ ...reply, cp: 400 }], [capture])).toEqual(
        [],
    );
    expect(
        findConditionalCaptureResources(fen, root, [{ ...reply, depth: 12 }], [capture]),
    ).toEqual([]);
});

test("a negative mate score without an actual mating continuation is insufficient", () => {
    const { fen, root, reply, capture } = materialFixture();
    expect(
        findConditionalCaptureResources(fen, root, [reply], [{ ...capture, cp: null, mate: -4 }]),
    ).toEqual([]);
});

test("en passant captures are tied to the removed pawn, not the destination square", () => {
    const { fen, root, reply, capture } = fixture(
        "8/2r1k2p/8/8/3p4/2N5/4P2P/6K1 w - - 0 1",
        ["e2e4", "e7f7", "g1h1", "f7g6"],
        ["d4e3", "c3d5", "e7f7", "d5c7", "f7g6", "g1h1", "g6f5", "h1g2"],
    );
    expect(findConditionalCaptureResources(fen, root, [reply], [capture])[0]).toMatchObject({
        captureUci: "d4e3",
        outcome: { kind: "material", gainPoints: 4 },
    });
});

test("the move report exposes the branch separately without transferring it to the mistake", () => {
    const { fen, root, reply, capture } = materialFixture();
    const report = assessChessDecision({
        fen,
        candidates: [root],
        playedMoveUci: root.pvUci[0],
        replyProbes: [
            {
                moveUci: root.pvUci[0],
                lines: [reply],
                targetedCaptures: [{ line: capture }, { line: capture }],
            },
        ],
    })!;
    expect(report.moves[0].tactical.support).toBe("supported");
    expect(report.moves[0].conditionalResources).toHaveLength(1);
    expect(report.moves[0].mechanisms).toEqual([]);
    expect(report.position.conditionalResources).toHaveLength(1);
    expect(report.mistake).toBeNull();
    expect(report.mistakeStatus).toBe("best-supplied-choice");
});
