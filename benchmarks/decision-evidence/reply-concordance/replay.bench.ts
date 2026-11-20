import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("replays identical searched alternatives through the decision worker", () => {
    const input = JSON.parse(readFileSync(process.env.REPLY_CONCORDANCE_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    expect(new Set(input.map((row) => row.id)).size).toBe(input.length);
    const results = input.map(({ id, ...row }) => {
        const start = performance.now();
        const report = row.candidates[0] ? classify(row, "Stockfish 19", row.history) : null;
        return { id, report, ms: performance.now() - start };
    });
    writeFileSync(process.env.REPLY_CONCORDANCE_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 400_000);
