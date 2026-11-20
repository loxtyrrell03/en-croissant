import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { compareBreakPlans, findRepeatedBreak } from "./compareBreakPlans";

test.skipIf(!process.env.BREAK_PLAN_INPUT)(
    "compares paired structural plans and the original report on identical frames",
    () => {
        const inputs = JSON.parse(readFileSync(process.env.BREAK_PLAN_INPUT!, "utf8")) as Array<
            DecisionAssessmentInput & { id: string }
        >;
        expect(inputs.length).toBe(new Set(inputs.map(({ id }) => id)).size);
        const cases = inputs.map(({ id, ...input }) => {
            const original = classify(input, "Stockfish 19", input.history);
            const started = performance.now();
            const broad = compareBreakPlans(input.fen, input.candidates, false);
            const strict = compareBreakPlans(input.fen, input.candidates, true);
            const first = input.candidates[0];
            const byMove = input.replyProbes?.find(({ moveUci }) => moveUci === first?.pvUci[0]);
            const repeated = first && findRepeatedBreak(input.fen, first, byMove?.lines[0]);
            const delayed = first && findRepeatedBreak(input.fen, first, byMove?.lines[0], true);
            const delayedPlans = compareBreakPlans(input.fen, input.candidates, true, true);
            const elapsedMs = performance.now() - started;
            return {
                id,
                original: original?.position ?? null,
                broad,
                strict,
                repeated,
                delayed,
                delayedPlans,
                oldRoot: original?.moves[0]?.category ?? null,
                elapsedMs,
            };
        });
        writeFileSync(process.env.BREAK_PLAN_OUTPUT!, JSON.stringify(cases), { flag: "wx" });
    },
    360_000,
);
