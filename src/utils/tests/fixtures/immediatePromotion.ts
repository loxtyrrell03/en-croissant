// Constructed controls, not owner-game or paid-course positions.
export const missedPromotionFen = "8/P7/7k/1n5p/8/8/8/7K w - - 0 1";
export const immediatePromotionCases = [
    { id: "safe queen", fen: "8/P7/7k/7p/8/8/8/7K w - - 0 1", move: "a7a8q", gain: 800 },
    { id: "safe rook", fen: "8/P7/7k/7p/8/8/8/7K w - - 0 1", move: "a7a8r", gain: 400 },
    { id: "capture promotion", fen: "r7/1P6/7k/7p/8/8/8/7K w - - 0 1", move: "b7a8q", gain: 1300 },
    { id: "immediate recapture", fen: "8/P7/7k/7p/8/8/7K/r7 w - - 0 1", move: "a7a8q", gain: null },
    {
        id: "off-square queen loss",
        fen: "1r6/P7/7k/7p/8/8/1Q6/7K w - - 0 1",
        move: "a7a8q",
        gain: null,
    },
    { id: "stalemate", fen: "8/k1P5/2K5/8/8/8/8/8 w - - 0 1", move: "c7c8q", gain: null },
    { id: "dead underpromotion", fen: "8/P7/7k/8/8/8/8/7K w - - 0 1", move: "a7a8b", gain: null },
    {
        id: "allows immediate mate",
        fen: "1r5k/P6p/8/8/8/8/6PP/6K1 w - - 0 1",
        move: "a7a8q",
        gain: null,
    },
    { id: "opposing promotion", fen: "8/P7/7k/8/8/8/7p/5K2 w - - 0 1", move: "a7a8q", gain: null },
    {
        id: "capturable counterchecks",
        fen: "8/P7/1r5k/7p/8/8/K7/8 w - - 0 1",
        move: "a7a8q",
        gain: 800,
    },
];
