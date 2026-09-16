import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    intermediateCaptureProof,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
    proveCheckingPawnRetention,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY || !process.env.TACTICAL_CAPTURE_RECALL_REPORT)(
    "inspect every nominated capture in the frozen owner games without assuming positive local gain is whole-position safety",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CAPTURE_RECALL_REPORT!);
        expect(existsSync(output)).toBe(false);
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        expect(sample.completed).toBe(sample.requested);
        const cases = [];
        for (const row of sample.results)
            for (const phase of ["before", "after"] as const) {
                const fen = phase === "before" ? row.fen : row.afterFen;
                for (const line of row[phase]) {
                    const step = replayTacticalLine(fen, line.pvUci.slice(0, 1))[0];
                    if (!step?.capture) continue;
                    const result = classifyPositionTacticalMotifs({
                        fen,
                        pvUci: line.pvUci,
                        rootCp: line.cp,
                    });
                    const intermediate = step.after.isCheck()
                        ? intermediateCaptureProof(step)
                        : null;
                    cases.push({
                        id: row.id,
                        ply: row.ply,
                        phase,
                        fen,
                        line,
                        capture: step.capture,
                        exchange: tacticalExchangeGain(step.before, step.move),
                        retained: tacticalCaptureGain(step),
                        intermediate,
                        checkingPawnRetention: proveCheckingPawnRetention(replayTacticalLine(fen, line.pvUci)),
                        result,
                    });
                }
            }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "All nominated captures, both root phases, of the fixed owner-game development sample. Positive bounded material gain is not whole-position safety or an accuracy label.",
                    sourceSha256: sample.sourceSha256,
                    positions: sample.results.length,
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(cases.length).toBeGreaterThan(0);
    },
    120000,
);
