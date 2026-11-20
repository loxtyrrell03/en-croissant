import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { comparePromotionTempo } from "promotion-tempo";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

type Row = DecisionAssessmentInput & { id: string };
const request = process.env.REPLY_BUDGET_INPUT!;
const response = process.env.REPLY_BUDGET_OUTPUT!;

function assess(row: Row) {
    const [better, played] = row.comparisonCandidates ?? [];
    if (!better || !played || played.pvUci[0] !== row.playedMoveUci) return null;
    const probe = (move: string) =>
        row.replyProbes?.find((item) => item.moveUci === move)?.lines[0];
    const betterReply = probe(better.pvUci[0]);
    const playedReply = probe(played.pvUci[0]);
    if (!betterReply || !playedReply) return null;
    return comparePromotionTempo(row.fen, better, played, betterReply, playedReply, row.history);
}

test("compares the promoted pawn exchange on exact engine boards", () => {
    const rows = JSON.parse(readFileSync(request, "utf8")) as Row[];
    const output = rows.map((row) => ({ id: row.id, proof: assess(row) }));
    const kenya = rows.find((row) => row.id === "own-promotion-12195808341e545f");
    if (kenya) {
        const proof = assess(kenya);
        expect(proof).toMatchObject({
            witness: { mechanism: "intermezzo", payoffPly: 5, rootMoveInvolved: true },
        });
        expect(proof?.tactical).toContain("immediate Rxf8 allows Kxf8");
        expect(proof?.tactical).toContain("insert Re1+");
        const [better, played] = kenya.comparisonCandidates!;
        const [stronger, worse] = kenya.replyProbes!.map(({ lines }) => lines[0]);
        expect(comparePromotionTempo(kenya.fen, better, played, { ...stronger, fen: kenya.fen }, worse)).toBeNull();
        expect(comparePromotionTempo(kenya.fen, better, played, stronger, { ...worse, cp: stronger.cp })).toBeNull();
    }
    writeFileSync(response, JSON.stringify(output), { flag: "wx" });
});
