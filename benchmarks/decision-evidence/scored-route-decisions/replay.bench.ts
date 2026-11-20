import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { corroborateDecisionLineRoutes } from "@/utils/tacticalMotifs/decisionLineRoutes";

test("compares actual decision reports with identical root and reply frames", () => {
    const inputs = JSON.parse(readFileSync(process.env.ROUTE_INPUT!, "utf8")) as
        (DecisionAssessmentInput & { id: string; cohort?: string })[];
    expect(new Set(inputs.map(input => input.id)).size).toEqual(inputs.length);
    const outputs = inputs.map(input => {
        const start = performance.now();
        const report = input.candidates.length ? classify(input, "Stockfish 19", input.history) : null;
        const elapsedMs = performance.now() - start;
        const root = input.candidates[0];
        const reply = root && input.replyProbes?.find(probe => probe.moveUci === root.pvUci[0])?.lines[0];
        const witnessedRoutes = process.env.ROUTE_AUDIT && reply
            ? {
                leading: corroborateDecisionLineRoutes(input.fen, root, reply, input.history, "leading-reply"),
                repeated: corroborateDecisionLineRoutes(input.fen, root, reply, input.history, "repeated"),
                settled: corroborateDecisionLineRoutes(input.fen, root, reply, input.history, "settled"),
                retained: corroborateDecisionLineRoutes(input.fen, root, reply, input.history),
            }
            : undefined;
        return { id: input.id, cohort: input.cohort, elapsedMs, report, witnessedRoutes };
    });
    writeFileSync(process.env.ROUTE_OUTPUT!, JSON.stringify(outputs), { flag: "wx" });
}, 420_000);
