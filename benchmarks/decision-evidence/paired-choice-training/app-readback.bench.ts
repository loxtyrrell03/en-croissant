import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { nominateSiblingRefutation } from "@/utils/tacticalMotifs/decisionSiblingRefutation";

type Line = DecisionAssessmentInput["candidates"][number];
type Row = {
    id: string;
    fen: string;
    history: DecisionAssessmentInput["history"];
    reference: Line[];
    referenceReplies?: Record<string, Line[]>;
    pairs: {
        outcome: string;
        move: string;
        comparedWith: string;
        controlFrame?: Line;
    }[];
};

test("checks what the existing assessor explains on the same strongest three searched choices", () => {
    const input = readFileSync(process.env.PAIRED_CHOICE_INPUT!, "utf8").trim().split(/\r?\n/);
    const reports = input.map((raw) => {
        const row = JSON.parse(raw) as Row;
        const candidates = row.reference.slice(0, 3);
        if (!candidates.length) return { id: row.id, report: null };
        const replyProbes = candidates.flatMap((line) => {
            const moveUci = line.pvUci[0];
            const lines = row.referenceReplies?.[moveUci];
            return lines?.length ? [{ moveUci, lines }] : [];
        });
        const request = nominateSiblingRefutation(row.fen, candidates);
        const reply = request && replyProbes.find((probe) => probe.moveUci === request.weakStep.uci)?.lines[0];
        const control = request && row.pairs.find((pair) =>
            pair.move === request.weakStep.uci && pair.comparedWith === request.safeStep.uci,
        )?.controlFrame;
        const assessment = assessChessDecision({
            fen: row.fen,
            history: row.history,
            candidates,
            replyProbes,
            siblingRefutation: reply ? { reply, control: control || undefined } : undefined,
        });
        const report = assessment?.position;
        return {
            id: row.id,
            report: report ? {
                category: report.category,
                tactical: report.tactical,
                positional: report.positional,
                contrastedChoice: report.tacticalContrast?.playedLineUci.slice(0, 2) ?? null,
            } : null,
        };
    });
    expect(reports.length).toBeGreaterThan(0);
    writeFileSync(process.env.PAIRED_CHOICE_APP!, JSON.stringify(reports, null, 2), { flag: "wx" });
}, 60000);
