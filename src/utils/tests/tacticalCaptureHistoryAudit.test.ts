import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import {
    persistentPawnExchangeContext,
    verifiedTacticalHistory,
} from "../tacticalMotifs/gameHistory";
import {
    provePersistentPawnCapture,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";

test.skipIf(
    !process.env.TACTICAL_CAPTURE_HISTORY_INPUT || !process.env.TACTICAL_CAPTURE_HISTORY_REPORT,
)(
    "inspect empty root captures against complete actual exchange history",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const destination = privateReportPath(process.env.TACTICAL_CAPTURE_HISTORY_REPORT!);
        expect(existsSync(destination)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_CAPTURE_HISTORY_INPUT!, "utf8"));
        const results = input.results.flatMap((row: any) => {
            if (row.scan.motifs.length) return [];
            const step = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
            if (!step?.capture) return [];
            const history = verifiedTacticalHistory(row.tacticalHistory, row.fen);
            expect(history).not.toBeNull();
            const gain = tacticalCaptureGain(step);
            const context = persistentPawnExchangeContext(row.tacticalHistory, row.fen, step.move);
            const proof = provePersistentPawnCapture(step, row.tacticalHistory);
            return [
                {
                    id: row.id,
                    fen: row.fen,
                    move: step.uci,
                    san: step.san,
                    capture: step.capture,
                    gain,
                    context,
                    proof,
                    before: row.before,
                    previous: history!.frames.slice(-12).map((frame) => ({
                        fen: makeFen(frame.before.toSetup()),
                        move: makeUci(frame.move),
                        san: makeSan(frame.before, frame.move),
                        side: frame.before.turn,
                        capture: frame.capture,
                        promotionGain: frame.promotionGain,
                    })),
                },
            ];
        });
        writeFileSync(
            destination,
            JSON.stringify(
                {
                    scope: "Development diagnostics, not independently judged tactical omissions or an accuracy score.",
                    input: process.env.TACTICAL_CAPTURE_HISTORY_INPUT,
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            results
                .filter((row: any) => row.gain >= 90 && row.capture === 100)
                .map((row: any) => ({
                    id: row.id,
                    san: row.san,
                    gain: row.gain,
                    context: row.context,
                    proof: row.proof,
                    previous: row.previous.map((frame: any) => frame.san).join(" "),
                })),
        );
    },
    120000,
);
