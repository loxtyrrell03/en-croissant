import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
    provePersistentPawnCapture,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    buildTacticalTimeline,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { checkingPawnHistoryCases } from "./fixtures/checkingPawnHistory";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.each([false, true])(
    "a pawn-check timeline retains only the actual defensive interference: reflected=%s",
    (reflected) => {
        // Constructed renderer/projection contract with an independently checked
        // local pawn bound. This does not bypass the full-history admission rule.
        const original = "6k1/8/8/6q1/8/7N/4K1P1/R6R b - - 0 1";
        const fen = reflected ? reflectMixedForkFen(original) : original;
        const map = (move: string) => (reflected ? reflectMixedForkMove(move) : move);
        const root = map("g5g2");
        expect(tacticalCaptureGain(replayTacticalLine(fen, [root])[0])).toBe(100);
        const motif = {
            id: "hangingPiece",
            label: "Hanging Pawn",
            confidence: "high" as const,
            source: "available" as const,
            ply: 1,
            moveUci: root,
            value: 100,
            evidence: "Constructed local pawn gain",
            relevance: "primary" as const,
        };
        const blocked = buildTacticalTimeline(fen, [root, map("e2e1"), map("g2h1")], "available", [
            motif,
        ]);
        expect(blocked.map((m) => [m.id, m.ply])).toEqual([
            ["hangingPiece", 1],
            ["selfInterference", 2],
        ]);
        expect(blocked[1].actor).toBe(reflected ? "black" : "white");
        expect(blocked[1].value).toBe(500);
        const parried = buildTacticalTimeline(fen, [root, map("h3f2")], "available", [motif]);
        expect(parried.map((m) => [m.id, m.ply])).toEqual([["hangingPiece", 1]]);
    },
);

test.each(checkingPawnHistoryCases)(
    "$id: checking captures still need complete exchange history and local safety",
    (row) => {
        const { fen, gain, tacticalHistory: history } = row;
        const move = row.pvUci[0];
        const step = replayTacticalLine(fen, [move])[0];
        expect(step.after.isCheck()).toBe(true);
        expect(step.after.isCheckmate()).toBe(false);
        const proof = provePersistentPawnCapture(step, history);
        expect(Boolean(proof)).toBe(gain);
        if (!gain) return;
        expect(tacticalCaptureGain(step)).toBe(100);
        expect(proof!.gain).toBe(100);
        const input = { fen, pvUci: [move], rootCp: 100, tacticalHistory: history };
        const scan = buildLiveTacticalScan({
            ...input,
            depth: 16,
            engineName: "Constructed history control",
            variations: [{ pvUci: [move], cp: 100, depth: 16 }],
        });
        expect(scan.motifs[0]).toMatchObject({
            id: "hangingPiece",
            label: "Hanging Pawn",
            value: 100,
            ply: 1,
        });
        expect(scan.motifs.some((m) => m.id === "fork")).toBe(false);
        expect(scan.arrows.map((a) => a.from + a.to)).toEqual([move]);
        expect(provePersistentPawnCapture(step, undefined)).toBeNull();
        expect(
            provePersistentPawnCapture(step, { ...history, moves: history.moves.slice(0, -1) }),
        ).toBeNull();
        for (const rootCp of [null, 9000, -10000])
            expect(classifyPositionTacticalMotifs({ ...input, rootCp }).motifs).toEqual([]);
    },
);

test.skipIf(
    !process.env.TACTICAL_CHECKING_HISTORY_OWNER || !process.env.TACTICAL_CHECKING_HISTORY_CASE,
)(
    "the owner pawn option stays secondary to the actual queen loss, not an invented rook fork",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_CHECKING_HISTORY_OWNER!, "utf8"),
        );
        const row = report.results.find(
            (r: any) => r.id === process.env.TACTICAL_CHECKING_HISTORY_CASE,
        );
        expect(row).toBeTruthy();
        const scan = buildLiveTacticalScan({
            ...row,
            ...row.before[0],
            variations: row.before,
            engineName: "Stockfish 18",
        });
        const candidate = scan.variations.find((v) => v.lineUci[0] === "g5g2")!;
        expect(candidate.motifs).toEqual([
            expect.objectContaining({
                id: "hangingPiece",
                label: "Hanging Pawn",
                value: 100,
                ply: 1,
            }),
        ]);
        expect(candidate.timeline).toContainEqual(
            expect.objectContaining({ id: "selfInterference", ply: 2 }),
        );
        const sign = row.fen.split(" ")[1] === "w" ? 1 : -1;
        const input = {
            ...row,
            bestMoveUci: row.before[0].pvUci[0],
            pvUci: row.before[0].pvUci,
            refutationUci: row.after[0].pvUci,
            bestCandidates: row.before.map((v: any) => ({ ...v, fen: row.fen })),
            refutationCandidates: row.after.map((v: any) => ({ ...v, fen: row.afterFen })),
            cpBefore: row.before[0].cp * sign,
            cpAfter: -row.after[0].cp * sign,
            cpLoss: row.before[0].cp + row.after[0].cp,
        };
        const why = buildMistakeReviewTacticalExplanation(classifyMistakeReviewMotifs(input))!;
        expect(why.primary).toMatchObject({ source: "allowed", id: "hangingPiece", value: 900 });
        expect(why.secondary).toMatchObject({
            source: "missed",
            id: "hangingPiece",
            label: "Hanging Pawn",
            value: 100,
            alternativeLine: { fen: row.fen, uci: ["g5g2"], san: ["Qxg2+"] },
        });
        // Structural ownership check: playing this alternative is not missing it.
        const played = classifyMistakeReviewMotifs({
            ...input,
            playedMoveUci: "g5g2",
            refutationUci: ["h3f2"],
            refutationCandidates: [],
        });
        expect(played.missedMotifs.some((m) => m.moveUci === "g5g2")).toBe(false);
    },
);
