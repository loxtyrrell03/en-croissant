import { describe, expect, test } from "vitest";
import cases from "../../../benchmarks/decision-evidence/scored-route-decisions/fixtures.json";
import type { DecisionAssessmentInput } from "../tacticalMotifs/decisionAssessment";
import {
    corroborateDecisionLineRoutes,
    isStructuralEffectFromTacticalCapture,
} from "../tacticalMotifs/decisionLineRoutes";
import type { ComparativePositionalEvidence } from "../tacticalMotifs/positionalTransitions";

function args(input: DecisionAssessmentInput) {
    const root = input.candidates[0];
    return [
        input.fen,
        root,
        input.replyProbes!.find((item) => item.moveUci === root.pvUci[0])!.lines[0],
        input.history,
    ] as const;
}

describe("corroborating a clear route or displaced defender", () => {
    test("corroborates the quiet clearance and keeps the full payoff line", () => {
        expect(corroborateDecisionLineRoutes(...args(cases.quietClearance.input))).toMatchObject([
            {
                mechanism: "clearance",
                squares: ["f6", "f1", "f7", "e7"],
                payoffPly: 5,
                lineUci: ["f6g4", "b8g8", "f1f7", "g8g7", "f7e7", "e5e7"],
            },
        ]);
    });

    test("rejects a reply frame from a different board and a shallow replay", () => {
        const [fen, root, reply] = args(cases.deflection.input);
        expect(corroborateDecisionLineRoutes(fen, root, reply)).toMatchObject([
            { mechanism: "deflection", squares: ["c1", "d1", "e4", "c4"] },
        ]);
        expect(corroborateDecisionLineRoutes(fen, root, { ...reply, fen })).toEqual([]);
        expect(corroborateDecisionLineRoutes(fen, root, { ...reply, depth: 15 })).toEqual([]);
        expect(corroborateDecisionLineRoutes(fen, root, { ...reply, upperbound: true })).toEqual(
            [],
        );
    });

    test("distinguishes a same-square exchange from an earlier pawn gain", () => {
        const frames = args(cases.ordinaryTrade.input);
        expect(corroborateDecisionLineRoutes(...frames, "repeated")).toMatchObject([
            { mechanism: "clearance", payoffPly: 5 },
        ]);
        expect(corroborateDecisionLineRoutes(...frames)).toEqual([]);
    });

    test("keeps the pawn and bishop changes as separate strategic observations", () => {
        for (const { input, factor } of [cases.isolatedPawn, cases.bishopPair]) {
            const [fen, root] = args(input);
            const observation = factor as ComparativePositionalEvidence;
            expect(isStructuralEffectFromTacticalCapture(fen, root.pvUci[0], observation)).toBe(
                true,
            );
            expect(
                isStructuralEffectFromTacticalCapture(fen, root.pvUci[0], {
                    ...observation,
                    comparison: "alternative-choice",
                }),
            ).toBe(false);
            expect(
                isStructuralEffectFromTacticalCapture(fen, root.pvUci[0], {
                    ...observation,
                    materialWindowPlies: 8,
                }),
            ).toBe(false);
        }
    });
});
