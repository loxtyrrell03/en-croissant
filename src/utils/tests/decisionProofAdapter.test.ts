import { expect, test } from "vitest";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { refineDecisionCertificates } from "../tacticalMotifs/decisionProofAdapter";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

const fen = "4r1k1/3q1pbp/6p1/3Q4/8/5P2/P5PP/R2R2K1 b - - 0 1";
const pvUci = ["e8e1", "d1e1", "d7d5"];
test("a proved overloaded defender has separate duties and legal acceptance/decline branches", () => {
    const original = classifyPositionTacticalMotifs({ fen, pvUci }).motifs;
    const refined = refineDecisionCertificates(fen, pvUci[0], original);
    expect(refined.motifs[0].id).toBe("overloading");
    expect(original[0].id).toBe("deflection");
    expect(refined.proofs[0]).toMatchObject({
        mechanism: "overloading",
        underlyingMechanisms: ["deflection"],
        purpose: "gain-material",
        materialGainPoints: 4,
    });
    expect(refined.proofs[0].branches).toHaveLength(2);
    for (const branch of refined.proofs[0].branches)
        expect(replayTacticalLine(fen, branch.lineUci)).toHaveLength(branch.lineUci.length);
});
test("another real defence and a changed root cannot inherit an overloading proof", () => {
    const original = classifyPositionTacticalMotifs({ fen, pvUci }).motifs;
    expect(
        refineDecisionCertificates(fen.replace("P5PP", "6PP"), pvUci[0], original).proofs,
    ).toEqual([]);
    expect(refineDecisionCertificates(fen, "e8e2", original).proofs).toEqual([]);
    expect(refineDecisionCertificates(fen, pvUci[0], []).proofs).toEqual([]);
});
