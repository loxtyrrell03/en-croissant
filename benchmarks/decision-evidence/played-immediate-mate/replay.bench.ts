import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

type Case = DecisionAssessmentInput & { id: string };

test.runIf(process.env.PLAYED_MATE_OUTPUT)(
    "compares full and bounded inputs through the same decision worker logic",
    () => {
        const rows = JSON.parse(
            readFileSync(
                process.env.PLAYED_MATE_INPUT ?? new URL("./input.json", import.meta.url),
                "utf8",
            ),
        ) as Case[];
        const results = rows.map(({ id, ...row }) => {
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
            const full = assessChessDecision({ ...row, rootCertificates });
            if (process.env.PLAYED_MATE_FULL_ONLY) return { id, full };
            const partial = assessChessDecision({
                ...row,
                rootCertificates,
                comparisonCandidates: undefined,
                sharedReply: undefined,
                replyProbes: row.replyProbes?.filter((probe) => probe.moveUci === leader.pvUci[0]),
            });
            if (full?.mistake?.mateConsequence?.avoidingMoveUci)
                expect(partial?.mistake).toEqual(full.mistake);
            return { id, full, partial };
        });
        writeFileSync(process.env.PLAYED_MATE_OUTPUT!, JSON.stringify(results), { flag: "wx" });
    },
    220_000,
);
