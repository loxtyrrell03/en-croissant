// Constructed comparison, not an exported owner-game position. Qxc7 permits
// ...Qxg2's rook/pawn fork; castling instead makes Kxg2 a legal answer.
export const mixedForkCaptureDefenceFen = "6nr/2pQb1k1/3p3p/6q1/3pP3/8/5PPP/4K2R w K - 0 1";
export const mixedForkCaptureDefenceMoves = {
    played: "d7c7",
    best: "e1g1",
    reply: "g5g2",
    defence: "g1g2",
};
export const mixedForkCaptureDefenceControls = [
    { id: "protected-attacker", fen: mixedForkCaptureDefenceFen.replace("3pP3/8", "3pP3/7b") },
    { id: "off-square-queen-loss", fen: mixedForkCaptureDefenceFen.replace("6nr", "r1b3nr") },
    { id: "entry-capture-pays-for-queen", fen: mixedForkCaptureDefenceFen.replace("5PPP", "5PQP") },
    {
        id: "played-choice-already-won-a-queen",
        fen: mixedForkCaptureDefenceFen.replace("2pQb1k1", "2qQb1k1"),
    },
];
