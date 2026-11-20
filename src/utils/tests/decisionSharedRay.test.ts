import { expect, test } from "vitest";
import cases from "../../../benchmarks/decision-evidence/shared-ray-mistakes/candidate-regression.json";
import { compareSharedRay, nominateSharedRay } from "@/utils/tacticalMotifs/decisionSharedRay";
import { assessChessDecision } from "@/utils/tacticalMotifs/decisionAssessment";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

function compared(row: Pick<DecisionAssessmentInput, "fen" | "comparisonCandidates" | "replyProbes" | "playedMoveUci">) {
    const [best, played] = row.comparisonCandidates!;
    const reply = row.replyProbes!.find(probe => probe.moveUci === row.playedMoveUci)!.lines[0];
    return [row.fen, best, played, reply] as const;
}

test("a reply that the better move refutes can explain the played loss", () => {
    const row = cases.firstLoss;
    expect(nominateSharedRay(...compared(row))?.replyUci).toBe("e3f4");
    const result = compareSharedRay(...compared(row), row.sharedReply);
    expect(result?.explanation).toMatch(/Rd6.*Bf4.*rook on d6.*rook on b8.*Bxd6.*Rc4.*Rxb2/);
    expect(result?.betterLineUci.slice(0, 2)).toEqual(["d4c4", "e3f4"]);
});

test("a later pawn capture does not support a rear-piece exchange", () => {
    expect(nominateSharedRay(...compared(cases.laterPawn))).toBeNull();
});

test("the proof requires the exact reply on the better board", () => {
    const row = cases.earlierLoss;
    const corrupted = { ...row.sharedReply, line: { ...row.sharedReply.line, fen: row.fen } };
    expect(compareSharedRay(...compared(row), corrupted)).toBeNull();
    expect(compareSharedRay(...compared(row), undefined)).toBeNull();
    expect(compareSharedRay(...compared(row), row.sharedReply)?.explanation).toMatch(/Re8.*Bc6.*Bxe8/);
});

test("the report assigns the evidence to the played mistake only", () => {
    const fixture = cases.cachedExchange;
    const report = assessChessDecision(fixture);
    const withoutControl = assessChessDecision({ ...fixture, sharedReply: undefined });
    expect(report?.mistake?.category).toBe("tactical");
    expect(report?.mistake?.sharedRay?.explanation).toMatch(/Rd1.*Bb3.*Bxd1.*Ne3/);
    expect(report?.position).toEqual(withoutControl?.position);
    expect(report?.moves).toEqual(withoutControl?.moves);
});

test("the original rook is identified after a promotion and recapture", () => {
    const report = assessChessDecision(cases.promotionExchange);
    expect(report?.mistake?.category).toBe("tactical");
    expect(report?.mistake?.sharedRay?.explanation).toMatch(/Nc2.*Rb2.*Rxe2.*Be5.*Bxb2/);
    expect(report?.mistake?.sharedRay?.playedLineUci).toEqual(
        expect.arrayContaining(["a2a1q", "c2a1", "b2e2"]),
    );
});
