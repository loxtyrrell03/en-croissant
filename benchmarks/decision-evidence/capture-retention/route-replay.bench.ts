import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { compareAllowedDecisionRoutes } from "@/utils/tacticalMotifs/decisionAllowedRoutes";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("compares the scoped capture verifier on all paired frames", () => {
    const inputs = JSON.parse(readFileSync(process.env.REPLY_CONCORDANCE_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    const results = [];
    for (const input of inputs) {
        const [better, played] = input.comparisonCandidates ?? [];
        if (
            !better ||
            !played ||
            played.pvUci[0] !== input.playedMoveUci ||
            input.candidates[0]?.pvUci[0] !== better.pvUci[0]
        )
            continue;
        const attack = input.replyProbes?.find((p) => p.moveUci === played.pvUci[0])?.lines[0];
        const response = input.replyProbes?.find((p) => p.moveUci === better.pvUci[0])?.lines[0];
        if (!attack || !response) continue;
        const verdict = compareAllowedDecisionRoutes(
            input.fen,
            better,
            played,
            response,
            attack,
            input.history,
        );
        results.push({ id: input.id, verdict });
    }
    writeFileSync(process.env.REPLY_CONCORDANCE_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 180_000);
