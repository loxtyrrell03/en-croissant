/** Constructed rook checks: the knight capture is part of a repeatable draw,
 * not evidence that the materially worse side wins the game. */
export const perpetualMaterialFen = "5rk1/1R5n/6KP/5p2/6p1/7r/8/5b2 w - - 0 1";
export const perpetualMaterialLine = ["b7g7", "g8h8", "g7h7", "h8g8", "h7g7", "g8h8"];
export const perpetualMaterialCases = [
    { id: "saving-fork", fen: perpetualMaterialFen, cp: 0, expected: "perpetualCheck" },
    {
        id: "checking-rook-capturable",
        fen: perpetualMaterialFen.replace("7r", "2b4r"),
        cp: 0,
        expected: null,
    },
    {
        id: "king-captures-unsupported-rook",
        fen: perpetualMaterialFen.replace("6KP/5p2", "8/4Kp1P"),
        cp: 0,
        expected: null,
    },
    { id: "positive-position-not-saving", fen: perpetualMaterialFen, cp: 600, expected: "fork" },
    {
        id: "immediate-mate",
        fen: perpetualMaterialFen.replace("1R5n", "5N1R"),
        move: "h7g7",
        cp: 0,
        expected: "vukovicMate",
    },
] as const;
