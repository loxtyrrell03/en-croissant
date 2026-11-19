import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

type Case = DecisionAssessmentInput & { id: string; label?: unknown };

test.runIf(process.env.REPLY_COVERAGE_INPUT && process.env.REPLY_COVERAGE_OUTPUT)(
    "captures full position, move, and mistake reports on matched inputs",
    () => {
        const input = process.env.REPLY_COVERAGE_INPUT!;
        const output = process.env.REPLY_COVERAGE_OUTPUT!;
        const rows = JSON.parse(readFileSync(input, "utf8")) as Case[];
        const results = rows.map(({ id, label, ...row }) => {
            const leader = row.candidates[0];
            const motifs = leader
                ? buildLiveTacticalScan({
                      fen: row.fen,
                      depth: leader.depth,
                      engineName: "Stockfish 19",
                      pvUci: leader.pvUci,
                      variations: row.candidates,
                  })
                : null;
            const rootCertificates = motifs?.variations.map((variation) => ({
                fen: row.fen,
                moveUci: variation.lineUci[0],
                motifs: variation.motifs,
            }));
            const result = assessChessDecision({ ...row, rootCertificates });
            return { id, label, result };
        });
        writeFileSync(output, JSON.stringify(results), { flag: "wx" });
    },
    180_000,
);
