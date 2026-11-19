import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { compareStrategicContinuations } from "strategic-continuation-candidate";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

type Case = DecisionAssessmentInput & {
    id: string;
    label: { tactical: boolean | null; positional: boolean | null; rationale: string };
};

test("compares fixed Stockfish frames on the committed baseline", () => {
    const input = process.env.DECISION_STRATEGY_INPUT;
    const output = process.env.DECISION_STRATEGY_OUTPUT;
    if (!input || !output)
        throw new Error("Set DECISION_STRATEGY_INPUT and DECISION_STRATEGY_OUTPUT");
    const rows = JSON.parse(readFileSync(input, "utf8")) as Case[];
    expect(rows.length).toBeGreaterThan(0);
    const report = rows.map(({ id, label, fen, candidates, replyProbes }) => {
        const leader = candidates[0];
        const search = buildLiveTacticalScan({
            fen,
            pvUci: leader.pvUci,
            depth: leader.depth,
            engineName: "Stockfish 19",
            variations: candidates,
        });
        const baseline = assessChessDecision({
            fen,
            candidates,
            replyProbes,
            rootCertificates: search.variations.map((variation) => ({
                fen,
                moveUci: variation.lineUci[0],
                motifs: variation.motifs,
            })),
        })?.position;
        if (!baseline) throw new Error("Baseline did not assess " + id);
        const start = performance.now();
        const candidate = compareStrategicContinuations(fen, candidates, replyProbes ?? []);
        const milliseconds = performance.now() - start;
        expect(candidate.active === null || candidate.geometry !== null).toBe(true);
        expect(candidate.confirmed === null || candidate.active !== null).toBe(true);
        expect(candidate.confirmed === null || candidate.contrast !== null).toBe(true);
        return {
            id,
            label,
            baseline: {
                category: baseline.category,
                tactical: baseline.tactical,
                positional: baseline.positional,
            },
            candidate,
            milliseconds,
        };
    });
    writeFileSync(output, JSON.stringify(report), { flag: "wx" });
}, 180_000);
