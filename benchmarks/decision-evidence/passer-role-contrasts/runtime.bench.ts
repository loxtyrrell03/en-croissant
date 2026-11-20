import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { ChessDecisionReport, DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("checks position, exact move, and mistake along the actual report path", () => {
    const app = JSON.parse(readFileSync(process.env.PAWN_REPLAY_INPUT!, "utf8")) as
        Array<DecisionAssessmentInput & { id: string }>;
    const prior = JSON.parse(readFileSync(process.env.PAWN_REPLAY_BASELINE!, "utf8")) as
        Array<{ id: string; report: ChessDecisionReport }>;
    const lookup = new Map(prior.map(({ id, report }) => [id, report]));
    const after = app.map(row => {
        const report = classify(row, "Stockfish 19", row.history);
        const before = lookup.get(row.id);
        expect(report?.mistake).toEqual(before?.mistake);
        expect(report?.mistakeStatus).toEqual(before?.mistakeStatus);
        expect(report?.position.tactical).toEqual(before?.position.tactical);
        return {
            id: row.id, before: before?.position.category, after: report?.position.category,
            position: report?.position.sharedPassedPawn,
            moves: report?.moves.filter(move => move.sharedPassedPawn).map(({ moveUci, category, sharedPassedPawn }) =>
                ({ moveUci, category, sharedPassedPawn })),
        };
    });
    writeFileSync(process.env.PAWN_REPLAY_OUTPUT!, JSON.stringify(after), { flag: "wx" });
}, 120_000);
