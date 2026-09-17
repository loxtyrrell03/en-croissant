// Independently constructed boards; no owner-game or paid-course material.
export const missedPromotionThreatFen = "k7/8/5P2/8/6n1/8/8/1K6 w - - 0 1";
export const promotionForkCollectionFen = "3rk1nr/3pp3/5P2/8/2B5/8/8/1K6 w - - 0 1";
export const promotionThreatCases = [
    { id: "unopposed pawn", fen: "k7/8/5P2/8/8/2K5/8/8 w - - 0 1", move: "f6f7", gain: 800 },
    {
        id: "race won by promotion with check",
        fen: "k7/8/5P2/8/8/1pK5/8/8 w - - 0 1",
        move: "f6f7",
        gain: 800,
    },
    { id: "debit another pawn", fen: "k7/8/5P2/8/6p1/2K4P/8/8 w - - 0 1", move: "f6f7", gain: 700 },
    {
        id: "king captures pushed pawn",
        fen: "5k2/8/5P2/8/8/2K5/8/8 w - - 0 1",
        move: "f6f7",
        gain: null,
    },
    {
        id: "knight captures pushed pawn",
        fen: "k7/8/5P2/4n3/8/8/8/1K6 w - - 0 1",
        move: "f6f7",
        gain: null,
    },
    {
        id: "rook blocks or checks",
        fen: "k3r3/8/5P2/8/8/2K5/8/8 w - - 0 1",
        move: "f6f7",
        gain: null,
    },
    {
        id: "opponent also promotes",
        fen: "8/k7/5P2/8/8/1pK5/8/8 w - - 0 1",
        move: "f6f7",
        gain: null,
    },
    {
        id: "opponent promotes first",
        fen: "k7/8/5P2/8/8/2K5/1p6/8 w - - 0 1",
        move: "f6f7",
        gain: null,
    },
    {
        id: "off-square queen loss",
        fen: "r7/7k/5P2/8/8/8/Q7/7K w - - 0 1",
        move: "f6f7",
        gain: null,
    },
    {
        id: "ordinary early pawn advance",
        fen: "k7/8/8/8/5P2/2K5/8/8 w - - 0 1",
        move: "f4f5",
        gain: null,
    },
];
