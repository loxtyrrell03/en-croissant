import { expect, test } from "vitest";
import cases from "../../../benchmarks/decision-evidence/compared-motif-identity/fixtures.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import {
    extractTacticalSequenceWitnesses,
    sameTacticalMechanism,
} from "../tacticalMotifs/tacticalSequenceEvidence";

test("the same king does not make captures of two different fork targets equivalent", () => {
    const { fen, comparisonCandidates } = cases.sparkassen;
    const [stronger, played] = comparisonCandidates.map((line) =>
        extractTacticalSequenceWitnesses(fen, line).find(
            (item) => item.mechanism === "fork" && item.mechanismPly === 1,
        ),
    );
    expect(stronger?.squares).toEqual(["e7", "g8", "f5"]);
    expect(played?.squares).toEqual(["f6", "g8", "h5"]);
    expect(sameTacticalMechanism(stronger!, played!)).toBe(false);
    expect(sameTacticalMechanism(stronger!, { ...stronger!, squares: ["e7", "f5", "g8"] })).toBe(
        true,
    );
});

test("the mistake report distinguishes the played fork from the stronger fork", () => {
    const report = assessChessDecision(cases.sparkassen);
    expect(report?.mistake).toMatchObject({
        category: "tactical",
        missed: [expect.objectContaining({ mechanism: "fork", squares: ["e7", "g8", "f5"] })],
    });
    expect(report?.mistake?.tactical.reasons.join(" ")).toMatch(
        /Ne7\+ attacks g8 and f5.*Nf6\+ attacks g8 and h5/,
    );
    expect(report?.mistake?.positional.support).toBe("unestablished");
});

test("a late pawn capture does not absorb a distinct queen fork of the king and rook", () => {
    const report = assessChessDecision(cases.cork);
    expect(report?.mistake?.allowed).toContainEqual(
        expect.objectContaining({
            mechanism: "fork",
            description: expect.stringContaining("Qxe4+"),
        }),
    );
    expect(report?.mistake?.tactical.support).toBe("supported");
});
