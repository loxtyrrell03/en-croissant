import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { comparePromotionCheckTempo } from "@/utils/tacticalMotifs/decisionPromotionCheckTempo";

type Request = DecisionAssessmentInput & { id: string; cohort: string };

test("compares promotion evidence on identical root and reply frames", () => {
    const inputs = JSON.parse(
        readFileSync(process.env.PROMOTION_TEMPO_INPUT!, "utf8"),
    ) as Request[];
    expect(inputs.length).toBeGreaterThan(0);
    const results = inputs.map(({ id, cohort, ...input }) => {
        const paired = input.comparisonCandidates ?? input.candidates;
        const [better, ...alternatives] = paired;
        const reply = input.replyProbes?.find((probe) => probe.moveUci === better?.pvUci[0])
            ?.lines[0];
        if (process.env.PROMOTION_TEMPO_FULL) {
            const start = performance.now();
            const assessment = input.candidates.length
                ? classify(input, "Stockfish 19", input.history)
                : null;
            return { id, cohort, assessment, ms: performance.now() - start };
        }
        if (!better || !reply) return { id, cohort };
        const start = performance.now();
        const hits = alternatives.flatMap((other) => {
            const asset = comparePromotionCheckTempo(
                input.fen,
                better,
                other,
                reply,
                input.history,
            );
            return asset ? [{ other: other.pvUci[0], exact: asset.sameContinuation, asset }] : [];
        });
        const ms = performance.now() - start;
        if (!hits.length) return { id, cohort, ms };
        const baseline = input.candidates.length
            ? classify(input, "Stockfish 19", input.history)
            : null;
        return { id, cohort, ms, hits, baseline };
    });
    writeFileSync(process.env.PROMOTION_TEMPO_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 420_000);
