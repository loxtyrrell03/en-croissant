import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { resetComparisons } from "@/utils/tacticalMotifs/tacticalSequenceEvidence";

test("matches tactical mechanisms in both branches of the actual decision worker", () => {
    const rows = JSON.parse(readFileSync(process.env.IDENTITY_INPUT!, "utf8")) as Array<DecisionAssessmentInput & { id: string }>;
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    const result = rows.map((row) => {
        if (!row.candidates.length) return { id: row.id, report: null, pairs: [] };
        const start = performance.now();
        const report = classify(row, "Stockfish 19", row.history);
        return { id: row.id, report, ms: performance.now() - start, pairs: resetComparisons() };
    });
    writeFileSync(process.env.IDENTITY_OUTPUT!, JSON.stringify(result), { flag: "wx" });
}, 420_000);
