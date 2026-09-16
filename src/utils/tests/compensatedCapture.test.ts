import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine, tacticalCaptureGain, MIN_TACTICAL_CAPTURE_GAIN, counterCaptureMaterialDefence } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    isImmediateTacticalLesson,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { compensatedCaptureFen, compensatedCaptureInput } from "./fixtures/compensatedCapture";

test.each([false, true])("a pawn gain with a minor-piece imbalance is not rounded away: reflected=%s", reflected => {
    const input = reflected ? {
        ...compensatedCaptureInput,
        fen: reflectMixedForkFen(compensatedCaptureFen),
        pvUci: compensatedCaptureInput.pvUci.map(reflectMixedForkMove),
    } : compensatedCaptureInput;
    const step = replayTacticalLine(input.fen, input.pvUci)[0];
    expect(tacticalCaptureGain(step)).toBe(90);
    // A witness limiting the gain to less than 100 cannot erase a 90-cp lesson.
    expect(counterCaptureMaterialDefence(step, 8192, 0, true)).not.toBeNull();
    expect(counterCaptureMaterialDefence(step, 8192, 0, true, undefined, 90)).toBeNull();
    expect(MIN_TACTICAL_CAPTURE_GAIN).toBe(90);
    const source = classifyPositionTacticalMotifs(input);
    expect(source.motifs[0]).toMatchObject({
        id: "hangingPiece", label: "Material Gain", value: 90,
        ply: 1, moveUci: input.pvUci[0], confidence: "high",
    });
    expect(source.motifs[0].evidence).toContain("0.9 pawns");
    expect(source.motifs[0].evidence).not.toContain("loose knight");
    expect(classifyPositionTacticalMotifs({ ...input, pvUci: input.pvUci.slice(0, 1) }).motifs)
        .toEqual(source.motifs);
    const live = buildLiveTacticalScan(input);
    expect(live.motifs[0]).toMatchObject(source.motifs[0]);
    expect(live.arrows.length).toBeGreaterThan(0);
    expect(isImmediateTacticalLesson(source.motifs[0])).toBe(true);
    for (const value of [0, 10, 80, 89])
        expect(isImmediateTacticalLesson({ ...source.motifs[0], value })).toBe(false);
});

test.each([false, true])("a recapture after the better move does not prove the same loss persists: reflected=%s", reflected => {
    const original = "r5k1/p5pp/8/3n4/8/2N5/P2Q2PP/R5K1 b - - 0 1";
    const move = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const input = {
        fen: reflected ? reflectMixedForkFen(original) : original,
        playedMoveUci: move("a7a6"), bestMoveUci: move("d5c3"),
        pvUci: ["d5c3", "d2c3"].map(move), refutationUci: [move("c3d5")],
    };
    const result = classifyMistakeReviewMotifs(input);
    expect(result.allowedMotifs[0]).toMatchObject({ id: "hangingPiece", comparison: "prevented" });
    expect(buildMistakeReviewTacticalExplanation(result)?.text).not.toContain("same net material gain");
    const persistent = classifyMistakeReviewMotifs({
        ...input, bestMoveUci: move("g7g6"), pvUci: ["g7g6", "c3d5"].map(move),
    });
    expect(persistent.allowedMotifs[0]?.comparison).toBe("persists");
});

test.each([false, true])("missing recapture and an unrelated rook liability still refute the gain: reflected=%s", reflected => {
    for (const fen of [
        compensatedCaptureFen.replace("2N2N2", "2N5"),
        compensatedCaptureFen.replace("P5PP", "Pb4PP"),
    ]) {
        const input = { fen: reflected ? reflectMixedForkFen(fen) : fen,
            pvUci: [reflected ? reflectMixedForkMove("c3d5") : "c3d5"] };
        const step = replayTacticalLine(input.fen, input.pvUci)[0];
        expect(step).toBeTruthy();
        expect(tacticalCaptureGain(step)).toBeLessThan(90);
        expect(classifyPositionTacticalMotifs(input).motifs.some(m => m.id === "hangingPiece")).toBe(false);
    }
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)("the owner capture and missed retreat share the same compensated lesson", () => {
    const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
    const game = [...new Set(report.results.map((row: any) => row.game))][1];
    const lessons = [13, 15].map(ply => {
        const row = report.results.find((row: any) => row.game === game && row.ply === ply);
        expect(row.before[0].pvUci[0]).toBe("c6e5");
        const input = {
            ...row, bestMoveUci: row.before[0].pvUci[0], pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            cpLoss: Math.max(0, row.before[0].cp + row.after[0].cp),
        };
        expect(classifyPositionTacticalMotifs(input).motifs[0]).toMatchObject({ label: "Material Gain", value: 90 });
        const review = classifyMistakeReviewMotifs(input);
        return {ply, missed: review.missedMotifs.map(m => ({label:m.label,value:m.value,ply:m.ply}))};
    });
    expect(lessons).toEqual([
        {ply:13,missed:[{label:"Material Gain",value:90,ply:1}]},
        {ply:15,missed:[]}, // It was actually played.
    ]);
    const row = report.results.find((row: any) => row.game === game && row.ply === 14);
    const result = classifyMistakeReviewMotifs({ ...row, bestMoveUci: row.before[0].pvUci[0],
        pvUci: row.before[0].pvUci, refutationUci: row.after[0].pvUci });
    expect(result.allowedMotifs[0]).toMatchObject({ label: "Material Gain", value: 90, comparison: "prevented" });
});

test("a bishop-for-knight exchange alone is not a tactical material gain", () => {
    const fen = "r5k1/p5pp/4p3/3b4/8/2N5/P5PP/R5K1 w - - 0 1";
    const input = {fen,pvUci:["c3d5","e6d5"]};
    expect(tacticalCaptureGain(replayTacticalLine(fen,input.pvUci)[0])).toBe(10);
    expect(classifyPositionTacticalMotifs(input).motifs).toEqual([]);
});

test("a later small capture is not imported into an unrelated rook-capture lesson", () => {
    const fen = "6k1/pr4pp/5p2/3n2B1/8/2N2N2/P5PP/1R4K1 w - - 0 1";
    const line = ["b1b7", "g8f8", "c3d5"];
    const result = classifyPositionTacticalMotifs({fen,pvUci:line});
    expect(result.motifs[0]?.moveUci).toBe("b1b7");
    expect(result.timeline?.some(m => m.moveUci === "c3d5")).toBe(false);
    const reached = makeFen(replayTacticalLine(fen,line.slice(0,2))[1].after.toSetup());
    expect(classifyPositionTacticalMotifs({fen:reached,pvUci:["c3d5"]}).motifs[0])
        .toMatchObject({label:"Material Gain",value:90,ply:1});
});
