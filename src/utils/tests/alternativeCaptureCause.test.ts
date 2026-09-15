import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { proveAlternativeCaptureCause, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { alternativeCaptureInput } from "./fixtures/alternativeCapture";
import { positionSchema } from "@/components/files/opening";
import { classifyMistakeReviewNature } from "../mistakeReview";

const fen = "4kb2/8/8/4q3/4P3/1PPP1P2/P7/RN1QK3 w Q - 0 1";
test("engine-supported nomination, cause, saved evidence and nature agree without polluting the preferred timeline", () => {
    const result = classifyMistakeReviewMotifs(alternativeCaptureInput);
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        id: "hangingPiece",
        moveUci: "f8a3",
        comparison: "prevented",
    });
    expect(result.allowedTimeline?.some((motif) => motif.alternativeLine)).toBe(false);
    const metadata = positionSchema.shape.mistakeReview.parse(
        JSON.parse(JSON.stringify({ ...alternativeCaptureInput, ...result })),
    );
    expect(metadata?.allowedMotifs?.[0].alternativeLine).toEqual(
        result.allowedMotifs[0].alternativeLine,
    );
    expect(metadata?.refutationCandidates).toEqual(alternativeCaptureInput.refutationCandidates);
    expect(classifyMistakeReviewNature(alternativeCaptureInput)).toMatchObject({
        nature: "tactical",
        aspect: "allowed",
    });
});

test.each([
    "absent",
    "old-board",
    "illegal-line",
    "shallow",
    "mate",
    "no-principal",
    "poor-alternative",
    "tiny-swing",
])("nomination rejects unsupported alternatives: %s", (kind) => {
    const input = structuredClone(alternativeCaptureInput);
    const candidates = input.refutationCandidates!;
    if (kind === "absent") input.refutationCandidates = [];
    if (kind === "old-board") candidates[1].fen = fen;
    if (kind === "illegal-line") candidates[1].pvUci.push("a1a8");
    if (kind === "shallow") candidates[1].depth = 13;
    if (kind === "mate") candidates[0].cp = null;
    if (kind === "no-principal") candidates.shift();
    if (kind === "poor-alternative") candidates[1].cp = 400;
    if (kind === "tiny-swing") input.cpLoss = 30;
    const result = classifyMistakeReviewMotifs(input);
    expect(result.allowedMotifs.some((motif) => motif.alternativeLine)).toBe(false);
    expect(classifyMistakeReviewNature(input).nature).toBe("unknown");
});

test.each([false, true])(
    "an already loose pawn cannot displace a saving check: reflected=%s",
    (reflected) => {
        const original = "5rk1/1R5n/6KP/p2p1p2/6p1/P6r/8/5b2 w - - 0 42";
        const board = reflected ? reflectMixedForkFen(original) : original;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        expect(
            proveAlternativeCaptureCause(board, move("b7h7"), move("b7g7"), [move("h3a3")]),
        ).toBeNull();
    },
);
test.each([false, true])(
    "a knight loss can be explained outside the preferred checking line: black=%s",
    (reflected) => {
        const board = reflected ? reflectMixedForkFen(fen) : fen;
        const uci = (move: string) => (reflected ? reflectMixedForkMove(move) : move);
        const proof = proveAlternativeCaptureCause(
            board,
            uci("b1a3"),
            uci("b1d2"),
            [uci("f8a3")],
            uci("e5c3"),
        );
        expect(proof).toMatchObject({
            id: "hangingPiece",
            value: 320,
            comparison: "prevented",
            moveUci: uci("f8a3"),
        });
        expect(proof?.alternativeLine?.uci).toEqual([uci("f8a3")]);
        expect(
            replayTacticalLine(proof!.alternativeLine!.fen, proof!.alternativeLine!.uci),
        ).toHaveLength(1);
    },
);
test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "invalid/exhausted budget %s has no capture-cause certificate",
    (limit) => {
        expect(
            proveAlternativeCaptureCause(fen, "b1a3", "b1d2", ["f8a3"], "e5c3", limit),
        ).toBeNull();
    },
);
test("a pawn recapturer makes the proposed bishop capture unprofitable", () => {
    const protectedFen = fen.replace("1PPP1P2/P7", "2PP1P2/PP6");
    expect(replayTacticalLine(protectedFen, ["b1a3", "f8a3", "b2a3"])).toHaveLength(3);
    expect(proveAlternativeCaptureCause(protectedFen, "b1a3", "b1d2", ["f8a3"], "e5c3")).toBeNull();
});

test("a different capturer on the better board does not establish prevention", () => {
    const otherAttacker = fen.replace("1PPP1P2", "1PpP1P2");
    expect(replayTacticalLine(otherAttacker, ["b1d2", "c3d2"])).toHaveLength(2);
    expect(proveAlternativeCaptureCause(otherAttacker, "b1a3", "b1d2", ["f8a3"])).toBeNull();
});

test.each([
    {
        fen: "2r2rk1/q3bppp/Np2b3/1P1pPp2/3P4/nQ3N2/3B1PPP/2R2RK1 w - - 0 21",
        played: "d2b4",
        best: "c1a1",
        reply: "c8c1",
        capture: "a3b5",
        cp: 22,
        alternate: -367,
        loss: 136,
    },
    {
        fen: "8/k7/3r4/1P3K2/3P1P2/8/7P/1R6 w - - 4 51",
        played: "b5b6",
        best: "f5e5",
        reply: "a7b7",
        capture: "d6b6",
        cp: -520,
        alternate: -1038,
        loss: 57,
    },
])("a locally profitable but engine-refuted pawn capture is not the cause: $capture", (row) => {
    // Fresh Stockfish 18 held-move checks: the first allows Bxe7 and a
    // discovered queen attack; the second trades into a losing pawn ending.
    const after = replayTacticalLine(row.fen, [row.played])[0].after;
    const afterFen = makeFen(after.toSetup());
    const result = classifyMistakeReviewMotifs({
        fen: row.fen,
        playedMoveUci: row.played,
        bestMoveUci: row.best,
        pvUci: [row.best],
        refutationUci: [row.reply],
        cpLoss: row.loss,
        refutationCandidates: [
            { fen: afterFen, depth: 16, pvUci: [row.reply], cp: row.cp },
            { fen: afterFen, depth: 16, pvUci: [row.capture], cp: row.alternate },
        ],
    });
    expect(result.allowedMotifs.some((motif) => motif.alternativeLine)).toBe(false);
});

test.each([false, true])(
    "moving a guard can newly hang a stationary piece: reflected=%s",
    (reflected) => {
        const original = "4k3/5b2/8/8/8/1N6/8/1R2K3 w - - 0 1";
        const board = reflected ? reflectMixedForkFen(original) : original;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        expect(
            proveAlternativeCaptureCause(board, move("b1c1"), move("b1b2"), [move("f7b3")]),
        ).toMatchObject({
            id: "hangingPiece",
            value: 320,
            comparison: "prevented",
            moveUci: move("f7b3"),
        });
    },
);
test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "the owner's knight loss receives a separate causal reply, not a forged preferred line",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const games = [...new Set(report.results.map((r: any) => r.game))];
        const row = report.results.find((r: any) => r.game === games[1] && r.ply === 20);
        const result = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: row.playedMoveUci,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            refutationCandidates: row.after.map((line: any) => ({ ...line, fen: row.afterFen })),
            cpBefore: row.before[0].cp,
            cpAfter: -row.after[0].cp,
            cpLoss: row.before[0].cp + row.after[0].cp,
        });
        expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
            id: "hangingPiece",
            moveUci: "f8a3",
            comparison: "prevented",
        });
        expect(result.allowedTimeline?.some((m) => m.alternativeLine)).toBe(false);
    },
);
