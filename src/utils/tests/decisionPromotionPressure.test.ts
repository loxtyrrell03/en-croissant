import { describe, expect, it } from "vitest";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { findPromotionPressure } from "../tacticalMotifs/decisionPromotionPressure";

const rookBlockade = "4rbk1/p7/R5p1/8/8/4p1PP/1PP5/7K w - - 0 33";
const quietPromotion = "7k/2P5/8/8/8/8/8/R3K3 w - - 0 1";
const lines = (fen: string, rows: Array<[number, string]>): DecisionEngineLine[] =>
    rows.map(([cp, uci]) => ({ fen, cp, depth: 20, pvUci: uci.split(" ") }));
const blocked = "a6a1 e3e2 a1e1 f8h6 h1g1 h6d2 g1f2 d2e1 f2e1";
const rookTrade = "a6a7 e3e2 a7a1 e2e1r a1e1 e8e1 h1g2";
const queenTrade = "h1g2 e3e2 a6a1 e2e1q a1e1 e8e1 g2f3";

describe("promotion pressure in position character", () => {
    it("separates a maintained rook blockade from a corroborated promotion exchange", () => {
        const candidates = lines(rookBlockade, [
            [-680, blocked],
            [-725, rookTrade],
            [-775, queenTrade],
        ]);
        const report = assessChessDecision({ fen: rookBlockade, candidates });
        expect(report?.position.category).toBe("mixed");
        expect(report?.position.positional.basis).toBe("heuristic");
        expect(report?.position.strategicPlan?.description).toContain("rook on e1 holds the pawn");
        expect(report?.position.tactical.basis).toBe("engine-supported");
        expect(report?.position.promotionTactic?.description).toContain(
            "trades the promoting pawn for a rook",
        );
        expect(report?.position.promotionTactic?.linesUci.map((pv) => pv[3])).toEqual([
            "e2e1r",
            "e2e1q",
        ]);
    });

    it("does not treat one promotion exchange as an independently confirmed tactic", () => {
        const candidates = lines(rookBlockade, [
            [-680, blocked],
            [-725, rookTrade],
        ]);
        const result = findPromotionPressure(rookBlockade, candidates, true);
        expect(result.positional?.linesUci[1].slice(-2)).toEqual(["e2e1r", "a1e1"]);
        expect(result.tactical).toBeUndefined();
    });

    it("recognizes a blockade followed by actually taking the advanced pawn", () => {
        const fen = "1r3rk1/2pqbppp/1P1p1n2/3Pp3/8/1B1nBN1P/1P3PP1/R2Q1RK1 b - - 0 17";
        const candidates = lines(fen, [
            [-51, "c7b6 d1d3 e5e4 d3e2 e4f3 e2f3"],
            [-64, "d7b5 a1a3 d3c5 b6c7 b8c8 d1c2 b5b6 e3c5 b6c7"],
        ]);
        const result = findPromotionPressure(fen, candidates, true);
        expect(result.positional?.description).toContain("rook on c8 holds the pawn until Qxc7");
        expect(result.positional?.linesUci[1].at(-1)).toBe("b6c7");
    });

    it("rejects two choices that reach the same position before the promotion", () => {
        const candidates = lines(quietPromotion, [
            [700, "a1a2 h8g7 e1f1 g7h8 c7c8q"],
            [700, "e1f1 h8g7 a1a2 g7h8 c7c8q"],
        ]);
        expect(findPromotionPressure(quietPromotion, candidates, true).positional).toBeUndefined();
    });

    it("does not infer a continuing strategic plan from two immediate promotions", () => {
        const candidates = lines(quietPromotion, [
            [700, "c7c8q h8h7"],
            [700, "c7c8r h8h7"],
        ]);
        expect(findPromotionPressure(quietPromotion, candidates, true)).toEqual({
            positional: undefined,
            tactical: undefined,
        });
    });
});
