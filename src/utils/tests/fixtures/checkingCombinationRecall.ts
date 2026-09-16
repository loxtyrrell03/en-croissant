// Constructed variants of the audited geometry, not copied owner positions.
export const checkingCombinationLine = ["a4a6", "c8c7", "a6a5", "c7c8", "a5d8"];
export const checkingCombinationCases = [
    { id: "connected-king-attack", fen: "2kr1b1r/p5p1/2p2P2/1p4Bp/Q3R1b1/7P/6PK/R7 w - - 0 1", pvUci: checkingCombinationLine, positive: true },
    { id: "blocked-check", fen: "2kr1b1r/pp4p1/2p2P2/1p4Bp/Q3R1b1/7P/6PK/R7 w - - 0 1", pvUci: ["a4a6"], positive: false },
    { id: "capturable-queen", fen: "2kr1b1r/p5p1/1rp2P2/1p4Bp/Q3R1b1/7P/6PK/R7 w - - 0 1", pvUci: ["a4a6", "c8c7", "a6a7", "c7c8", "a7a8", "c8c7", "a8d8"], positive: false },
];
export const promotionCaptureForkCases = [
    { id: "checking-promotion-fork", fen: "3k1b1r/6p1/5P2/6B1/8/8/6K1/8 w - - 0 1", pvUci: ["f6g7"], positive: true },
    { id: "capturable-pawn", fen: "2k2b1r/6p1/5P2/6B1/8/8/6K1/8 w - - 0 1", pvUci: ["f6g7"], positive: false },
    { id: "promotion-stalemate", fen: "k1r5/8/1P6/1K6/8/8/8/8 w - - 0 1", pvUci: ["b6b7"], positive: false },
];
