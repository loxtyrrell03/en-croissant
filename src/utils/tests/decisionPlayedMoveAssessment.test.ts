import { expect, test } from "vitest";
import { assessChessDecision } from "@/utils/tacticalMotifs/decisionAssessment";
import cases from "../../../benchmarks/decision-evidence/annotation-transfer/fixtures.json";

test("shows the played pawn lock when the move is outside the root shortlist", () => {
    const fixture = cases.pawnLock;
    const report = assessChessDecision(fixture);
    expect(report?.moves.map(move => move.moveUci)).not.toContain(fixture.playedMoveUci);
    expect(report?.playedMoveAssessment).toMatchObject({
        moveUci: fixture.playedMoveUci,
        category: "positional",
        positional: { reasons: expect.arrayContaining([expect.stringMatching(/fixes opposing pawns.*h4 and h5/)]) },
    });
    expect(report?.position.category).toBe("unclear");
});

test("the played move and its mistake mechanism retain independent evidence", () => {
    const fixture = cases.unsoundCapture;
    const report = assessChessDecision({
        ...fixture,
        mistakeCertificate: {
            fen: fixture.fen,
            bestMoveUci: fixture.candidates[0].pvUci[0],
            playedMoveUci: fixture.playedMoveUci,
            tactical: true,
            reasons: ["Qxh5+ wins the loose knight on h5."],
        },
    });
    expect(report?.playedMoveAssessment?.category).toBe("unclear");
    expect(report?.mistake?.category).toBe("tactical");
});

test("does not duplicate an existing choice or accept a bound comparison", () => {
    const report = assessChessDecision(cases.alreadyListed);
    expect(report?.moves[0]?.moveUci).toBe(cases.alreadyListed.playedMoveUci);
    expect(report?.playedMoveAssessment).toBeUndefined();
    const { comparisonCandidates, ...fixture } = cases.pawnLock;
    const [best, played] = comparisonCandidates;
    expect(assessChessDecision({
        ...fixture, comparisonCandidates: [best, { ...played, lowerbound: true }],
    })?.playedMoveAssessment).toBeUndefined();
});
