// Constructed corner mating net, not the owner's full game position. A queen
// countercheck may force a nonchecking king capture inside the mating attack.
export const matingCheckEvasionFen = "QK6/3k4/8/8/4q3/7P/8/8 b - - 0 1";
export const matingCheckEvasionLine = [
    "e4e5",
    "b8a7",
    "e5a5",
    "a7b7",
    "a5b5",
    "b7a7",
    "d7c7",
    "a8d8",
    "c7d8",
    "a7a8",
    "d8c7",
    "a8a7",
    "b5a4",
];
export const matingCheckEvasionCases = [
    {
        id: "rook-net-capturable-queen",
        fen: "2Q3qk/p5pp/2pn4/8/8/7P/5rP1/1R5K w - - 3 33",
        pvUci: ["b1b8", "f2f1", "h1h2", "g8c8", "b8c8", "f1f8", "c8f8"],
        positive: false,
    },
    {
        id: "counterchecking-queen",
        fen: matingCheckEvasionFen,
        pvUci: matingCheckEvasionLine,
        positive: true,
    },
    {
        id: "capturable-checker",
        fen: matingCheckEvasionFen.replace("4q3", "4qP2"),
        pvUci: matingCheckEvasionLine,
        positive: false,
    },
    {
        id: "claimable-draw",
        fen: matingCheckEvasionFen.replace(" 0 1", " 99 1"),
        pvUci: matingCheckEvasionLine,
        positive: false,
    },
    {
        id: "unnominated-long-mate",
        fen: matingCheckEvasionFen,
        pvUci: matingCheckEvasionLine.slice(0, 1),
        positive: false,
    },
];
