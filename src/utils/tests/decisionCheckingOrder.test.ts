import { describe, expect, it } from "vitest";
import { assessChessDecision, type DecisionAssessmentInput } from "../tacticalMotifs/decisionAssessment";
import { confirmCheckingOrder, findCheckingOrderChoice, nominateCheckingOrder } from "../tacticalMotifs/decisionCheckingOrder";
import fixture from "../../../benchmarks/decision-evidence/checking-capture-order/fixture.json";

const position: DecisionAssessmentInput = fixture.position.input;
const comparison: DecisionAssessmentInput = fixture.mistake.input;

describe("a check before an exposed piece is taken", () => {
    it("makes the position mixed while preserving candidate-specific assessments", () => {
        const before = assessChessDecision(position)!;
        const after = assessChessDecision({
            ...position, checkingOrder: { scope: "position", lines: fixture.position.probe.lines },
        })!;
        expect(before.position.category).toBe("positional");
        expect(after.position.category).toBe("mixed");
        expect(after.position.checkingOrder?.explanation).toMatch(/Rd1\+.*gxf4/);
        expect(after.position.checkingOrder?.immediateCaptureLineUci[1]).toBe("g5f4");
        expect(after.position.positional).toEqual(before.position.positional);
        expect(after.moves).toEqual(before.moves);
        expect(after.mistake).toBeNull();
    });

    it("adds why the check matters after the exact played move", () => {
        const initial = assessChessDecision(comparison)!;
        const result = assessChessDecision({
            ...comparison, checkingOrder: { scope: "mistake", lines: fixture.mistake.probe.lines },
        })!;
        expect(result.mistake?.category).toBe("tactical");
        expect(result.mistake?.checkingOrder?.explanation).toMatch(/Qxh2\+.*Nxc7\+/);
        expect(result.mistake?.tacticalEpisode).toEqual(initial.mistake?.tacticalEpisode);
        expect(result.position).toEqual(initial.position);
        expect(result.moves).toEqual(initial.moves);
    });

    it("rejects an equal score and incomplete, unbound or mixed-depth comparisons", () => {
        const request = findCheckingOrderChoice(position.fen, position.candidates)!;
        const [check, take] = fixture.position.probe.lines;
        for (const evidence of [
            [check, { ...take, cp: check.cp }],
            [check],
            [check, { ...take, lowerbound: true }],
            [check, { ...take, depth: check.depth - 1 }],
            [check, { ...take, fen: position.fen }],
            [{ ...check, pvUci: check.pvUci.slice(0, 2) }, take],
        ]) expect(confirmCheckingOrder(position.fen, request, evidence, position.history)).toBeNull();
    });

    it("requires the leading move to address the original target", () => {
        const choices = position.candidates;
        const best = choices[0];
        const weaker = findCheckingOrderChoice(position.fen, choices)!.weaker;
        expect(nominateCheckingOrder(position.fen, best, weaker)).toBeTruthy();
        expect(nominateCheckingOrder(position.fen, { ...best, pvUci: ["e5e6"] }, weaker)).toBeNull();
    });

    it("rejects the real Bxg5 recapture and prioritizes the exposed bishop after Qf7", () => {
        const { fen, candidates, lines, history } = fixture.equalOrder;
        expect(candidates[1].pvUci[0]).toBe("f4g5");
        const exchange = nominateCheckingOrder(fen, candidates[0], candidates[1]);
        expect(exchange).toBeTruthy();
        expect(confirmCheckingOrder(fen, exchange!, lines, history)).toBeNull();
        expect(findCheckingOrderChoice(fen, candidates)?.choice.uci).toBe("e7f7");
    });

    it("explains the direct counterattack even when both lines contain material exchanges", () => {
        const { input, probe } = fixture.counterattack;
        const before = assessChessDecision(input)!;
        const after = assessChessDecision({
            ...input, checkingOrder: { scope: "mistake", lines: probe.lines },
        })!;
        expect(after.mistake?.category).toBe(before.mistake?.category);
        expect(after.mistake?.checkingOrder?.explanation).toMatch(/Qxg4\+.*fxg5.*queen/);
        expect(after.mistake?.tactical).toEqual(before.mistake?.tactical);
        expect(after.position).toEqual(before.position);
    });

    it("does not apply a played-move reply after a different board or scope", () => {
        const original = assessChessDecision(position)!.position;
        const unrelated = assessChessDecision({
            ...position, checkingOrder: { scope: "position", lines: fixture.mistake.probe.lines },
        });
        const wrongScope = assessChessDecision({
            ...position, checkingOrder: { scope: "mistake", lines: fixture.position.probe.lines },
        });
        expect(unrelated?.position).toEqual(original);
        expect(wrongScope?.position).toEqual(original);
    });
});
