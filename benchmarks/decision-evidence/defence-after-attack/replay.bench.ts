import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { ChessDecisionReport, DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import type { CheckingDefenceProbe } from "@/utils/tacticalMotifs/decisionCheckingDefence";
import type { DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";

type Case = {
    id: string;
    cohort?: string;
    expectedBoards?: string[];
    captures?: string[];
    input: DecisionAssessmentInput;
    checkingDefence?: CheckingDefenceProbe;
    passedAdvance?: DecisionEngineLine[];
};

test("replays the original and final worker with the same cached engine frames", () => {
    const data = JSON.parse(readFileSync(process.env.DEFENCE_INPUT!, "utf8")) as { rows: Case[] };
    expect(new Set(data.rows.map(({ id }) => id)).size).toBe(data.rows.length);
    const rows = data.rows.map(row => {
        const { input, checkingDefence, passedAdvance } = row;
        const analyse = (extra: Partial<DecisionAssessmentInput>): ChessDecisionReport =>
            classify({ ...input, ...extra }, "Stockfish 19", input.history);
        const start = performance.now();
        const initial = input.candidates.length ? analyse({}) : null;
        const initialMs = performance.now() - start;
        const request = initial?.mistake?.checkingDefenceRequest;
        const repeated = request && checkingDefence ? analyse({ checkingDefence }) : initial;
        const pawnRequest = repeated?.mistake?.passedAdvanceRequest;
        const confirmed = pawnRequest && passedAdvance ? analyse({ checkingDefence, passedAdvance }) : repeated;
        return {
            id: row.id, cohort: row.cohort, initialMs, totalMs: performance.now() - start,
            initial, repeated: repeated !== initial ? repeated : undefined,
            final: confirmed !== initial ? confirmed : undefined,
        };
    });
    writeFileSync(process.env.DEFENCE_OUTPUT!, JSON.stringify(rows), { flag: "wx" });
}, 420_000);
