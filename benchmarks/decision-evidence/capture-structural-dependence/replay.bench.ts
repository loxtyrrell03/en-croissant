import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
test("compares attached and independent structural evidence", () => {
    const input = JSON.parse(readFileSync(process.env.CAPTURE_EFFECT_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    const reports = input.map(({ id, ...row }) => {
        const start = performance.now();
        return {
            id,
            report: classify(row, "Stockfish 19", row.history),
            ms: performance.now() - start,
        };
    });
    expect(new Set(reports.map((x) => x.id)).size).toBe(reports.length);
    writeFileSync(process.env.CAPTURE_EFFECT_OUTPUT!, JSON.stringify(reports), { flag: "wx" });
}, 360_000);
