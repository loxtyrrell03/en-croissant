import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { advancedPawnHistoryInput } from "./fixtures/advancedPawnHistory";
import { isNewlyExposedPawnCapture, replayTacticalLine, tacticalCaptureGain } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { persistentPawnExchangeContext } from "../tacticalMotifs/gameHistory";

test.each([false, true])("the earlier quiet advance genuinely exposes this same pawn: reflected=%s", reflected => {
    const input = advancedPawnHistoryInput(reflected, false);
    const root = replayTacticalLine(input.fen, input.pvUci)[0];
    expect(tacticalCaptureGain(root)).toBe(100);
    expect(isNewlyExposedPawnCapture(root, input.previousFen, input.previousMoveUci)).toBe(true);
    expect(classifyPositionTacticalMotifs({ ...input, rootCp: -200 }).motifs[0])
        .toMatchObject({ id: "hangingPiece", label: "Hanging Pawn", value: 100, ply: 1 });
});

test.each([false, true])("capture-free waiting retains the same legal local gain: reflected=%s", reflected => {
    const input = advancedPawnHistoryInput(reflected);
    const root = replayTacticalLine(input.fen, input.pvUci)[0];
    expect(tacticalCaptureGain(root)).toBe(100);
    expect(isNewlyExposedPawnCapture(root, input.previousFen, input.previousMoveUci)).toBe(false);
    expect(persistentPawnExchangeContext(input.tacticalHistory, input.fen, root.move)?.balance).toBe(-330);
});

// Known coverage gap, not a successful negative: the old bishop deficit
// suppresses a pawn opportunity previously established by the quiet advance.
test.fails.each([false, true])("a proved pawn opportunity should persist across capture-free waiting: reflected=%s", reflected => {
    const input = advancedPawnHistoryInput(reflected);
    expect(classifyPositionTacticalMotifs({ ...input, rootCp: -200 }).motifs[0])
        .toMatchObject({ id: "hangingPiece", label: "Hanging Pawn", value: 100, ply: 1 });
});

test.skipIf(!process.env.TACTICAL_ADVANCED_PAWN_PROBES)("export fresh advanced-pawn engine comparisons", async () => {
    const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const probes = [false, true].flatMap(reflected => [false, true].flatMap(waiting => {
        const input = advancedPawnHistoryInput(reflected, waiting);
        const id = `advanced:${reflected}:${waiting}`;
        return [{ id: `${id}:best`, fen: input.fen, depth: 18 },
            { id: `${id}:held`, fen: input.fen, depth: 18, searchMove: input.pvUci[0] }];
    }));
    expect(probes).toHaveLength(8);
    expect(new Set(probes.map(probe => probe.id)).size).toBe(8);
    writeFileSync(privateReportPath(process.env.TACTICAL_ADVANCED_PAWN_PROBES!), JSON.stringify({ probes }, null, 2), { flag: "wx" });
});
