import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    isNewlyExposedPawnCapture,
    pawnOpportunityRemainsAfterReply,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { pawnExposureBefore, pawnExposureInput } from "./fixtures/pawnExposure";
import { classifyMistakeReviewNature } from "../mistakeReview";
import { positionSchema } from "@/components/files/opening";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    alternativeCaptureFen,
    alternativeCaptureAfter,
    alternativeCaptureInput,
} from "./fixtures/alternativeCapture";

test.each([false, true])(
    "a newly exposed pawn is a real capture opportunity: reflected=%s",
    (reflected) => {
        const input = reflected
            ? {
                  fen: makeFen(
                      replayTacticalLine(reflectMixedForkFen(pawnExposureBefore), [
                          reflectMixedForkMove("e7e5"),
                      ])[0].after.toSetup(),
                  ),
                  previousFen: reflectMixedForkFen(pawnExposureBefore),
                  previousMoveUci: reflectMixedForkMove("e7e5"),
                  pvUci: [reflectMixedForkMove("d4e5")],
              }
            : pawnExposureInput;
        const result = classifyPositionTacticalMotifs(input);
        expect(result.motifs[0]).toMatchObject({
            id: "hangingPiece",
            label: "Hanging Pawn",
            value: 100,
            ply: 1,
            moveUci: input.pvUci[0],
        });
        expect(
            classifyPositionTacticalMotifs({ fen: input.fen, pvUci: input.pvUci }).motifs,
        ).toEqual([]);
        expect(
            isNewlyExposedPawnCapture(
                replayTacticalLine(input.fen, input.pvUci)[0],
                input.previousFen,
                input.previousMoveUci,
                0,
            ),
        ).toBe(false);
    },
);

test("moving a guard exposes the same pawn, while keeping another guard prevents the gain", () => {
    const before = "r5k1/p5pp/2n5/4p3/3P4/8/P5PP/R5K1 b - - 0 1";
    const fen = makeFen(replayTacticalLine(before, ["c6e7"])[0].after.toSetup());
    expect(
        classifyPositionTacticalMotifs({
            fen,
            previousFen: before,
            previousMoveUci: "c6e7",
            pvUci: ["d4e5"],
        }).motifs[0]?.label,
    ).toBe("Hanging Pawn");
    const guarded = before.replace("2n5", "2n2p2");
    const guardedFen = makeFen(replayTacticalLine(guarded, ["c6e7"])[0].after.toSetup());
    expect(
        classifyPositionTacticalMotifs({
            fen: guardedFen,
            previousFen: guarded,
            previousMoveUci: "c6e7",
            pvUci: ["d4e5"],
        }).motifs,
    ).toEqual([]);
});

test("stale or absent history, old pawn exposure and normal recaptures cannot issue the new certificate", () => {
    const previousFen = pawnExposureInput.fen.replace(" w ", " b ");
    const old = replayTacticalLine(previousFen, ["a7a6"])[0];
    expect(
        classifyPositionTacticalMotifs({
            fen: makeFen(old.after.toSetup()),
            previousFen,
            previousMoveUci: "a7a6",
            pvUci: ["d4e5"],
        }).motifs,
    ).toEqual([]);
    expect(
        classifyPositionTacticalMotifs({ ...pawnExposureInput, previousMoveUci: "a7a6" }).motifs,
    ).toEqual([]);
    expect(
        classifyPositionTacticalMotifs({
            ...pawnExposureInput,
            previousFen: pawnExposureBefore.replace("0 1", "0 2"),
        }).motifs,
    ).toEqual([]);
    const before = "r5k1/p5pp/4p3/3P4/2P5/8/P5PP/R5K1 b - - 0 1";
    const after = replayTacticalLine(before, ["e6d5"])[0];
    expect(
        classifyPositionTacticalMotifs({
            fen: makeFen(after.after.toSetup()),
            previousFen: before,
            previousMoveUci: "e6d5",
            pvUci: ["c4d5"],
        }).motifs,
    ).toEqual([]);
});

test("missed pawn lessons retain their preceding board and do not contaminate history-free cache entries", () => {
    const input = {
        ...pawnExposureInput,
        bestMoveUci: "d4e5",
        playedMoveUci: "a1b1",
        cpLoss: 150,
        cpBefore: 150,
        cpAfter: 0,
    };
    const result = classifyMistakeReviewMotifs(input);
    expect(buildMistakeReviewTacticalExplanation(result)?.primary.label).toBe("Hanging Pawn");
    expect(classifyMistakeReviewNature(input).nature).toBe("tactical");
    expect(
        classifyMistakeReviewNature({
            ...input,
            previousFen: undefined,
            previousMoveUci: undefined,
        }).nature,
    ).toBe("unknown");
    expect(
        classifyMistakeReviewMotifs({
            ...input,
            previousFen: undefined,
            previousMoveUci: undefined,
        }).missedMotifs,
    ).toEqual([]);
    const metadata = positionSchema.shape.mistakeReview.parse({ ...input, ...result });
    expect(metadata?.previousFen).toBe(pawnExposureBefore);
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "owner pawn oversights agree with live scans and keep the more instructive knight capture",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        for (const ply of [14, 24]) {
            const row = report.results.find(
                (r: any) => r.game === report.results[0].game && r.ply === ply,
            );
            const result = classifyMistakeReviewMotifs({
                ...row,
                bestMoveUci: row.before[0].pvUci[0],
                pvUci: row.before[0].pvUci,
                refutationUci: row.after[0].pvUci,
                cpLoss: Math.max(0, row.before[0].cp + row.after[0].cp),
            });
            expect(result.missedMotifs.map((m) => m.label)).toEqual(
                ply === 14 ? ["Hanging Pawn"] : [],
            );
            expect(result.allowedMotifs).toEqual([]);
            expect(
                classifyPositionTacticalMotifs({ ...row, pvUci: row.before[0].pvUci }).motifs[0]
                    ?.label,
            ).toBe("Hanging Pawn");
        }
    },
);

test("a pawn capture still available after the actual reply is not by itself a missed-move cause", () => {
    const input = {
        ...pawnExposureInput,
        bestMoveUci: "d4e5",
        playedMoveUci: "a1b1",
        refutationUci: ["a7a6"],
        cpLoss: 150,
    };
    expect(pawnOpportunityRemainsAfterReply(input.fen, "d4e5", "a1b1", "a7a6")).toBe(true);
    expect(classifyMistakeReviewMotifs(input).missedMotifs).toEqual([]);
    expect(pawnOpportunityRemainsAfterReply(input.fen, "d4e5", "a1b1", "e5d4")).toBe(false);
    expect(
        classifyMistakeReviewMotifs({ ...input, refutationUci: ["e5d4"] }).missedMotifs[0]?.label,
    ).toBe("Hanging Pawn");
    expect(pawnOpportunityRemainsAfterReply(input.fen, "d4e5", "a1b1", "a7a6", 0)).toBe(false);
    // An opened rook file prevents retaining the gain; local pawn SEE alone
    // is insufficient to claim that the opportunity remains available.
    expect(pawnOpportunityRemainsAfterReply(input.fen, "d4e5", "a1b1", "a8b8")).toBe(false);
});

test("a simple pawn lesson cannot import unrelated future gains into its timeline", () => {
    const scan = buildLiveTacticalScan({
        ...pawnExposureInput,
        pvUci: ["d4e5", "a8b8", "a1b1", "a7a6", "b1b8", "g8f7"],
        depth: 16,
        engineName: "Constructed cooperative continuation",
    });
    expect(scan.motifs[0]?.label).toBe("Hanging Pawn");
    expect(scan.variations[0].timeline.map((m) => m.ply)).toEqual([1]);
});

test.each(["e1a1", "e1h1"])(
    "castling's actual king/rook guard changes govern the pawn lesson: %s",
    (move) => {
        // Public real-game context zJqoVvf1 ply 30, already frozen in the
        // castling audit. These are legal alternatives, not two actual moves.
        const previousFen = "1r6/p2n1ppk/1p1pp2p/3p1b2/P2P3q/1QP1P3/1P1N1PPP/R3K2R w KQ - 0 16";
        const fen = makeFen(replayTacticalLine(previousFen, [move])[0].after.toSetup());
        const result = classifyPositionTacticalMotifs({
            fen,
            previousFen,
            previousMoveUci: move,
            pvUci: ["h4f2"],
        });
        expect(result.motifs.map((m) => m.label)).toEqual(move === "e1a1" ? ["Hanging Pawn"] : []);
    },
);

test.each(["verified", "too-far", "shallow", "mate", "missing-score"])(
    "pawn headlines do not bury stronger supported alternatives: %s",
    (mode) => {
        const input = {
            fen: alternativeCaptureAfter,
            previousFen: alternativeCaptureFen,
            previousMoveUci: "b1a3",
            pvUci: ["e5c3"],
            depth: 16,
            engineName: "Nomination control",
            variations: [
                { multipv: 1, depth: 16, cp: 640, pvUci: ["e5c3"] },
                {
                    multipv: 2,
                    depth: mode === "shallow" ? 13 : 16,
                    cp: mode === "missing-score" ? undefined : mode === "too-far" ? 530 : 600,
                    mate: mode === "mate" ? -2 : undefined,
                    pvUci: ["f8a3"],
                },
            ],
        };
        const scan = buildLiveTacticalScan(input);
        expect(scan.lineUci[0]).toBe(mode === "verified" ? "f8a3" : "e5c3");
        expect(scan.preferredReason).toBe(
            mode === "verified" ? "larger-material-lesson" : undefined,
        );
        expect(scan.motifs[0]).toMatchObject(
            mode === "verified"
                ? { label: "Hanging Piece", value: 320 }
                : { label: "Hanging Pawn", value: 100 },
        );
        expect(scan.variations[0].lineUci[0]).toBe("e5c3");
    },
);

test("a pawn explanation cannot replace the more valuable allowed or missed knight lesson", () => {
    const allowed = classifyMistakeReviewMotifs(alternativeCaptureInput);
    expect(buildMistakeReviewTacticalExplanation(allowed)?.primary).toMatchObject({
        value: 320,
        moveUci: "f8a3",
    });
    const missed = classifyMistakeReviewMotifs({
        fen: alternativeCaptureAfter,
        previousFen: alternativeCaptureFen,
        previousMoveUci: "b1a3",
        bestMoveUci: "e5c3",
        pvUci: ["e5c3"],
        playedMoveUci: "e8f7",
        cpLoss: 200,
        bestCandidates: alternativeCaptureInput.refutationCandidates,
    });
    expect(buildMistakeReviewTacticalExplanation(missed)?.primary).toMatchObject({
        value: 320,
        moveUci: "f8a3",
    });
});
