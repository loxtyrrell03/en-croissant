import type { MistakeReviewMotifInput } from "../../tacticalMotifs/mistakeReviewAdapter";
import { alternativeCaptureAfter } from "./alternativeCapture";

// Constructed policy fixture. Scores are not claimed engine judgements.
export const missedAlternativeInput: MistakeReviewMotifInput = {
    fen: alternativeCaptureAfter,
    playedMoveUci: "e8f7",
    playedMoveSan: "Kf7",
    bestMoveUci: "e5c3",
    bestMoveSan: "Qxc3+",
    pvUci: ["e5c3"],
    pvSan: ["Qxc3+"],
    refutationUci: [],
    cpLoss: 200,
    cpBefore: -640,
    cpAfter: -440,
    bestCandidates: [
        { fen: alternativeCaptureAfter, pvUci: ["e5c3"], cp: 640, depth: 16 },
        { fen: alternativeCaptureAfter, pvUci: ["f8a3"], cp: 600, depth: 16 },
    ],
};
