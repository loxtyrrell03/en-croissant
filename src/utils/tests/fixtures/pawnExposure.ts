import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../tacticalMotifs/causalTactics";
import { alternativeCaptureAfter, alternativeCaptureFen } from "./alternativeCapture";

// Constructed geometry controls, not additional sampled owner games.
export const pawnExposureBefore = "r5k1/p3p1pp/8/8/3P4/8/P5PP/R5K1 b - - 0 1";
export const pawnExposureMove = "e7e5";
export const pawnExposureFen = makeFen(
    replayTacticalLine(pawnExposureBefore, [pawnExposureMove])[0].after.toSetup(),
);
export const pawnExposureInput = {
    fen: pawnExposureFen,
    previousFen: pawnExposureBefore,
    previousMoveUci: pawnExposureMove,
    pvUci: ["d4e5"],
};
export const pawnExposureReviewInput = {
    ...pawnExposureInput,
    bestMoveUci: "d4e5",
    bestMoveSan: "dxe5",
    playedMoveUci: "a1b1",
    playedMoveSan: "Rb1",
    refutationUci: ["e5d4"],
    refutationSan: ["exd4"],
    cpLoss: 150,
    cpBefore: 150,
    cpAfter: 0,
};

export const pawnExposureAlternateInput = {
    fen: alternativeCaptureAfter,
    previousFen: alternativeCaptureFen,
    previousMoveUci: "b1a3",
    pvUci: ["e5c3"],
    depth: 16,
    engineName: "Constructed nomination control",
    variations: [
        { multipv: 1, depth: 16, cp: 640, pvUci: ["e5c3"] },
        { multipv: 2, depth: 16, cp: 600, pvUci: ["f8a3"] },
    ],
};
