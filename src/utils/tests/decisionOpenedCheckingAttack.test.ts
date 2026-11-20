import { describe, expect, it } from "vitest";
import examples from "../../../benchmarks/decision-evidence/opened-checking-forks/examples.json";
import type { DecisionAssessmentInput } from "../tacticalMotifs/decisionAssessment";
import { compareOpenedCheckingAttack } from "../tacticalMotifs/decisionOpenedCheckingAttack";

function compare(input: DecisionAssessmentInput) {
    const [better, played] = input.comparisonCandidates ?? [];
    if (!better || !played) throw new Error("Expected paired choices in the fixture");
    const betterReply = input.replyProbes?.find((p) => p.moveUci === better.pvUci[0])?.lines[0];
    const playedReply = input.replyProbes?.find((p) => p.moveUci === played.pvUci[0])?.lines[0];
    if (!betterReply || !playedReply)
        throw new Error("Expected exact reply searches in the fixture");
    return compareOpenedCheckingAttack(
        input.fen,
        better,
        played,
        betterReply,
        playedReply,
        input.history,
    );
}

describe("checking forks after opening a line", () => {
    it("explains the fork opened by the queen exchange and the stronger move that prevents it", () => {
        const evidence = compare(examples.afterExchange);
        expect(evidence).toMatchObject({
            kind: "comparative",
            throughPly: 8,
            materialDifferencePoints: 4.2,
            playedLineUci: ["d3d5", "d6d5", "e3d5", "c5f2", "g1h2", "f2e1", "f1f6", "g7f6"],
        });
        expect(evidence?.explanation).toContain(
            "Bxf2+, checking the king and attacking the rook on e1",
        );
        expect(evidence?.explanation).toContain("Nf5");
    });

    it("tracks the original piece when it moves into the attack", () => {
        const moved = compare(examples.movedTarget);
        expect(moved?.throughPly).toBe(6);
        expect(moved?.explanation).toContain(
            "Qa5+, checking the king and attacking the knight on c7",
        );
        const retook = compare(examples.afterRecapture);
        expect(retook?.throughPly).toBe(8);
        expect(retook?.explanation).toContain("Both searches show Rxc3 taking it");
    });

    it("does not attribute another attacker's win to the checking piece", () => {
        expect(compare(examples.otherAttacker)).toBeNull();
    });

    it("requires a complete check of the payoff and rejects an unrelated supplied history", () => {
        const input = examples.afterExchange;
        const [better, played] = input.comparisonCandidates;
        expect(compare({ ...input, history: { fen: input.fen, moves: [] } })).not.toBeNull();
        expect(
            compare({
                ...input,
                comparisonCandidates: [better, { ...played, pvUci: played.pvUci.slice(0, 6) }],
            }),
        ).toBeNull();
        expect(
            compare({ ...input, history: { fen: examples.movedTarget.fen, moves: [] } }),
        ).toBeNull();
    });
});
