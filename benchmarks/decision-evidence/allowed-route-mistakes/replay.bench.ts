import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { compareAllowedDecisionRoutes } from "@/utils/tacticalMotifs/decisionAllowedRoutes";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("compares the same played mistakes using exact-board engine evidence", () => {
    const rows = JSON.parse(readFileSync(process.env.ALLOWED_INPUT!, "utf8")) as
        Array<DecisionAssessmentInput & { id: string, cohort: string }>;
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    const result = rows.map(row => {
        const start = performance.now();
        if (process.env.ALLOWED_MODE === "worker") {
            const report = row.candidates.length ? classify(row, "Stockfish 19", row.history) : null;
            return { id: row.id, cohort: row.cohort, report, ms: performance.now() - start };
        }
        const lines = row.comparisonCandidates?.length ? row.comparisonCandidates : row.candidates;
        const better = lines[0], played = lines.find(item => item.pvUci[0] === row.playedMoveUci);
        const first = row.replyProbes?.find(probe => probe.moveUci === better?.pvUci[0])?.lines[0];
        const second = row.replyProbes?.find(probe => probe.moveUci === played?.pvUci[0])?.lines[0];
        const eligible = Boolean(played && better && played !== better && first && second);
        const outcome = eligible
            ? compareAllowedDecisionRoutes(row.fen, better, played!, first!, second!, row.history, "outcome-only")
            : null;
        const prevented = outcome
            ? compareAllowedDecisionRoutes(row.fen, better, played!, first!, second!, row.history, "prevented")
            : null;
        const capture = eligible
            ? compareAllowedDecisionRoutes(row.fen, better, played!, first!, second!, row.history, "capture")
            : null;
        return { id: row.id, cohort: row.cohort, eligible, outcome, prevented, capture, ms: performance.now() - start };
    });
    writeFileSync(process.env.ALLOWED_OUTPUT!, JSON.stringify(result), { flag: "wx" });
}, 420_000);
