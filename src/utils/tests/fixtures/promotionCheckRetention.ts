// An anonymous real-game position; its colour reflection is a constructed control.
// d1=Q restores material through rook checks, but does not prove a won game.
export const promotionCheckFen = "8/7k/5r2/4RP2/8/6R1/PK1p3P/8 b - - 0 37";
export const promotionCheckMove = "d2d1q";

// A constructed bad alternative at the same anonymous real-game position.
export const quietMatingFinish = {
    fen: promotionCheckFen,
    playedMoveUci: "f6h6",
    bestMoveUci: promotionCheckMove,
    pvUci: [promotionCheckMove],
    refutationUci: ["e5e7", "h7h8", "g3b3", "d2d1n", "b2a1", "h6g6", "f5g6", "d1e3", "b3b8"],
};
