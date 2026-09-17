// Constructed rook ending, not an exported owner position. The checking
// offer deflects the king guarding the perpetual-checking rook.
export const defensiveDeflectionFen = "5rk1/7R/6KP/8/8/8/Pr6/8 b - - 0 1";
export const defensiveDeflectionMove = "f8f6";
export const defensiveDeflectionControls = [
    // Sound Qf6+ is not this motif: Qxg7 already answers the alleged perpetual.
    {
        id: "queen-offer-with-rook-left",
        fen: defensiveDeflectionFen.replace("5rk1", "5qk1"),
        move: "f8f6",
    },
    {
        id: "offer-loses-material-advantage",
        fen: defensiveDeflectionFen.replace("5rk1", "5qk1").replace("Pr6", "P7"),
        move: "f8f6",
    },
    {
        id: "king-can-escape-checking-cycle",
        fen: "6k1/5r1R/6KP/4p3/8/8/Pr6/8 b - - 0 1",
        move: "f7f6",
    },
    {
        id: "off-square-rook-loss",
        fen: defensiveDeflectionFen.replace("8/8/Pr6", "8/1r6/P7"),
        move: "f8f6",
    },
    {
        id: "immediate-promotion",
        fen: defensiveDeflectionFen.replace("7R", "P6R").replace("Pr6", "1r6"),
        move: "f8f6",
    },
    {
        id: "king-can-keep-guarding",
        fen: defensiveDeflectionFen.replace("5rk1", "5qk1").replace("6KP", "6K1"),
        move: "f8f5",
    },
];
