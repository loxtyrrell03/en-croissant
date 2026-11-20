import { describe, expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/capture-retention/fixtures.json";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import { compareAllowedDecisionRoutes } from "../tacticalMotifs/decisionAllowedRoutes";

function compare(input: DecisionAssessmentInput) {
    const [better, played] = input.comparisonCandidates!;
    const reply = (move: string) =>
        input.replyProbes!.find((probe) => probe.moveUci === move)!.lines[0];
    return compareAllowedDecisionRoutes(
        input.fen,
        better,
        played,
        reply(better.pvUci[0]),
        reply(played.pvUci[0]),
        input.history,
    );
}

describe("delayed compensation of an early material capture", () => {
    test("an independently observed later recapture prevents the early pawn-win claim", () => {
        const input = fixtures.sants;
        expect(compare(input)).toBeNull();
        const report = assessChessDecision(input);
        expect(report?.mistake).toMatchObject({
            category: "positional",
            positional: { support: "supported" },
        });
        expect(report?.mistake?.tactical.support).not.toBe("supported");
    });

    test("a retained rook capture remains attributable when the compared continuations vary", () => {
        expect(compare(fixtures.poland)).toMatchObject({
            kind: "comparative",
            explanation: expect.stringContaining("After Rxg3, both searches show Rxg3"),
            materialDifferencePoints: 2.8,
        });
    });
});
