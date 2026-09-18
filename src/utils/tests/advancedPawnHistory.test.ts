import { readFileSync, writeFileSync } from "node:fs";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { advancedPawnHistoryInput, advancedPawnIntegrationCases, advancedPawnSequenceInput } from "./fixtures/advancedPawnHistory";
import { isNewlyExposedPawnCapture, provePersistentPawnCapture, replayTacticalLine, tacticalCaptureGain } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { advancedPawnOpportunityContext, persistentPawnExchangeContext } from "../tacticalMotifs/gameHistory";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

function constructed(raw: string, capture: string, reflected: boolean) {
    const start = reflected ? reflectMixedForkFen(INITIAL_FEN) : INITIAL_FEN;
    const moves = raw.split(" ").map(move => reflected ? reflectMixedForkMove(move) : move);
    const frames = replayTacticalLine(start, moves);
    expect(frames).toHaveLength(moves.length);
    const fen = makeFen(frames.at(-1)!.after.toSetup());
    const root = replayTacticalLine(fen, [reflected ? reflectMixedForkMove(capture) : capture])[0];
    expect(root).toBeDefined();
    return { root, history: { fen: start, moves }, fen };
}

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

test.each([false, true])("a proved pawn opportunity persists across capture-free waiting: reflected=%s", reflected => {
    const input = advancedPawnHistoryInput(reflected);
    expect(classifyPositionTacticalMotifs({ ...input, rootCp: -200 }).motifs[0])
        .toMatchObject({ id: "hangingPiece", label: "Hanging Pawn", value: 100, ply: 1 });
});

test.each([false, true])("a quietly advanced gambit pawn still owes its original pawn: reflected=%s", reflected => {
    const { root, history, fen } = constructed(
        "e2e4 e7e5 f2f4 e5f4 b1c3 f4f3 a2a3 a7a6 h2h3 h7h6", "g1f3", reflected);
    expect(tacticalCaptureGain(root)).toBe(100);
    expect(advancedPawnOpportunityContext(history, fen, root.move)).not.toBeNull();
    expect(persistentPawnExchangeContext(history, fen, root.move)?.pawnBalance).toBe(-100);
    expect(provePersistentPawnCapture(root, history)).toBeNull();
});

test.each([false, true])("present defence and full matching history still control admission: reflected=%s", reflected => {
    const input = advancedPawnHistoryInput(reflected);
    const root = replayTacticalLine(input.fen, input.pvUci)[0];
    expect(provePersistentPawnCapture(root, undefined)).toBeNull();
    expect(provePersistentPawnCapture(root, { ...input.tacticalHistory, moves: input.tacticalHistory.moves.slice(1) })).toBeNull();
    const last = reflected ? reflectMixedForkMove("d2d3") : "d2d3";
    const prefix = input.tacticalHistory.moves.slice(0, -1);
    const frames = replayTacticalLine(input.tacticalHistory.fen, [...prefix, last]);
    expect(frames).toHaveLength(prefix.length + 1);
    const defended = replayTacticalLine(makeFen(frames.at(-1)!.after.toSetup()), input.pvUci)[0];
    expect(tacticalCaptureGain(defended)).toBeLessThan(90);
    expect(provePersistentPawnCapture(defended, { fen: input.tacticalHistory.fen, moves: [...prefix, last] })).toBeNull();
});

test.each([false, true])("another earlier profitable capturer prevents a false new-exposure boundary: reflected=%s", reflected => {
    const { root, history, fen } = constructed(
        "a2a3 d7d5 b2b3 e7e6 h2h3 f8c5 a3a4 c5e3 f2e3 g8f6 d2d4 f6g4 c1b2 a7a6 e3e4 b7b6 h3h4",
        "d5e4", reflected);
    expect(tacticalCaptureGain(root)).toBe(100);
    expect(advancedPawnOpportunityContext(history, fen, root.move)).not.toBeNull();
    expect(provePersistentPawnCapture(root, history)).toBeNull();
});

test.each([false, true])("new exchanges or attacker relocations cannot use the capture-free certificate: reflected=%s", reflected => {
    const input = advancedPawnHistoryInput(reflected);
    for (const tail of ["h7h6 b3b4 g7g5 h4g5 h6g5 c2c3 h8g8 b1a3", "f6g8 b3b4 g8f6 h4h5"]) {
        const moves = [...input.tacticalHistory.moves, ...tail.split(" ").map(move => reflected ? reflectMixedForkMove(move) : move)];
        const steps = replayTacticalLine(input.tacticalHistory.fen, moves);
        expect(steps).toHaveLength(moves.length);
        const fen = makeFen(steps.at(-1)!.after.toSetup());
        const root = replayTacticalLine(fen, input.pvUci)[0];
        expect(tacticalCaptureGain(root)).toBe(100);
        expect(advancedPawnOpportunityContext({ fen: input.tacticalHistory.fen, moves }, fen, root.move)).toBeNull();
    }
});

test.skipIf(!process.env.TACTICAL_ADVANCED_PAWN_OWNER)("the owner's guarded checking pawn capture is available without a missed-choice accusation", () => {
    const report = JSON.parse(readFileSync(process.env.TACTICAL_ADVANCED_PAWN_OWNER!, "utf8"));
    const row = report.results.find((r: any) => r.id === "recall:169647855656:ply79");
    expect(row.scan.motifs[0]).toMatchObject({ label: "Hanging Pawn", value: 100, moveUci: "f3e4", ply: 1 });
    expect(row.classification.missedMotifs).toEqual([]);
    const preceding = report.results.find((r: any) => r.id === "recall:169647855656:ply78");
    expect(preceding.classification.allowedMotifs[0]).toMatchObject({ label: "Hanging Pawn", comparison: "persists" });
});

test.skipIf(!process.env.TACTICAL_ADVANCED_PAWN_PROBES)("export fresh advanced-pawn engine comparisons", async () => {
    const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const probes = [false, true].flatMap(reflected => [false, true].flatMap(waiting => {
        const input = advancedPawnHistoryInput(reflected, waiting);
        const id = `advanced:${reflected}:${waiting}`;
        return [{ id: `${id}:best`, fen: input.fen, depth: 18 },
            { id: `${id}:held`, fen: input.fen, depth: 18, searchMove: input.pvUci[0] }];
    }));
    for (const row of advancedPawnIntegrationCases().filter(row => !row.positive)) {
        probes.push({ id: `${row.id}:best`, fen: row.fen, depth: 18 },
            { id: `${row.id}:held`, fen: row.fen, depth: 18, searchMove: row.pvUci[0] });
    }
    for (const reflected of [false, true]) {
        const input = advancedPawnSequenceInput(
            "a2a3 d7d5 b2b3 e7e6 h2h3 f8c5 a3a4 c5e3 f2e3 g8f6 d2d4 f6g4 c1b2 a7a6 e3e4 b7b6 h3h4", "d5e4", reflected);
        const root = replayTacticalLine(input.fen, input.pvUci)[0];
        const context = advancedPawnOpportunityContext(input.tacticalHistory, input.fen, root.move)!;
        const before = context.before.clone(); before.turn = root.before.turn;
        for (const [stage, fen, searchMove] of [
            ["current", input.fen, input.pvUci[0]],
            ["old-square", makeFen(before.toSetup()), reflected ? reflectMixedForkMove("g4e3") : "g4e3"],
        ]) probes.push({ id: `older-capturer:${reflected}:${stage}:best`, fen, depth: 18 },
            { id: `older-capturer:${reflected}:${stage}:held`, fen, depth: 18, searchMove });
    }
    expect(probes).toHaveLength(24);
    expect(new Set(probes.map(probe => probe.id)).size).toBe(24);
    writeFileSync(privateReportPath(process.env.TACTICAL_ADVANCED_PAWN_PROBES!), JSON.stringify({ probes }, null, 2), { flag: "wx" });
});
