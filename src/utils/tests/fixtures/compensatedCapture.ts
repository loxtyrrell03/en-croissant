// Constructed independently of private game material: the attacked bishop
// does not make Nxd5 unprofitable, because ...fxg5 permits Nxg5.
export const compensatedCaptureFen = "r5k1/p5pp/5p2/3n2B1/8/2N2N2/P5PP/R5K1 w - - 0 1";
export const compensatedCaptureInput = {
    fen: compensatedCaptureFen,
    pvUci: ["c3d5", "f6g5", "f3g5"],
    engineName: "Stockfish 18",
    depth: 16,
};
export const compensatedCaptureReviewInput = {
    ...compensatedCaptureInput,
    bestMoveUci: "c3d5", bestMoveSan: "Nxd5",
    playedMoveUci: "c3e4", playedMoveSan: "Ne4",
    pvSan: ["Nxd5", "fxg5", "Nxg5"],
    refutationUci: ["d5e7"], refutationSan: ["Ne7"],
    cpLoss: 150, reachedDepth: 16,
};
