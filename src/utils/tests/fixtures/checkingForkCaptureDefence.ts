// Constructed queen-guard comparison, not an owner-game board. After ...Qc5,
// Nc6 blocks the queen's defence of c7; ...Qd6 instead permits Qxc7 after Nxc7+.
export const checkingForkCaptureFen = "r3k3/2p1q3/2n5/3N4/8/8/8/7K b q - 0 1";
export const checkingForkCaptureMoves = { played: "e7c5", best: "e7d6", reply: "d5c7" };

export const checkingForkCaptureControls = [
    {
        name: "capturing the knight loses the queen to an allied bishop",
        fen: checkingForkCaptureFen.replace("3N4/8", "3N4/5B2"),
    },
    {
        name: "taking the knight cannot recover the rook already captured",
        fen: checkingForkCaptureFen.replace("2p1q3", "2r1q3"),
    },
];
