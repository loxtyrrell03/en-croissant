import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("compares full En Croissant reports on frozen moves", () => {
    const rows = JSON.parse(readFileSync(process.env.ASSET_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    const results = rows.map(({ id, ...input }) => {
        const start = performance.now();
        const report = classify(input, "Stockfish 19", input.history);
        return { id, report, ms: performance.now() - start };
    });
    writeFileSync(process.env.ASSET_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 250_000);
