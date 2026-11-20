import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { findQuietMateInTwoThreat } from "@/utils/tacticalMotifs/decisionQuietMateInTwo";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";

test("compares the same decisions and exact root threats", () => {
    const rows = JSON.parse(readFileSync(process.env.TWO_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string; focused?: DecisionEngineLine }
    >;
    const reports = rows.map(({ id, focused, ...input }) => {
        const started = performance.now();
        if (process.env.TWO_MODE === "worker") {
            const report = input.candidates.length
                ? classify(input, "Stockfish 19", input.history)
                : null;
            return { id, report, ms: performance.now() - started };
        }
        const roots =
            focused && !input.candidates.some((line) => line.pvUci[0] === focused.pvUci[0])
                ? [...input.candidates, focused]
                : input.candidates;
        const calls = roots.flatMap((line) => {
            const probe = input.replyProbes?.find((item) => item.moveUci === line.pvUci[0]);
            if (!probe) return [];
            const args = [input.fen, line, probe.lines, input.history] as const;
            return [
                {
                    moveUci: line.pvUci[0],
                    searched: findQuietMateInTwoThreat(...args, "searched"),
                    legal: findQuietMateInTwoThreat(...args, "legal-example"),
                },
            ];
        });
        return { id, calls, ms: performance.now() - started };
    });
    writeFileSync(process.env.TWO_OUTPUT!, JSON.stringify(reports), { flag: "wx" });
}, 420_000);
