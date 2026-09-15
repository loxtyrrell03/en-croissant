import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../tacticalMotifs/causalTactics";
import type { MistakeReviewMotifInput } from "../../tacticalMotifs/mistakeReviewAdapter";

// Constructed board. Scores are nomination-policy inputs, not engine accuracy claims.
export const alternativeCaptureFen = "4kb2/8/8/4q3/4P3/1PPP1P2/P7/RN1QK3 w Q - 0 1";
export const alternativeCaptureAfter = makeFen(
    replayTacticalLine(alternativeCaptureFen, ["b1a3"])[0].after.toSetup(),
);
export const alternativeCaptureInput: MistakeReviewMotifInput = {
    fen: alternativeCaptureFen,
    playedMoveUci: "b1a3",
    playedMoveSan: "Na3",
    bestMoveUci: "b1d2",
    bestMoveSan: "Nd2",
    pvUci: ["b1d2"],
    pvSan: ["Nd2"],
    refutationUci: ["e5c3"],
    refutationSan: ["Qxc3+"],
    cpLoss: 320,
    cpBefore: -320,
    cpAfter: -640,
    refutationCandidates: [
        { fen: alternativeCaptureAfter, pvUci: ["e5c3"], cp: 640, depth: 16 },
        { fen: alternativeCaptureAfter, pvUci: ["f8a3"], cp: 600, depth: 16 },
    ],
};
