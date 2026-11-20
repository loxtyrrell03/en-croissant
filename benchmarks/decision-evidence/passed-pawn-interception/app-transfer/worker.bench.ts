import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("replays the whole decision report for identical engine lines", () => {
    const cases = JSON.parse(readFileSync(process.env.INTERCEPTION_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    expect(new Set(cases.map((row) => row.id)).size).toBe(cases.length);
    const out = cases.map(({ id, ...input }) => {
        const start = performance.now();
        const report = classify(input, "Stockfish 19", input.history);
        return { id, report, ms: performance.now() - start };
    });
    writeFileSync(process.env.INTERCEPTION_OUTPUT!, JSON.stringify(out), { flag: "wx" });
}, 260_000);
