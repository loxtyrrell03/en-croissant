import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { nominatePositionRefutation } from "@/utils/tacticalMotifs/decisionPositionContrast";

type Case = DecisionAssessmentInput & { id: string; sourceFile: string; site?: string; event?: string };
const input = process.env.REPLY_BUDGET_INPUT!;
const output = process.env.REPLY_BUDGET_OUTPUT!;

function options(row: Case) {
    const [best, runner, third] = row.candidates;
    const base = nominatePositionRefutation(row.fen, row.candidates);
    if (!base) return [];
    const remaining = third && runner.cp != null && third.cp != null && runner.cp - third.cp <= 50 &&
        base.moveUci === runner.pvUci[0]
        ? nominatePositionRefutation(row.fen, [best, third])
        : null;
    return [base, ...(remaining ? [remaining] : [])];
}

test("records verifier-ready alternatives from the same cached root analysis", () => {
    const cases = JSON.parse(readFileSync(input, "utf8")) as Case[];
    const plan = cases.flatMap((row) => {
        const candidates = options(row);
        if (!candidates.length) return [];
        const report = classify(row, "Stockfish 19", row.history);
        if (!report) return [];
        return [{
            ...row,
            original: {
                tactical: report.position.tactical.support === "supported",
                positional: report.position.positional.support === "supported",
                checked: Boolean(report.position.tacticalContrast),
            },
            options: candidates.map(({ moveUci, fen, alternative, defence }) => ({
                moveUci,
                fen,
                alternative,
                defence,
                cached: row.replyProbes?.find((probe) => probe.moveUci === moveUci)?.lines ?? [],
            })),
        }];
    });
    writeFileSync(output, JSON.stringify(plan), { flag: "wx" });
}, 180_000);
