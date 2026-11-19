import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

type Example = DecisionAssessmentInput & { id: string; cohort: string };

test("replays the same analysed cases through Decision Evidence", () => {
    const rows = JSON.parse(
        readFileSync(new URL("./input.json", import.meta.url), "utf8"),
    ) as Example[];
    const results = rows.map(({ id, cohort, ...input }) => {
        const leader = input.candidates[0];
        const motifs = buildLiveTacticalScan({
            fen: input.fen,
            depth: leader.depth,
            engineName: "Stockfish 19",
            pvUci: leader.pvUci,
            variations: input.candidates,
        });
        const rootCertificates = motifs?.variations.map((variation) => ({
            fen: input.fen,
            moveUci: variation.lineUci[0],
            motifs: variation.motifs,
        }));
        return { id, cohort, result: assessChessDecision({ ...input, rootCertificates }) };
    });
    writeFileSync(process.env.MATE_DEFENCE_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 30_000);
