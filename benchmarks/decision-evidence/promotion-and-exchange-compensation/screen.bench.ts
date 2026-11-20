import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "vitest";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { assessChessDecision } from "@/utils/tacticalMotifs/decisionAssessment";
import { exchangeForRookActivity, promotionTradeAfterAdvance } from "./compensation";

type Frame = DecisionAssessmentInput & { id: string; stratum?: string; testedMoveUci?: string };
test("checks both approaches against saved legal Stockfish continuations", () => {
    const cases = JSON.parse(readFileSync(process.env.COMPENSATION_INPUT!, "utf8")) as Frame[];
    const byId = cases.map((row) => {
        const main = row.testedMoveUci
            ? row.candidates.find((line) => line.pvUci[0] === row.testedMoveUci)
            : row.candidates[0];
        if (!main) return { id: row.id, stratum: row.stratum };
        const decision = assessChessDecision(row);
        const root = row.replyProbes?.find((probe) => probe.moveUci === main.pvUci[0]);
        const replies = root?.lines ?? [];
        const reported = { category: decision?.position.category,
            tactical: decision?.position.tactical.support, positional: decision?.position.positional.support,
            move: decision?.moves[0].category, movePromotion: decision?.moves[0].promotionTactic,
            positionPromotion: decision?.position.promotionTactic, mistake: decision?.mistake?.category };
        return { id: row.id, stratum: row.stratum, reported,
            promotion: promotionTradeAfterAdvance(row.fen, main, replies),
            promotionSingle: promotionTradeAfterAdvance(row.fen, main, replies, true),
            promotionWider: promotionTradeAfterAdvance(row.fen, main, replies, false, 9),
            exchange: exchangeForRookActivity(row.fen, main, row.candidates, replies),
            exchangeUncompared: exchangeForRookActivity(row.fen, main, row.candidates, replies, true),
        };
    });
    expect(cases.length).toBeGreaterThan(0);
    writeFileSync(process.env.COMPENSATION_OUTPUT!, JSON.stringify(byId), { flag: "wx" });
}, 180_000);
