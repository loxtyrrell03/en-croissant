import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import reviewed from "../compared-exchange-outcomes/input.json";
import controls from "./controls.json";
import deeper from "./deeper.json";

test("replays the same frozen input through the decision worker", () => {
    const start = performance.now();
    const results = [
        ...reviewed,
        ...controls,
        ...deeper.map((row) => ({ ...row, id: row.id + "-deep" })),
    ].map(({ id, ...row }) => {
        const input: DecisionAssessmentInput = {
            ...row,
            comparisonCandidates: row.comparisonCandidates ?? undefined,
        };
        const full = classify(input, "Stockfish 19", row.history);
        return { id, full };
    });
    console.log(
        `Classified ${results.length} inputs in ${Math.round(performance.now() - start)} ms.`,
    );
    writeFileSync(process.env.RECOVERY_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 120_000);
