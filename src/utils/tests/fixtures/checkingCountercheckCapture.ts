// Constructed rook/queen batteries, not copied owner game positions.
export const countercheckCaptureLine = ["f6b6", "b2c3", "b6c6", "e4c4", "d1c1", "c3d3", "c1c4"];
export const countercheckCaptureCases = [
    { id: "open-a-file", fen: "8/7k/5r2/5P2/4R3/6R1/1K5P/3q4 b - - 0 1", proved: true },
    { id: "no-advanced-pawn", fen: "8/7k/5r2/8/4R3/6R1/PK5P/3q4 b - - 0 1", proved: true },
    {
        id: "capturable-battery-rook",
        fen: "8/3N3k/5r2/5P2/4R3/6R1/1K5P/3q4 b - - 0 1",
        proved: false,
    },
    // These withhold this bounded certificate, not every tactic in the position.
    {
        id: "protected-counterchecking-rook",
        fen: "8/6k1/5rB1/5P2/4R3/6R1/PK5P/3q4 b - - 0 1",
        proved: false,
    },
    {
        id: "off-square-queen-liability",
        fen: "3R4/7k/5r2/5P2/4R3/6R1/1K5P/3q4 b - - 0 1",
        proved: false,
    },
    { id: "promotion-defence", fen: "8/3P3k/5r2/5P2/4R3/6R1/1K5P/3q4 b - - 0 1", proved: false },
];
