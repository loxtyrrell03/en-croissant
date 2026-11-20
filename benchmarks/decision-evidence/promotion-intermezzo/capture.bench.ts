import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("replays matched engine frames through the full report worker", () => {
    const rows = JSON.parse(readFileSync(process.env.REPLY_BUDGET_INPUT!, "utf8")) as
        Array<DecisionAssessmentInput & { id: string }>;
    const results = rows.map((row) => {
        const start = performance.now();
        const report = classify(row, "Stockfish 19", row.history);
        return { id: row.id, report, ms: performance.now() - start };
    });
    writeFileSync(process.env.REPLY_BUDGET_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 260_000);
