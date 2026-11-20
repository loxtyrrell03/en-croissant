import { expect, test } from "vitest";
import proof from "../../../benchmarks/decision-evidence/promotion-and-exchange-compensation/fixtures.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { findPromotionTradeAfterAdvance } from "../tacticalMotifs/decisionPromotionPressure";

test("the promotion exchange explains the move and the position without assuming a mistake", () => {
    const report = assessChessDecision(proof.deizisau);
    expect(report?.mistakeStatus).toBe("not-requested");
    expect(report?.mistake).toBeNull();
    expect(report?.moves[0].category).toBe("tactical");
    expect(report?.position.category).toBe("tactical");
    expect(report?.position.promotionTactic).toEqual(report?.moves[0].promotionTactic);
    expect(report?.position.promotionTactic?.linesUci).toEqual([
        ["d6d7", "h7h5", "d7d8r", "f6d8", "c8d8"],
        ["d6d7", "e6f5", "d7d8r", "f6d8", "c8d8"],
    ]);
    expect(report?.position.tactical.reasons[0]).toContain("traded for a bishop");
});

test("the pawn can be a lasting constraint and a tactical exchange threat", () => {
    const report = assessChessDecision(proof.amateur);
    expect(report?.position.category).toBe("mixed");
    expect(report?.position.strategicPlan).toBeDefined();
    expect(report?.position.positional.reasons.join(" ")).toContain("holds the pawn on a7");
    expect(report?.position.promotionTactic?.linesUci).toEqual([
        ["a6a7", "g6f5", "a7a8q", "d8a8", "a2a8"],
        ["a6a7", "g4g3", "f2g3", "d6g3", "a7a8q", "d8a8", "a2a8"],
    ]);
});

test("a separate defensive move order can delay the same pawn exchange", () => {
    const report = assessChessDecision(proof.munster);
    expect(report?.position.category).toBe("mixed");
    expect(report?.position.promotionTactic?.linesUci[0]?.slice(-3)).toEqual([
        "a7a8q",
        "a2a8",
        "b8a8",
    ]);
    expect(report?.position.promotionTactic?.linesUci[1]?.slice(-3)).toEqual([
        "a7a8r",
        "d8a8",
        "a4a8",
    ]);
});

test("one reply, a duplicate reply or a mismatched board cannot establish corroboration", () => {
    const {
        fen,
        candidates: [root],
        replyProbes: [
            {
                lines: [first, second],
            },
        ],
    } = proof.deizisau;
    const check = (lines: (typeof first)[]) => findPromotionTradeAfterAdvance(fen, root, lines);
    expect(check([first])).toBeUndefined();
    expect(check([first, first])).toBeUndefined();
    expect(check([first, { ...second, fen }])).toBeUndefined();
    expect(check([first, { ...second, cp: first.cp! - 51 }])).toBeUndefined();
    expect(check([first, { ...second, pvUci: second.pvUci.slice(0, 4) }])).toBeUndefined();
    expect(check([first, second])).toBeDefined();
});
