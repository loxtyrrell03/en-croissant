import { describe, expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/allowed-route-mistakes/fixtures.json";
import { compareAllowedDecisionRoutes } from "../tacticalMotifs/decisionAllowedRoutes";
import type { DecisionAssessmentInput } from "../tacticalMotifs/decisionAssessment";

function frames(frame: DecisionAssessmentInput) {
    const [better, played] = frame.comparisonCandidates!;
    const reply = (move: string) =>
        frame.replyProbes!.find((probe) => probe.moveUci === move)!.lines[0];
    return [
        frame.fen,
        better,
        played,
        reply(better.pvUci[0]),
        reply(played.pvUci[0]),
        frame.history,
    ] as const;
}

describe("material contrast after a played mistake", () => {
    test("identifies the moved rook as the actual target of Qxf4", () => {
        const result = compareAllowedDecisionRoutes(...frames(fixtures.classicalLoss.input));
        expect(result).toMatchObject({
            kind: "comparative",
            explanation: expect.stringMatching(/Rxf4.*Qxf4.*Rd4.*d4/),
            mechanisms: [],
        });
        expect(result?.playedLineUci[0]).toBe(fixtures.classicalLoss.input.playedMoveUci);
    });

    test("uses the verified clearance when the better move removes its starter", () => {
        const result = compareAllowedDecisionRoutes(...frames(fixtures.removedAttacker.input));
        expect(result?.mechanisms).toMatchObject([
            { mechanism: "clearance", squares: ["d7", "d8", "d1"] },
        ]);
        expect(result?.explanation).toContain("Rxd7 takes the rook that would play Rxd1+");
    });

    test("rejects a named payoff when the exact counterfactual fails to support attribution", () => {
        const compared = frames(fixtures.uncertainClearance.input);
        expect(compareAllowedDecisionRoutes(...compared, "outcome-only")).toMatchObject({
            mechanisms: [expect.objectContaining({ mechanism: "clearance" })],
        });
        expect(compareAllowedDecisionRoutes(...compared)).toBeNull();
    });

    test("requires the original board, an agreeing reply and sufficient depth", () => {
        const [fen, better, played, strong, weak, history] = frames(
            fixtures.controlledCapture.input,
        );
        expect(
            compareAllowedDecisionRoutes(fen, better, played, strong, { ...weak, fen }, history),
        ).toBeNull();
        expect(
            compareAllowedDecisionRoutes(
                fen,
                better,
                played,
                { ...strong, depth: 12 },
                weak,
                history,
            ),
        ).toBeNull();
        expect(
            compareAllowedDecisionRoutes(...frames(fixtures.differentContinuation.input)),
        ).toBeNull();
    });
});
