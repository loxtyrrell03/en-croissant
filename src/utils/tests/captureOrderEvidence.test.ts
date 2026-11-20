import { describe, expect, it } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/cached-capture-selection/fixture.json";
import { availableCaptureOrders, confirmCaptureOrder, nominateCaptureOrder } from "../tacticalMotifs/captureOrderEvidence";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";

describe("quiet capture order", () => {
    const { input, captureOrder } = fixtures.amager;
    const selected = new Set([captureOrder.moveUci]);

    it("uses the cached reply when the root variation has another continuation", () => {
        expect(nominateCaptureOrder(input.fen, input.candidates[0])).toBeUndefined();
        const [proposal] = availableCaptureOrders(input, selected);
        expect(proposal.reply.uci).toBe(captureOrder.replyUci);
        const proof = confirmCaptureOrder(proposal, captureOrder.lines, input.history);
        expect(proof?.explanation).toMatch(/After bxc3, Qxc5.*on c3.*Rxc3.*Qxd4/);
    });

    it("keeps the tactical explanation scoped to the exact move and reply", () => {
        const prior = assessChessDecision(input)!;
        const report = assessChessDecision({ ...input, captureOrder })!;
        expect(report.position.captureOrder?.explanation).toContain("removes the defender");
        expect(report.position.limitations).toContain("This capture order applies to the reply shown. Other defences can change the continuation.");
        expect(report.moves.find(move => move.moveUci === captureOrder.moveUci)?.captureOrder).toEqual(report.position.captureOrder);
        expect(report.moves.filter(move => move.captureOrder)).toHaveLength(1);
        expect(report.mistake).toEqual(prior.mistake);
        const otherReply = { ...captureOrder, replyUci: "a7a6" };
        expect(assessChessDecision({ ...input, captureOrder: otherReply })?.position.captureOrder).toBeUndefined();
    });

    it("does not trust an equal order, a cutoff score, or a different history", () => {
        const [proposal] = availableCaptureOrders(input, selected);
        const [strong, early] = captureOrder.lines;
        expect(confirmCaptureOrder(proposal, [strong, { ...early, cp: strong.cp }], input.history)).toBeUndefined();
        expect(confirmCaptureOrder(proposal, [strong, { ...early, lowerbound: true }], input.history)).toBeUndefined();
        expect(confirmCaptureOrder(proposal, captureOrder.lines, { ...input.history, moves: [] })).toBeUndefined();
    });

    it("respects a paired search showing that the initial move is weaker", () => {
        const { input, captureOrder } = fixtures.weakerMove;
        const selected = new Set([captureOrder.moveUci]);
        const [withoutPair] = availableCaptureOrders({ ...input, comparisonCandidates: undefined }, selected);
        expect(withoutPair.reply.uci).toBe(captureOrder.replyUci);
        expect(availableCaptureOrders(input, selected)).toEqual([]);
        expect(assessChessDecision({ ...input, captureOrder })?.moves
            .find(move => move.moveUci === captureOrder.moveUci)?.captureOrder).toBeUndefined();
    });
});
