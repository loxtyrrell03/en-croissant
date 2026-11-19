import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

type Case = DecisionAssessmentInput & { id: string; label?: unknown };
const input = process.env.DECISION_PREPARED_REPLAY_INPUT;
const output = process.env.DECISION_PREPARED_REPLAY_OUTPUT;

test.runIf(input && output)(
    "replays the same engine evidence through a decision classifier revision",
    () => {
        const cases = JSON.parse(readFileSync(input!, "utf8")) as Case[];
        const report = cases.map(({ id, label, ...row }) => {
            const best = row.candidates[0];
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                pvUci: best.pvUci,
                depth: best.depth,
                engineName: "Stockfish 19",
                variations: row.candidates,
            });
            return {
                id,
                label,
                report: assessChessDecision({
                    ...row,
                    rootCertificates: scan.variations.map((variation) => ({
                        fen: row.fen,
                        moveUci: variation.lineUci[0],
                        motifs: variation.motifs,
                    })),
                }),
            };
        });
        writeFileSync(output!, JSON.stringify(report), { flag: "wx" });
    },
    180_000,
);
