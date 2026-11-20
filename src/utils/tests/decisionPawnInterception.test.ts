import { expect, test } from "vitest";
import examples from "../../../benchmarks/decision-evidence/passed-pawn-interception/app-transfer/examples.json";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import { comparePawnInterception } from "../tacticalMotifs/decisionPawnInterception";

function compare(input: DecisionAssessmentInput) {
    const [better, played] = input.comparisonCandidates ?? [];
    if (!better || !played) throw new Error("Expected two exact scored choices");
    const stronger = input.replyProbes?.find((p) => p.moveUci === better.pvUci[0])?.lines[0];
    const weaker = input.replyProbes?.find((p) => p.moveUci === played.pvUci[0])?.lines[0];
    if (!stronger || !weaker) throw new Error("Expected replies after both choices");
    return comparePawnInterception(input.fen, better, played, stronger, weaker, input.history);
}

test("explains the bishop cost when the better choice contains the same pawn first", () => {
    const full = assessChessDecision(examples.berjaya);
    expect(full?.mistake?.category).toBe("tactical");
    expect(full?.mistake?.positional.support).toBe("unestablished");
    expect(full?.mistake?.evaluationLossCp).toBe(607);
    const evidence = full?.mistake?.tacticalEpisode;
    expect(evidence?.explanation).toContain(
        "passed pawn from b6 costs at least 2.3 material points",
    );
    expect(evidence?.explanation).toContain("Bxb7 Rxb7");
    expect(evidence?.betterLineUci).toContain("d7b6");
});

test("checks the next reply and binds the comparison to the recorded history", () => {
    const input = examples.berjaya;
    expect(compare(input)).not.toBeNull();
    const [better, played] = input.comparisonCandidates;
    expect(
        compare({
            ...input,
            comparisonCandidates: [{ ...better, pvUci: better.pvUci.slice(0, 9) }, played],
        }),
    ).toBeNull();
    expect(compare({ ...input, history: { fen: examples.groningen.fen, moves: [] } })).toBeNull();
});

test("does not credit the promoted piece at full value when both choices concede a bishop", () => {
    expect(compare(examples.groningen)).toBeNull();
});

test("checks the control instead of treating a repeated costly trade as sufficient", () => {
    expect(compare(examples.sameCost)).toBeNull();
    expect(compare(examples.earlyCapture)?.explanation).toContain("Rxd2 Nxd2");
});

test("accepts a shallower paired frame when both independently searched replies corroborate it", () => {
    const sample = examples.appBudgetBerjaya;
    expect(sample.comparisonCandidates.map((line) => line.depth)).toEqual([15, 15]);
    expect(sample.replyProbes.every(({ lines }) => lines[0].depth >= 16)).toBe(true);
    const report = assessChessDecision(sample);
    expect(report?.mistake?.tactical.reasons[0]).toContain("Bxb7 Rxb7");
});
